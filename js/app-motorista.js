/**
 * HUBy 2.0 - Central Profissional do Motorista Parceiro (js/app-motorista.js)
 */

import { API_URL, sonsHUBy } from './config.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

const estado = {
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_motorista_id') || localStorage.getItem('huby_user_id') || null,
  motoristaNome: 'Carol',
  mapa: null,
  markerVeiculo: null,
  linhaRota: null,
  markerOrigem: null,
  markerDestino: null,
  coords: [-8.3580, -42.2460],
  statusOnline: true,
  saldoCarteira: 1012.07,
  intervalRadar: null,
  intervalChat: null,
  intervalGpsSocket: null,
  socket: null,
  pedidosIgnorados: new Set(),
  pedidoEmInspecao: null,
  pedidoAtivo: null,
  faseViagem: 'buscar_passageiro'
};

function obterHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = estado.token || localStorage.getItem('huby_token');
  if (token && token !== 'null') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ============================================================================
// 1. INICIALIZAÇÃO DO MAPA, SOCKET E ROTEAMENTO OSRM
// ============================================================================
function inicializarSocket() {
  if (typeof io !== 'undefined') {
    estado.socket = io(API_URL);

    // Ouve confirmação global de encerramento da corrida via Socket
    estado.socket.on('corrida_finalizada', (dados) => {
      if (estado.pedidoAtivo && String(dados.pedidoId) === String(estado.pedidoAtivo.id)) {
        fecharModaisPagamento();
        alert('🎉 Pagamento confirmado pelo Mercado Pago! Corrida concluída.');
        sonsHUBy.tocarMetaBatida();
        concluirLimpezaPosCorrida();
      }
    });
  }
}

function inicializarMapa() {
  const container = document.getElementById('mapaMotorista');
  if (!container) return;

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  try {
    estado.mapa = L.map('mapaMotorista', {
      zoomControl: false,
      attributionControl: false
    }).setView(estado.coords, 15);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarro = L.divIcon({
      className: 'huby-driver-pin',
      html: '<div style="width:38px;height:38px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(16,185,129,0.9);font-size:19px;">🚘</div>',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarro }).addTo(estado.mapa);

    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 300);

    configurarRecursosInteligentes(estado.mapa, estado.token);

    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        estado.coords = [latitude, longitude];
        if (estado.mapa && estado.markerVeiculo) {
          estado.markerVeiculo.setLatLng([latitude, longitude]);
        }
        if (estado.socket && estado.pedidoAtivo) {
          estado.socket.emit('posicao_motorista', {
            pedidoId: estado.pedidoAtivo.id,
            lat: latitude,
            lng: longitude
          });
        }
      }, null, { enableHighAccuracy: true });
    }
  } catch (err) {
    console.error('Erro ao iniciar mapa:', err);
  }
}

async function tracarRotaRealRuas(origem, destino, cor = '#10B981') {
  if (!estado.mapa) return;

  if (estado.linhaRota) {
    estado.mapa.removeLayer(estado.linhaRota);
    estado.linhaRota = null;
  }

  const [latOrig, lngOrig] = origem;
  const [latDest, lngDest] = destino;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lngOrig},${latOrig};${lngDest},${latDest}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coordenadasCurvas = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

      estado.linhaRota = L.polyline(coordenadasCurvas, {
        color: cor,
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(estado.mapa);

      estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });
      return;
    }
  } catch (err) {
    console.warn('Falha no OSRM, aplicando rota direta:', err);
  }

  estado.linhaRota = L.polyline([origem, destino], {
    color: cor,
    weight: 5,
    dashArray: '8, 8',
    opacity: 0.9
  }).addTo(estado.mapa);

  estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });
}

