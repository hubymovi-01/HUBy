// js/cliente/cliente-rastreio.js - Acompanhamento ao vivo da corrida na tela do passageiro
//
// Fase "buscando": carro do motorista indo até o passageiro (linha azul + "chega em X min")
// Fase "viagem":   passageiro a bordo, carro indo até o destino (linha verde + "chegada em X min")
//
// O GPS chega pelo socket na "sala" da corrida. O servidor só deixa entrar o passageiro
// dono da corrida e só repassa a posição do motorista que aceitou essa corrida.

const ID_FONTE = 'huby-rastreio-source';
const ID_BORDA = 'huby-rastreio-borda';
const ID_LINHA = 'huby-rastreio-linha';

const CORES = {
  buscando: { linha: '#38BDF8', borda: '#0EA5E9' },
  viagem: { linha: '#34D399', borda: '#10B981' }
};

const INTERVALO_MIN_ROTA_MS = 12000;   // não pede rota nova antes disso
const INTERVALO_MAX_ROTA_MS = 30000;   // pede rota nova pelo menos a cada 30 s
const DESVIO_RECALCULO_M = 120;        // saiu mais que isso da linha: recalcula
const ANIMACAO_MS = 900;               // tempo do carro deslizar até a nova posição
const SEM_SINAL_MS = 60000;            // 1 min sem GPS: avisa "sem sinal"
const PAUSA_CAMERA_MS = 15000;         // passageiro mexeu no mapa: câmera para de seguir por 15 s
const VELOCIDADE_RESERVA_KMH = 25;     // usada se o serviço de rotas falhar

let estado = null;

// ============================================================================
// FUNÇÕES PÚBLICAS
// ============================================================================

/**
 * Começa a acompanhar a corrida.
 * @param {object} opcoes
 * @param {object} opcoes.socket      socket.io já conectado COM o token do passageiro
 * @param {string} opcoes.pedidoId
 * @param {object} opcoes.mapa        instância de HubyMapa (usa mapa.map do MapLibre)
 * @param {number[]} opcoes.embarque  [lat, lng] do local de embarque
 * @param {number[]} opcoes.destino   [lat, lng] do destino
 * @param {'buscando'|'viagem'} [opcoes.fase]
 * @param {string} [opcoes.categoria] 'carro' | 'moto' | 'entrega'
 * @param {function} [opcoes.aoAtualizar] recebe { fase, minutos, distanciaKm, distanciaAteAlvoM, semSinal }
 */