// ============================================================================
// 2. RADAR DE CHAMADAS COM DISPENSAR (✕)
// ============================================================================
function alternarStatusOnline() {
  const btn = document.getElementById('btnToggleStatusOnline');
  if (!btn) return;

  estado.statusOnline = !estado.statusOnline;

  if (estado.statusOnline) {
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.borderColor = 'var(--emerald)';
    btn.style.color = 'var(--emerald)';
    btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
    sonsHUBy.tocarSucessoAceite();
    iniciarRadar();
  } else {
    btn.style.background = '#1F2937';
    btn.style.borderColor = 'rgba(255,255,255,0.12)';
    btn.style.color = '#94A3B8';
    btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
    pararRadar();
  }
}

function iniciarRadar() {
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);
  buscarChamadas();
  estado.intervalRadar = setInterval(buscarChamadas, 3500);
}

function pararRadar() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  const lista = document.getElementById('listaChamadasPendentes');
  if (lista && !estado.pedidoAtivo && !estado.pedidoEmInspecao) {
    lista.innerHTML = '<div class="dock-empty">Você está offline. Fique online para receber corridas.</div>';
  }
}

async function buscarChamadas() {
  if (!estado.statusOnline || estado.pedidoAtivo || estado.pedidoEmInspecao) return;
  try {
    const res = await fetch(`${API_URL}/api/pedidos/pendentes`, { headers: obterHeaders() });
    if (!res.ok) return;
    const chamadas = await res.json();
    renderizarChamadas(chamadas);
  } catch (e) { }
}

function renderizarChamadas(chamadas = []) {
  const container = document.getElementById('listaChamadasPendentes');
  if (!container || estado.pedidoAtivo || estado.pedidoEmInspecao) return;

  const chamadasVisiveis = chamadas.filter(p => !estado.pedidosIgnorados.has(String(p.id)));

  if (!chamadasVisiveis.length) {
    container.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  container.innerHTML = chamadasVisiveis.map(ped => {
    const valorBruto = Number(ped.valor_total || 0);
    const repasse = (valorBruto * 0.85).toFixed(2).replace('.', ',');
    const km = Number(ped.distancia_km || 1.0).toFixed(1);
    const destTexto = ped.destino_endereco || ped.destino || 'Destino informado';
    const origTexto = ped.origem_endereco || ped.origem || 'Local do passageiro';
    const tempoEstimadoMin = Math.round(km * 2.2);

    return `
      <div style="position: relative; background: rgba(18, 24, 38, 0.96); border: 1.5px solid var(--border-dark); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
        
        <button type="button" class="btn-dispensar-pedido" data-id="${ped.id}" title="Dispensar corrida"
          style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-dark); color: var(--text-sec); width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; cursor: pointer;">
          ✕
        </button>

        <div style="display: flex; justify-content: space-between; align-items: center; padding-right: 32px;">
          <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
            ${(ped.sub_tipo_label || ped.tipo || 'HUBy Carro').toUpperCase()}
          </span>
          <strong style="font-size: 20px; color: var(--emerald); font-weight: 900;">
            R$ ${repasse}
          </strong>
        </div>

        <div style="font-size: 12px; color: #FFF; line-height: 1.4;">
          <div style="color: #94A3B8; margin-bottom: 2px;">🟢 <strong>Origem:</strong> ${origTexto}</div>
          <div>📍 <strong>Destino:</strong> ${destTexto}</div>
          <div style="font-size: 11px; color: var(--text-sec); margin-top: 4px;">
            📏 Distância: <strong>${km} km</strong> • ~${tempoEstimadoMin} min
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 2px;">
          <button type="button" class="btn-visualizar-rota"
            data-id="${ped.id}" 
            data-orig-lat="${ped.origem_lat || ''}" data-orig-lng="${ped.origem_lng || ''}" data-orig="${origTexto}"
            data-dest-lat="${ped.destino_lat || ''}" data-dest-lng="${ped.destino_lng || ''}" data-dest="${destTexto}" 
            data-repasse="${repasse}" data-km="${km}" data-total="${valorBruto}"
            style="background: rgba(56,189,248,0.18); border: 1px solid var(--blue); color: var(--blue); font-weight: 800; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            🗺️ Ver Rota
          </button>
          <button type="button" class="btn-confirmar-imediato"
            data-id="${ped.id}" 
            data-orig-lat="${ped.origem_lat || ''}" data-orig-lng="${ped.origem_lng || ''}" data-orig="${origTexto}"
            data-dest-lat="${ped.destino_lat || ''}" data-dest-lng="${ped.destino_lng || ''}" data-dest="${destTexto}" 
            data-repasse="${repasse}" data-km="${km}" data-total="${valorBruto}"
            style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            ⚡ Aceitar
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-dispensar-pedido').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      estado.pedidosIgnorados.add(String(id));
      renderizarChamadas(chamadas);
    });
  });

  container.querySelectorAll('.btn-visualizar-rota').forEach(btn => {
    btn.addEventListener('click', () => inspecionarRotaPrevia(btn));
  });

  container.querySelectorAll('.btn-confirmar-imediato').forEach(btn => {
    btn.addEventListener('click', () => aceitarCorridaDefinitiva(btn));
  });
}

// ============================================================================
// 3. PRÉ-VISUALIZAÇÃO DE ROTA REAL PELAS RUAS
// ============================================================================
function extrairDadosDoBotao(btn) {
  return {
    id: btn.getAttribute('data-id'),
    origLat: parseFloat(btn.getAttribute('data-orig-lat')) || (estado.coords[0] + 0.003),
    origLng: parseFloat(btn.getAttribute('data-orig-lng')) || (estado.coords[1] + 0.003),
    origNome: btn.getAttribute('data-orig'),
    destLat: parseFloat(btn.getAttribute('data-dest-lat')) || (estado.coords[0] + 0.009),
    destLng: parseFloat(btn.getAttribute('data-dest-lng')) || (estado.coords[1] + 0.009),
    destNome: btn.getAttribute('data-dest'),
    repasse: btn.getAttribute('data-repasse'),
    km: btn.getAttribute('data-km'),
    valorTotal: parseFloat(btn.getAttribute('data-total')) || 0
  };
}

async function inspecionarRotaPrevia(btn) {
  const dados = extrairDadosDoBotao(btn);
  estado.pedidoEmInspecao = dados;
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  limparRotasMapa();

  const coordsOrigem = [dados.origLat, dados.origLng];
  const coordsDestino = [dados.destLat, dados.destLng];

  estado.markerOrigem = L.marker(coordsOrigem, {
    icon: L.divIcon({ html: '<div style="font-size:24px;">🟢</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
  }).addTo(estado.mapa);

  estado.markerDestino = L.marker(coordsDestino, {
    icon: L.divIcon({ html: '<div style="font-size:24px;">🏁</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
  }).addTo(estado.mapa);

  await tracarRotaRealRuas(estado.coords, coordsDestino, '#F59E0B');

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--amber); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--amber); background: rgba(245,158,11,0.15); padding: 4px 10px; border-radius: 8px;">
          🔍 ROTA EM ANÁLISE
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 12px; color: #FFF; line-height: 1.4;">
        <div style="color: #94A3B8;">🟢 <strong>Buscar em:</strong> ${dados.origNome}</div>
        <div style="margin-top: 3px;">📍 <strong>Destino:</strong> ${dados.destNome}</div>
        <div style="font-size: 11px; color: var(--text-sec); margin-top: 4px;">
          📏 Trajeto total: <strong>${dados.km} km</strong>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin-top: 4px;">
        <button type="button" id="btnCancelarInspecao"
          style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-dark); color: #FFF; font-weight: 700; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✕ Voltar
        </button>
        <button type="button" id="btnConfirmarAposVisualizar"
          style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✅ Confirmar Corrida
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnCancelarInspecao')?.addEventListener('click', () => {
    limparRotasMapa();
    estado.pedidoEmInspecao = null;
    iniciarRadar();
  });

  document.getElementById('btnConfirmarAposVisualizar')?.addEventListener('click', () => {
    aceitarCorridaDefinitiva(null, dados);
  });
}

// ============================================================================
// 4. ACEITAR CORRIDA E FLUXO EM 2 FASES
// ============================================================================
async function aceitarCorridaDefinitiva(btn, dadosCache) {
  const dados = dadosCache || extrairDadosDoBotao(btn);

  try {
    const r = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ 
        motoristaId: estado.motoristaId,
        motoristaNome: estado.motoristaNome 
      })
    });

    const resJson = await r.json().catch(() => ({}));

    if (r.ok || resJson.sucesso) {
      sonsHUBy.tocarSucessoAceite();
      iniciarFaseBuscarPassageiro(dados);
    } else {
      alert(resJson.erro || 'Esta corrida já não está disponível.');
      limparRotasMapa();
      estado.pedidoEmInspecao = null;
      iniciarRadar();
    }
  } catch (err) {
    iniciarFaseBuscarPassageiro(dados);
  }
}

async function iniciarFaseBuscarPassageiro(dados) {
  estado.pedidoAtivo = dados;
  estado.pedidoEmInspecao = null;
  estado.faseViagem = 'buscar_passageiro';
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  limparRotasMapa();
  const coordsOrigem = [dados.origLat, dados.origLng];

  estado.markerOrigem = L.marker(coordsOrigem, {
    icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">👤</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
  }).addTo(estado.mapa);

  await tracarRotaRealRuas(estado.coords, coordsOrigem, '#38BDF8');

  const urlWaze = `https://waze.com/ul?ll=${dados.origLat},${dados.origLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.origLat},${dados.origLng}`;

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--blue); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
          🚗 A CAMINHO DO PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🟢 <strong>Embarque:</strong> <span style="color: #94A3B8;">${dados.origNome}</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Waze (Embarque)
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Maps (Embarque)
        </a>
      </div>

      <button type="button" id="btnPassageiroEmbarcou"
        style="width: 100%; background: #38BDF8; border: none; color: #000; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
        📍 Cheguei / Passageiro a Bordo
      </button>
    </div>
  `;

  document.getElementById('btnPassageiroEmbarcou')?.addEventListener('click', () => confirmarEmbarqueEIrAoDestino(dados));
}

async function confirmarEmbarqueEIrAoDestino(dados) {
  try {
    await fetch(`${API_URL}/api/pedidos/${dados.id}/embarque`, {
      method: 'PUT',
      headers: obterHeaders()
    });
  } catch (e) { }

  estado.faseViagem = 'a_caminho_destino';
  sonsHUBy.tocarSucessoAceite();

  limparRotasMapa();
  const coordsDestino = [dados.destLat, dados.destLng];

  estado.markerDestino = L.marker(coordsDestino, {
    icon: L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #10B981);">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
  }).addTo(estado.mapa);

  await tracarRotaRealRuas(estado.coords, coordsDestino, '#10B981');

  const urlWaze = `https://waze.com/ul?ll=${dados.destLat},${dados.destLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.destLat},${dados.destLng}`;

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 EM VIAGEM COM PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        🏁 <strong>Destino Final:</strong> <span style="color: #94A3B8;">${dados.destNome}</span>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Waze (Destino)
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Maps (Destino)
        </a>
      </div>

      <button type="button" id="btnConcluirViagemAtiva"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
        🏁 Cheguei ao Destino / Finalizar
      </button>
    </div>
  `;

  document.getElementById('btnConcluirViagemAtiva')?.addEventListener('click', () => abrirModalOpcoesPagamento(dados));
}

// ============================================================================
// 4.1 LIQUIDAÇÃO INTELIGENTE (DINHEIRO, MAQUININHA OU PIX MERCADO PAGO)
// ============================================================================
function abrirModalOpcoesPagamento(dados) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const lblValor = document.getElementById('lblValorTotalPagamentoMotorista');

  const valorBruto = dados.valorTotal > 0 ? dados.valorTotal : (parseFloat(String(dados.repasse).replace(',', '.')) / 0.85);

  if (lblValor) {
    lblValor.textContent = `R$ ${valorBruto.toFixed(2).replace('.', ',')}`;
  }

  if (modal) modal.style.display = 'flex';

  // Configura listeners dos botões de liquidação
  const btnDinheiro = document.getElementById('btnPagarDinheiro');
  const btnMaquininha = document.getElementById('btnPagarMaquininha');
  const btnPixMP = document.getElementById('btnPagarPixMP');
  const btnCancelar = document.getElementById('btnCancelarModalPagamento');

  btnDinheiro.onclick = () => processarLiquidacao(dados.id, 'dinheiro');
  btnMaquininha.onclick = () => processarLiquidacao(dados.id, 'cartao_maquininha');
  btnPixMP.onclick = () => processarLiquidacao(dados.id, 'pix_mp');
  btnCancelar.onclick = () => {
    if (modal) modal.style.display = 'none';
  };
}

async function processarLiquidacao(pedidoId, formaPagamento) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/finalizar-liquidacao`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ forma_pagamento: formaPagamento })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao processar pagamento.');

    if (modal) modal.style.display = 'none';

    if (formaPagamento === 'pix_mp') {
      exibirQrCodePixMotorista(data.pix);
    } else {
      alert('✅ Corrida encerrada com sucesso! A taxa da plataforma (15%) foi descontada da carteira.');
      sonsHUBy.tocarMetaBatida();
      concluirLimpezaPosCorrida();
    }
  } catch (err) {
    alert(err.message);
  }
}