export function iniciarRastreioCorrida(opcoes = {}) {
  const { socket, pedidoId, mapa } = opcoes;
  if (!socket || !pedidoId || !mapa?.map || !window.maplibregl) return false;

  // Mesma corrida já sendo acompanhada: só atualiza a fase
  if (estado && estado.pedidoId === String(pedidoId)) {
    if (opcoes.fase) definirFaseRastreio(opcoes.fase);
    return true;
  }

  pararRastreioCorrida();

  estado = {
    socket,
    pedidoId: String(pedidoId),
    mapa,
    map: mapa.map,
    embarque: coordsValidas(opcoes.embarque) ? opcoes.embarque.map(Number) : null,
    destino: coordsValidas(opcoes.destino) ? opcoes.destino.map(Number) : null,
    fase: opcoes.fase === 'viagem' ? 'viagem' : 'buscando',
    categoria: String(opcoes.categoria || 'carro').toLowerCase(),
    aoAtualizar: typeof opcoes.aoAtualizar === 'function' ? opcoes.aoAtualizar : () => {},

    marcador: null,
    elementoVeiculo: null,
    posicaoExibida: null,      // [lng, lat] mostrada na tela
    animacao: null,
    ultimaPosicao: null,       // { lat, lng, heading, em }
    ultimaPosicaoEm: 0,

    rotaCoords: null,          // [[lng, lat], ...]
    rotaDuracaoMin: null,
    rotaDistanciaKm: null,
    rotaCalculadaEm: 0,
    buscandoRota: false,

    primeiraPosicao: true,
    usuarioMexeuEm: 0,
    temporizadorSinal: null,
    ouvintes: []
  };

  // Para a câmera de seguir o carro quando o passageiro arrasta ou dá zoom
  const aoMexer = (e) => {
    if (e && e.originalEvent) estado.usuarioMexeuEm = Date.now();
  };
  estado.map.on('dragstart', aoMexer);
  estado.map.on('zoomstart', aoMexer);
  estado.ouvintes.push(() => {
    try {
      estado.map.off('dragstart', aoMexer);
      estado.map.off('zoomstart', aoMexer);
    } catch (e) {}
  });

  // Recebe o GPS da corrida
  const aoReceberPosicao = (dados) => {
    if (!estado || String(dados?.pedidoId) !== estado.pedidoId) return;
    receberPosicao(dados);
  };
  socket.on('posicao_corrida', aoReceberPosicao);
  estado.ouvintes.push(() => socket.off('posicao_corrida', aoReceberPosicao));

  // Se a internet cair e voltar, entra de novo na sala da corrida
  const aoReconectar = () => entrarNaSala();
  socket.on('connect', aoReconectar);
  estado.ouvintes.push(() => socket.off('connect', aoReconectar));

  entrarNaSala();

  // Vigia de sinal: avisa se o GPS parar de chegar
  estado.temporizadorSinal = setInterval(() => {
    if (!estado || !estado.ultimaPosicaoEm) return;
    if (Date.now() - estado.ultimaPosicaoEm > SEM_SINAL_MS) {
      avisarTela({ semSinal: true });
    }
  }, 10000);

  // Esconde a rota do pedido (origem → destino) para não confundir com a linha ao vivo
  try { mapa.limparRota?.(); } catch (e) {}

  avisarTela({});
  return true;
}

// Troca a fase: 'buscando' (indo buscar) ou 'viagem' (indo ao destino)
export function definirFaseRastreio(novaFase) {
  if (!estado) return;
  const fase = novaFase === 'viagem' ? 'viagem' : 'buscando';
  if (estado.fase === fase) return;

  estado.fase = fase;
  estado.rotaCoords = null;
  estado.rotaDuracaoMin = null;
  estado.rotaDistanciaKm = null;
  estado.rotaCalculadaEm = 0;
  estado.primeiraPosicao = true;
  estado.usuarioMexeuEm = 0;

  aplicarCorDaFase();
  if (estado.ultimaPosicao) {
    recalcularRota(true);
  }
  avisarTela({});
}

// Para tudo e limpa o mapa (corrida terminou ou foi cancelada)
export function pararRastreioCorrida() {
  if (!estado) return;
  const atual = estado;
  estado = null;

  try { atual.socket.emit('sair_corrida', { pedidoId: atual.pedidoId }); } catch (e) {}
  atual.ouvintes.forEach((desligar) => {
    try { desligar(); } catch (e) {}
  });
  if (atual.temporizadorSinal) clearInterval(atual.temporizadorSinal);
  if (atual.animacao) cancelAnimationFrame(atual.animacao);
  try { atual.marcador?.remove(); } catch (e) {}

  try {
    const fonte = atual.map.getSource(ID_FONTE);
    if (fonte) fonte.setData({ type: 'FeatureCollection', features: [] });
  } catch (e) {}
}

export function rastreioAtivo() {
  return Boolean(estado);
}

// ============================================================================
// SALA DA CORRIDA NO SERVIDOR
// ============================================================================
function entrarNaSala() {
  if (!estado) return;
  const pedidoId = estado.pedidoId;
  try {
    estado.socket.emit('entrar_corrida', { pedidoId }, (resposta) => {
      if (!estado || estado.pedidoId !== pedidoId) return;
      if (!resposta?.ok) {
        console.warn('Rastreio: não foi possível acompanhar a corrida.', resposta?.erro || '');
      }
    });
  } catch (e) {}
}

// ============================================================================
// POSIÇÃO DO CARRO
// ============================================================================
function receberPosicao(dados) {
  const lat = Number(dados?.lat);
  const lng = Number(dados?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const heading = Number(dados?.heading);
  estado.ultimaPosicao = { lat, lng, heading: Number.isFinite(heading) ? heading : null };
  estado.ultimaPosicaoEm = Date.now();

  // O servidor diz em que etapa a corrida está: ajusta a fase se precisar
  const statusServidor = String(dados?.status || '').toLowerCase();
  if (['em_viagem', 'em_andamento'].includes(statusServidor) && estado.fase !== 'viagem') {
    definirFaseRastreio('viagem');
  }

  moverVeiculo(lng, lat, estado.ultimaPosicao.heading);

  const alvo = alvoDaFase();
  const precisaRota =
    !estado.rotaCoords ||
    Date.now() - estado.rotaCalculadaEm > INTERVALO_MAX_ROTA_MS ||
    (estado.rotaCoords && distanciaAteLinhaM([lng, lat], estado.rotaCoords) > DESVIO_RECALCULO_M);

  if (precisaRota) recalcularRota(false);

  if (estado.primeiraPosicao) {
    estado.primeiraPosicao = false;
    enquadrarCarroEAlvo();
  } else {
    seguirCarro();
  }

  avisarTela({ semSinal: false, distanciaAteAlvoM: alvo ? distanciaM([lng, lat], [alvo[1], alvo[0]]) : null });
}

function criarElementoVeiculo() {
  const ehMoto = estado.categoria.includes('moto');
  const ehEntrega = estado.categoria.includes('entrega') || estado.categoria.includes('flash');
  const cor = ehMoto ? '#F59E0B' : (ehEntrega ? '#A855F7' : '#10B981');

  const caixa = document.createElement('div');
  caixa.style.cssText = 'width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:none;';

  const giro = document.createElement('div');
  giro.style.cssText = 'width:44px;height:44px;transition:transform 0.6s linear;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.7));';

  // Carro visto de cima, com a frente apontando para cima (norte)
  giro.innerHTML = `
    <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
      <circle cx="22" cy="22" r="20" fill="rgba(9,13,22,0.88)" stroke="${cor}" stroke-width="2.5"/>
      <rect x="15" y="9" width="14" height="26" rx="5" fill="${cor}"/>
      <rect x="17" y="12" width="10" height="6" rx="2" fill="#0B1220" opacity="0.85"/>
      <rect x="17" y="27" width="10" height="5" rx="2" fill="#0B1220" opacity="0.6"/>
      <polygon points="22,3 18,8 26,8" fill="${cor}"/>
    </svg>
  `;

  caixa.appendChild(giro);
  estado.elementoVeiculo = giro;
  return caixa;
}

function moverVeiculo(lng, lat, heading) {
  if (!estado.marcador) {
    const elemento = criarElementoVeiculo();
    estado.marcador = new window.maplibregl.Marker({
      element: elemento,
      anchor: 'center',
      rotationAlignment: 'map',
      pitchAlignment: 'map'
    })
      .setLngLat([lng, lat])
      .addTo(estado.map);
    estado.posicaoExibida = [lng, lat];
  } else {
    animarAte([lng, lat]);
  }

  if (Number.isFinite(heading) && estado.marcador) {
    estado.marcador.setRotation(heading);
  }
}

// Desliza o carro da posição atual até a nova (sem "pular")
function animarAte(destino) {
  if (estado.animacao) cancelAnimationFrame(estado.animacao);
  const inicio = estado.posicaoExibida || destino;
  const comeco = performance.now();

  // Salto muito grande (ex.: GPS voltou depois de muito tempo): vai direto
  if (distanciaM(inicio, destino) > 1500) {
    estado.posicaoExibida = destino;
    estado.marcador.setLngLat(destino);
    return;
  }

  const passo = (agora) => {
    if (!estado) return;
    const t = Math.min(1, (agora - comeco) / ANIMACAO_MS);
    const suave = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const atual = [
      inicio[0] + (destino[0] - inicio[0]) * suave,
      inicio[1] + (destino[1] - inicio[1]) * suave
    ];
    estado.posicaoExibida = atual;
    estado.marcador.setLngLat(atual);
    if (t < 1) estado.animacao = requestAnimationFrame(passo);
  };
  estado.animacao = requestAnimationFrame(passo);
}

// ============================================================================
// ROTA AO VIVO (CARRO → EMBARQUE ou CARRO → DESTINO)
// ============================================================================
function alvoDaFase() {
  return estado.fase === 'viagem' ? estado.destino : estado.embarque;
}

async function recalcularRota(forcar) {
  if (!estado || estado.buscandoRota || !estado.ultimaPosicao) return;
  const alvo = alvoDaFase();
  if (!alvo) return;

  if (!forcar && Date.now() - estado.rotaCalculadaEm < INTERVALO_MIN_ROTA_MS) return;

  estado.buscandoRota = true;
  const pedidoId = estado.pedidoId;
  const fase = estado.fase;
  const origem = [estado.ultimaPosicao.lng, estado.ultimaPosicao.lat];
  const destino = [alvo[1], alvo[0]];

  let resultado = null;
  try {
    resultado = await buscarRotaRuas(origem, destino);
  } catch (e) {}

  // A corrida ou a fase mudou enquanto esperava: descarta
  if (!estado || estado.pedidoId !== pedidoId || estado.fase !== fase) {
    if (estado) estado.buscandoRota = false;
    return;
  }

  if (!resultado) {
    const km = distanciaM(origem, destino) / 1000 * 1.3;
    resultado = {
      coords: [origem, destino],
      distanciaKm: km,
      duracaoMin: (km / VELOCIDADE_RESERVA_KMH) * 60
    };
  }

  estado.rotaCoords = resultado.coords;
  estado.rotaDistanciaKm = resultado.distanciaKm;
  estado.rotaDuracaoMin = resultado.duracaoMin;
  estado.rotaCalculadaEm = Date.now();
  estado.buscandoRota = false;

  desenharLinha(resultado.coords);
  avisarTela({});
}

async function buscarRotaRuas(origem, destino) {
  const pontos = `${origem[0]},${origem[1]};${destino[0]},${destino[1]}`;
  const urls = [
    `https://router.project-osrm.org/route/v1/driving/${pontos}?overview=full&geometries=geojson`,
    `https://routing.openstreetmap.de/routed-car/route/v1/driving/${pontos}?overview=full&geometries=geojson`
  ];

  for (const url of urls) {
    try {
      const controle = new AbortController();
      const limite = setTimeout(() => controle.abort(), 7000);
      const resp = await fetch(url, { signal: controle.signal });
      clearTimeout(limite);
      if (!resp.ok) continue;
      const json = await resp.json();
      const rota = json?.routes?.[0];
      if (json?.code === 'Ok' && rota?.geometry?.coordinates?.length >= 2) {
        return {
          coords: rota.geometry.coordinates,
          distanciaKm: rota.distance / 1000,
          duracaoMin: rota.duration / 60
        };
      }
    } catch (e) {}
  }
  return null;
}

function desenharLinha(coords) {
  const map = estado.map;
  const dados = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }]
  };

  const aplicar = () => {
    if (!estado) return;
    const fonte = map.getSource(ID_FONTE);
    if (fonte) {
      fonte.setData(dados);
    } else {
      map.addSource(ID_FONTE, { type: 'geojson', data: dados });
      map.addLayer({
        id: ID_BORDA,
        type: 'line',
        source: ID_FONTE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CORES[estado.fase].borda, 'line-width': 11, 'line-opacity': 0.28 }
      });
      map.addLayer({
        id: ID_LINHA,
        type: 'line',
        source: ID_FONTE,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': CORES[estado.fase].linha, 'line-width': 5, 'line-opacity': 1 }
      });
    }
    aplicarCorDaFase();
  };

  // Mapa já carregado: desenha agora. Senão, espera ele ficar pronto.
  if (estado.mapa.mapaPronto || map.isStyleLoaded()) aplicar();
  else map.once('idle', aplicar);
}