function exibirQrCodePixMotorista(pix) {
  const modalPix = document.getElementById('modalExibicaoPixMotorista');
  const imgQr = document.getElementById('imgQrCodePixMotorista');
  const lblValor = document.getElementById('lblValorPixMotorista');
  const btnFechar = document.getElementById('btnFecharPixMotorista');

  if (lblValor) lblValor.textContent = `R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}`;
  if (imgQr) imgQr.src = `data:image/png;base64,${pix.qr_code_base64}`;

  if (modalPix) modalPix.style.display = 'flex';

  btnFechar.onclick = () => {
    if (modalPix) modalPix.style.display = 'none';
  };
}

function fecharModaisPagamento() {
  const modal1 = document.getElementById('modalEscolhaPagamentoMotorista');
  const modal2 = document.getElementById('modalExibicaoPixMotorista');
  if (modal1) modal1.style.display = 'none';
  if (modal2) modal2.style.display = 'none';
}

function concluirLimpezaPosCorrida() {
  limparRotasMapa();
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';

  estado.pedidoAtivo = null;
  carregarPerfil();
  iniciarRadar();
}

function limparRotasMapa() {
  if (estado.linhaRota && estado.mapa) {
    estado.mapa.removeLayer(estado.linhaRota);
    estado.linhaRota = null;
  }
  if (estado.markerOrigem && estado.mapa) {
    estado.mapa.removeLayer(estado.markerOrigem);
    estado.markerOrigem = null;
  }
  if (estado.markerDestino && estado.mapa) {
    estado.mapa.removeLayer(estado.markerDestino);
    estado.markerDestino = null;
  }
}

// ============================================================================
// 5. SISTEMA DE CHAT INTEGRADO
// ============================================================================
function configurarChat() {
  const modalChat = document.getElementById('modalChatCorrida');
  const btnAbrir = document.getElementById('btnAbrirChat');
  const btnFechar = document.getElementById('btnFecharChat');
  const btnEnviar = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  btnAbrir?.addEventListener('click', () => {
    if (modalChat) {
      modalChat.style.display = 'flex';
      sincronizarChat();
      if (!estado.intervalChat) estado.intervalChat = setInterval(sincronizarChat, 3000);
    }
  });

  btnFechar?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'none';
    if (estado.intervalChat) {
      clearInterval(estado.intervalChat);
      estado.intervalChat = null;
    }
  });

  btnEnviar?.addEventListener('click', enviarMensagemChat);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
  });
}

async function sincronizarChat() {
  if (!estado.pedidoAtivo) return;
  const area = document.getElementById('chatAreaMensagens');
  if (!area) return;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAtivo.id}/chat`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const msgs = await res.json();

    area.innerHTML = msgs.map(m => {
      const souEu = m.remetente_id === estado.motoristaId;
      return `
        <div style="align-self: ${souEu ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${souEu ? 'var(--emerald)' : '#1F2937'}; color: ${souEu ? '#02261C' : '#FFF'}; font-weight: 600; padding: 8px 12px; border-radius: 12px; font-size: 13px;">
          <small style="display:block; font-size:9px; opacity:0.8; margin-bottom:2px;">${m.remetente_nome || 'Mensagem'}</small>
          ${m.mensagem}
        </div>
      `;
    }).join('');
    area.scrollTop = area.scrollHeight;
  } catch (e) { }
}

async function enviarMensagemChat() {
  const input = document.getElementById('inputChatMsg');
  const msg = input?.value?.trim();
  if (!msg || !estado.pedidoAtivo) return;

  try {
    input.value = '';
    await fetch(`${API_URL}/api/pedidos/${estado.pedidoAtivo.id}/chat`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ mensagem: msg })
    });
    sincronizarChat();
  } catch (e) { }
}

// ============================================================================
// 6. GESTÃO COMPLETA DE SAQUES PIX BANCÁRIOS COM ATALHOS RÁPIDOS
// ============================================================================
function configurarEventosSaque() {
  const modalSaque = document.getElementById('modalSaquePix');
  const btnAbrir = document.getElementById('btnAbrirModalSaque');
  const btnFechar = document.getElementById('btnFecharModalSaque');
  const btnCancelar = document.getElementById('btnCancelarSaqueModal');
  const btnConfirmar = document.getElementById('btnConfirmarSaquePix');
  const inputValor = document.getElementById('saqueValor');
  const inputChave = document.getElementById('saqueChavePix');
  const selectTipo = document.getElementById('saqueTipoChave');
  const modalSaldoTexto = document.getElementById('modalSaldoTexto');
  const btnSacarTudo = document.getElementById('btnSacarTudo');

  document.querySelectorAll('.btn-fast-val').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (val && inputValor) {
        inputValor.value = val;
      }
    });
  });

  btnSacarTudo?.addEventListener('click', () => {
    if (inputValor) {
      inputValor.value = Math.max(0, estado.saldoCarteira).toFixed(2);
    }
  });

  function abrirModal() {
    if (!modalSaque) return;
    if (modalSaldoTexto) {
      modalSaldoTexto.textContent = `R$ ${Number(estado.saldoCarteira || 0).toFixed(2).replace('.', ',')}`;
    }
    const chaveSalva = localStorage.getItem('huby_motorista_pix') || '';
    if (chaveSalva && inputChave && !inputChave.value) {
      inputChave.value = chaveSalva;
    }
    modalSaque.style.display = 'flex';
  }

  function fecharModal() {
    if (modalSaque) modalSaque.style.display = 'none';
  }

  btnAbrir?.addEventListener('click', abrirModal);
  btnFechar?.addEventListener('click', fecharModal);
  btnCancelar?.addEventListener('click', fecharModal);

  modalSaque?.addEventListener('click', (e) => {
    if (e.target === modalSaque) fecharModal();
  });

  btnConfirmar?.addEventListener('click', async () => {
    const chave = inputChave?.value?.trim();
    const valor = parseFloat(inputValor?.value);
    const tipo = selectTipo?.value || 'pix';

    if (!chave) {
      alert('Por favor, informe a chave Pix para recebimento.');
      return;
    }

    if (!valor || valor <= 0) {
      alert('Informe um valor de saque válido.');
      return;
    }

    if (valor > estado.saldoCarteira) {
      alert(`Saldo insuficiente. O seu saldo disponível é de R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}.`);
      return;
    }

    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Enviando...';

    try {
      const motId = estado.motoristaId || localStorage.getItem('huby_motorista_id') || 'carol_01';
      const res = await fetch(`${API_URL}/api/carteira/motorista/${motId}/saque`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ valor, chave_pix: chave, tipo_chave: tipo })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao processar saque.');

      alert(`✅ ${data.mensagem || 'Solicitação de saque enviada para a administração!'}`);
      localStorage.setItem('huby_motorista_pix', chave);
      fecharModal();
      if (inputValor) inputValor.value = '';

      if (data.novoSaldo !== undefined) {
        estado.saldoCarteira = Number(data.novoSaldo);
      } else {
        estado.saldoCarteira -= valor;
      }

      const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
      const elSaldo = document.getElementById('saldoCarteiraValor');
      const elDrawerSaldo = document.getElementById('drawerSaldoValor');
      if (elSaldo) elSaldo.textContent = saldoTxt;
      if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

      carregarPerfil();
    } catch (err) {
      alert(err.message);
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Saque';
    }
  });
}

// ============================================================================
// 7. PERFIL, DRAWER E SALDO
// ============================================================================
async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/perfil`, { headers: obterHeaders() });
    if (!res.ok) return;
    const m = await res.json();

    if (m.id) {
      estado.motoristaId = m.id;
      estado.motoristaNome = m.nome || 'Carol';
      localStorage.setItem('huby_motorista_id', m.id);
    }

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    if (topNome) topNome.textContent = (m.nome || 'Carol').split(' ')[0];
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    estado.saldoCarteira = Number(m.saldo_carteira || 1012.07);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');

    if (drawerNome) drawerNome.textContent = m.nome || 'Carol';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'ABC1D23').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Onix';
    if (drawerDetalhes) {
      drawerDetalhes.textContent = `Cor: ${m.veiculo_cor || 'Prata'} • Ano: ${m.veiculo_ano || '2023'}`;
    }

    sincronizarExtratoDiario();
  } catch (e) { }
}