function aplicarCorDaFase() {
  if (!estado) return;
  try {
    if (estado.map.getLayer(ID_LINHA)) {
      estado.map.setPaintProperty(ID_LINHA, 'line-color', CORES[estado.fase].linha);
      estado.map.setPaintProperty(ID_BORDA, 'line-color', CORES[estado.fase].borda);
    }
    // Ao trocar de fase, apaga a linha antiga até chegar a nova
    if (!estado.rotaCoords) {
      const fonte = estado.map.getSource(ID_FONTE);
      if (fonte) fonte.setData({ type: 'FeatureCollection', features: [] });
    }
  } catch (e) {}
}

// ============================================================================
// CÂMERA
// ============================================================================
function enquadrarCarroEAlvo() {
  const alvo = alvoDaFase();
  const carro = estado.posicaoExibida;
  if (!carro) return;

  try {
    if (!alvo) {
      estado.map.easeTo({ center: carro, zoom: 16, duration: 900 });
      return;
    }
    const limites = new window.maplibregl.LngLatBounds(carro, carro).extend([alvo[1], alvo[0]]);
    estado.map.fitBounds(limites, {
      padding: { top: 110, bottom: 380, left: 50, right: 50 },
      maxZoom: 16.5,
      duration: 1000
    });
  } catch (e) {}
}

function seguirCarro() {
  if (!estado.posicaoExibida) return;
  if (Date.now() - estado.usuarioMexeuEm < PAUSA_CAMERA_MS) return;

  try {
    if (estado.fase === 'viagem') {
      // Em viagem, o mapa acompanha o carro
      estado.map.easeTo({ center: estado.ultimaPosicao ? [estado.ultimaPosicao.lng, estado.ultimaPosicao.lat] : estado.posicaoExibida, duration: 900 });
    } else {
      // Indo buscar: só reenquadra se o carro sair da tela
      const limites = estado.map.getBounds();
      if (!limites.contains(estado.posicaoExibida)) enquadrarCarroEAlvo();
    }
  } catch (e) {}
}

// ============================================================================
// AVISO PARA A TELA (tempo e distância)
// ============================================================================
function avisarTela(extra) {
  if (!estado) return;

  let minutos = null;
  if (Number.isFinite(estado.rotaDuracaoMin)) {
    // Desconta o tempo que já passou desde o último cálculo da rota
    const passouMin = (Date.now() - estado.rotaCalculadaEm) / 60000;
    minutos = Math.max(1, Math.round(estado.rotaDuracaoMin - passouMin));
  }

  try {
    estado.aoAtualizar({
      fase: estado.fase,
      minutos,
      distanciaKm: Number.isFinite(estado.rotaDistanciaKm) ? Number(estado.rotaDistanciaKm.toFixed(1)) : null,
      distanciaAteAlvoM: null,
      semSinal: false,
      temPosicao: Boolean(estado.ultimaPosicao),
      ...extra
    });
  } catch (e) {}
}

// ============================================================================
// CONTAS DE DISTÂNCIA
// ============================================================================
function coordsValidas(c) {
  return Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]));
}

// a e b no formato [lng, lat]
function distanciaM(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Menor distância do ponto até a linha da rota (aproximação plana, boa para poucos km)
function distanciaAteLinhaM(ponto, linha) {
  if (!Array.isArray(linha) || linha.length < 2) return Infinity;
  const latRef = ponto[1] * Math.PI / 180;
  const mx = 111320 * Math.cos(latRef);
  const my = 110540;
  const px = ponto[0] * mx;
  const py = ponto[1] * my;

  let menor = Infinity;
  for (let i = 0; i < linha.length - 1; i++) {
    const ax = linha[i][0] * mx, ay = linha[i][1] * my;
    const bx = linha[i + 1][0] * mx, by = linha[i + 1][1] * my;
    const dx = bx - ax, dy = by - ay;
    const comp2 = dx * dx + dy * dy;
    let t = comp2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / comp2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < menor) menor = d;
  }
  return menor;
}
1