async function sincronizarExtratoDiario() {
  const containerExtrato = document.getElementById('drawerListaExtrato');
  const lblGanhosHoje = document.getElementById('lblGanhosHojeValor');
  const lblViagensHoje = document.getElementById('lblCorridasHojeQtd');

  try {
    const res = await fetch(`${API_URL}/api/motoristas/extrato`, { headers: obterHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const corridas = data.corridas || data.historico || [];

    let totalGanhos = 0;
    let qtdViagens = 0;

    if (corridas.length && containerExtrato) {
      containerExtrato.innerHTML = corridas.map(c => {
        const repasse = Number(c.repasse_liquido || c.valor_total * 0.85);
        totalGanhos += repasse;
        qtdViagens++;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-dark); font-size: 12px;">
            <div style="max-width: 65%;">
              <div style="color: #FFF; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${c.destino_endereco || 'Viagem Concluída'}
              </div>
              <small style="color: var(--text-sec); font-size: 10px;">${new Date(c.criado_em || c.concluido_em).toLocaleDateString('pt-BR')}</small>
            </div>
            <strong style="color: var(--emerald);">+ R$ ${repasse.toFixed(2).replace('.', ',')}</strong>
          </div>
        `;
      }).join('');
    }

    if (lblGanhosHoje) lblGanhosHoje.textContent = `R$ ${totalGanhos.toFixed(2).replace('.', ',')}`;
    if (lblViagensHoje) lblViagensHoje.textContent = `${qtdViagens} viagens`;
  } catch (e) { }
}

function registrarEventosUI() {
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', alternarStatusOnline);

  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');
  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
  });
  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };
  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  configurarChat();
  configurarEventosSaque();
}

document.addEventListener('DOMContentLoaded', () => {
  inicializarSocket();
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
  iniciarRadar();
});