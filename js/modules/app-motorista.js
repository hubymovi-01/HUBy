// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  const defaultCoords = [-8.358, -41.895]; // Coordenada base
  let motoristaCoords = [...defaultCoords];
  let linhaRotaAtiva = null;
  let marcadorDestinoAtivo = null;
  let pontoDestinoCoords = null;

  // Estado de ganhos do dia
  let corridasConcluidas = parseInt(localStorage.getItem('huby_driver_runs') || '0', 10);
  let ganhosHoje = parseFloat(localStorage.getItem('huby_driver_earnings') || '0.00');

  function atualizarPainelGanhos() {
    const txtGanhos = document.getElementById('txtGanhosHoje');
    const txtCorridas = document.getElementById('txtQtdCorridas');
    if (txtGanhos) {
      txtGanhos.textContent = `R$ ${ganhosHoje.toFixed(2).replace('.', ',')}`;
    }
    if (txtCorridas) {
      txtCorridas.textContent = `${corridasConcluidas} corrida${corridasConcluidas === 1 ? '' : 's'}`;
    }
  }

  atualizarPainelGanhos();

  // Inicia o mapa sem controlo de zoom e sem atribuição
  const map = L.map('mapaMotorista', {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultCoords, 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Marcador do Motorista com efeito de radar
  const markerMotorista = L.circleMarker(defaultCoords, {
    radius: 11,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1,
    weight: 3
  }).addTo(map);

  map.invalidateSize();
  setTimeout(() => map.invalidateSize(), 250);
  setTimeout(() => map.invalidateSize(), 600);
  window.addEventListener('resize', () => map.invalidateSize());

  function focarNoGPS(latitude, longitude, zoom = 16) {
    motoristaCoords = [latitude, longitude];
    markerMotorista.setLatLng(motoristaCoords);
    map.setView(motoristaCoords, zoom, { animate: true });
    setTimeout(() => map.invalidateSize(), 150);
  }

  // 1. GPS em tempo real do motorista
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        focarNoGPS(latitude, longitude, 16);
      },
      (err) => console.warn('GPS não autorizado:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        motoristaCoords = [latitude, longitude];
        markerMotorista.setLatLng(motoristaCoords);

        // Se estiver em rota e se mover, recalcula o traçado viário
        if (linhaRotaAtiva && pontoDestinoCoords) {
          tracarRotaViasUrbanas(motoristaCoords, pontoDestinoCoords, false);
        }
      },
      (err) => console.warn('Erro watchPosition:', err),
      { enableHighAccuracy: true, maximumAge: 4000 }
    );
  }

  document.getElementById('btnRecenterGPS')?.addEventListener('click', () => {
    if (linhaRotaAtiva && marcadorDestinoAtivo) {
      const bounds = L.latLngBounds([motoristaCoords, marcadorDestinoAtivo.getLatLng()]);
      map.fitBounds(bounds, { padding: [70, 70], animate: true });
    } else {
      focarNoGPS(motoristaCoords[0], motoristaCoords[1], 16);
    }
  });

  // Gestão de Status Online / Offline
  const btnToggleStatus = document.getElementById('btnToggleStatus');
  const txtStatusMotorista = document.getElementById('txtStatusMotorista');
  const badgeRadar = document.getElementById('badgeRadarStatus');
  const txtRadarStatus = document.getElementById('txtRadarStatus');
  const feedChamadas = document.getElementById('feedChamadas');
  let isOnline = true;
  let filtroAtual = 'todos';

  btnToggleStatus?.addEventListener('click', () => {
    isOnline = !isOnline;
    if (isOnline) {
      btnToggleStatus.className = 'btn-status-toggle online';
      txtStatusMotorista.textContent = 'ONLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
      if (badgeRadar) badgeRadar.style.display = 'flex';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-status-toggle offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'Modo pausa ativo';
      if (feedChamadas) {
        feedChamadas.innerHTML = `
          <div class="radar-empty-box">
            <div class="radar-empty-icon">⏸️</div>
            <div class="radar-empty-title">Modo Offline Ativo</div>
            <div class="radar-empty-sub">Fique online para voltar a receber solicitações em tempo real.</div>
          </div>
        `;
      }
    }
  });

  document.querySelectorAll('.filter-chip').forEach(pill => {
    pill.addEventListener('click', () => {
      if (linhaRotaAtiva) return;
      document.querySelectorAll('.filter-chip').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filtroAtual = pill.getAttribute('data-filter') || 'todos';
      carregarFilaDePedidos();
    });
  });

  function gerarCardHtml(p) {
    const isCargo = p.tipo === 'cargo';
    const isFlash = p.tipo === 'flash';
    const badgeClasse = isCargo ? 'cargo' : (isFlash ? 'flash' : 'viagem');

    return `
      <div class="job-card-premium" id="card-${p.id}">
        <div class="job-header-row">
          <span class="job-type-pill ${badgeClasse}">${p.subTipoLabel || 'HUBy'} #${p.id}</span>
          <span class="job-price-highlight">${p.preco}</span>
        </div>

        <div class="job-address-block">
          <div class="address-line-row">
            <span class="pin-indicator green"></span>
            <div class="address-text-desc">
              ${p.origem}
              <small>Ponto de partida do passageiro</small>
            </div>
          </div>
          <div class="address-line-row">
            <span class="pin-indicator orange"></span>
            <div class="address-text-desc">
              ${p.destino}
              <small>Distância estimada: ${p.distancia || '1.0 km'}</small>
            </div>
          </div>
        </div>

        <div class="job-actions-row">
          <button type="button" class="btn-reject-action" onclick="rejeitarPedido('${p.id}')">Recusar</button>
          <button type="button" class="btn-accept-action" onclick="aceitarPedido('${p.id}')">
            Aceitar Corrida ➔
          </button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="radar-empty-box">
        <div class="radar-empty-icon">📡</div>
        <div class="radar-empty-title">Radar de Chamadas Ativo</div>
        <div class="radar-empty-sub">Aguardando novas solicitações de passageiros e fretes nas proximidades...</div>
      </div>
    `;
  }

  let listaPedidosCache = [];

  async function carregarFilaDePedidos() {
    if (!feedChamadas || !isOnline || linhaRotaAtiva) return;

    let listaPedidos = [];

    try {
      const resposta = await fetch(`${API_URL}/api/pedidos?status=pendente`);
      if (resposta.ok) {
        const pedidosApi = await resposta.json();
        if (Array.isArray(pedidosApi) && pedidosApi.length > 0) {
          listaPedidos = pedidosApi.map(p => ({
            id: p.id,
            tipo: p.tipo,
            subTipoLabel: p.sub_tipo_label,
            origem: p.origem,
            destino: p.destino,
            coordsOrigem: p.coords_origem,
            coordsDestino: p.coords_destino,
            distancia: p.distancia,
            preco: p.preco,
            metodoPgto: p.metodo_pgto,
            horario: new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          }));
        }
      }
    } catch (e) {
      console.warn('Usando armazenamento local.', e);
    }

    if (listaPedidos.length === 0) {
      listaPedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    }

    listaPedidosCache = [...listaPedidos];

    if (filtroAtual !== 'todos') {
      listaPedidos = listaPedidos.filter(p => {
        if (filtroAtual === 'carro') return p.tipo === 'carro' || p.tipo === 'viagem';
        return p.tipo === filtroAtual;
      });
    }

    if (listaPedidos.length === 0) {
      feedChamadas.innerHTML = renderEmptyState();
      return;
    }

    feedChamadas.innerHTML = listaPedidos.map(p => gerarCardHtml(p)).join('');
  }

  // =========================================================================
  // MOTOR DE ROTAS POR RUAS COM OSRM (EVITA LINHA RETA)
  // =========================================================================
  async function tracarRotaViasUrbanas(origem, destino, ajustarZoom = true) {
    const [lat1, lon1] = origem;
    const [lat2, lon2] = destino;

    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.routes && data.routes.length > 0) {
        const trajetoCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

        if (linhaRotaAtiva) {
          map.removeLayer(linhaRotaAtiva);
        }

        linhaRotaAtiva = L.polyline(trajetoCoords, {
          color: '#10B981',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(map);

        if (ajustarZoom) {
          map.fitBounds(linhaRotaAtiva.getBounds(), { padding: [60, 60] });
        }
        return;
      }
    } catch (err) {
      console.warn('OSRM indisponível, usando traçado auxiliar:', err);
    }

    if (linhaRotaAtiva) map.removeLayer(linhaRotaAtiva);
    linhaRotaAtiva = L.polyline([origem, destino], {
      color: '#10B981',
      weight: 5,
      dashArray: '6, 8'
    }).addTo(map);

    if (ajustarZoom) {
      map.fitBounds(linhaRotaAtiva.getBounds(), { padding: [60, 60] });
    }
  }

  // =========================================================================
  // ACEITAR CORRIDA E INICIAR NAVEGAÇÃO REAL
  // =========================================================================
  window.aceitarPedido = async (id) => {
    const pedido = listaPedidosCache.find(p => String(p.id) === String(id));

    let pontoDest = null;
    if (pedido?.coordsDestino && Array.isArray(pedido.coordsDestino)) {
      pontoDest = pedido.coordsDestino;
    } else if (pedido?.destino && pedido.destino.includes('(')) {
      const partes = pedido.destino.split('(')[1]?.replace(')', '').split(',');
      if (partes && partes.length === 2) {
        pontoDest = [parseFloat(partes[0].trim()), parseFloat(partes[1].trim())];
      }
    }

    if (!pontoDest || isNaN(pontoDest[0])) {
      pontoDest = [motoristaCoords[0] + 0.007, motoristaCoords[1] + 0.007];
    }

    pontoDestinoCoords = pontoDest;

    // 1. Limpa trajeto anterior
    if (linhaRotaAtiva) map.removeLayer(linhaRotaAtiva);
    if (marcadorDestinoAtivo) map.removeLayer(marcadorDestinoAtivo);

    // 2. Cria marcador de destino (Bandeira de Chegada Laranja)
    marcadorDestinoAtivo = L.circleMarker(pontoDest, {
      radius: 12,
      color: '#FF6B00',
      fillColor: '#FF6B00',
      fillOpacity: 1,
      weight: 3
    }).addTo(map);

    // 3. Traça a rota viária real seguindo as ruas da cidade
    await tracarRotaViasUrbanas(motoristaCoords, pontoDest, true);

    // 4. Força atualização do layout Leaflet
    map.invalidateSize();
    setTimeout(() => map.invalidateSize(), 250);

    // 5. Atualiza no servidor
    try {
      await fetch(`${API_URL}/api/pedidos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus: 'em_andamento' })
      });
    } catch (e) {}

    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => String(p.id) !== String(id));
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    // 6. Atualiza o badge superior
    if (badgeRadar) {
      if (txtRadarStatus) txtRadarStatus.textContent = `Em rota para entrega #${id}`;
    }

    // 7. Isola o feed e exibe o card de navegação executiva
    if (feedChamadas) {
      feedChamadas.innerHTML = `
        <div class="active-navigation-card">
          <div class="nav-header-row">
            <span class="nav-status-badge">🧭 NAVEGAÇÃO ATIVA #${id}</span>
            <span class="nav-price">${pedido?.preco || 'R$ 16,10'}</span>
          </div>
          
          <div class="nav-destination-title">
            Destino: ${pedido?.destino || 'Ponto selecionado'}
          </div>
          <small style="color: #94A3B8; font-size: 11px;">
            Siga a rota traçada no mapa por vias pavimentadas.
          </small>

          <button type="button" class="btn-complete-delivery" onclick="finalizarCorrida('${id}', '${pedido?.preco || 'R$ 16,10'}')">
            ✅ Concluir Corrida
          </button>
        </div>
      `;
    }
  };

  window.finalizarCorrida = (id, precoTexto = 'R$ 0,00') => {
    if (linhaRotaAtiva) map.removeLayer(linhaRotaAtiva);
    if (marcadorDestinoAtivo) map.removeLayer(marcadorDestinoAtivo);
    linhaRotaAtiva = null;
    marcadorDestinoAtivo = null;
    pontoDestinoCoords = null;

    // Atualiza saldo acumulado
    const valorNumerico = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0;
    ganhosHoje += valorNumerico;
    corridasConcluidas += 1;

    localStorage.setItem('huby_driver_earnings', ganhosHoje.toFixed(2));
    localStorage.setItem('huby_driver_runs', corridasConcluidas.toString());
    atualizarPainelGanhos();

    if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
    map.setView(motoristaCoords, 16, { animate: true });
    setTimeout(() => map.invalidateSize(), 200);

    carregarFilaDePedidos();
  };

  window.rejeitarPedido = async (id) => {
    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => String(p.id) !== String(id));
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.remove();
      carregarFilaDePedidos();
    }
  };

  setInterval(() => {
    if (isOnline && !linhaRotaAtiva) carregarFilaDePedidos();
  }, 6000);

  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline && !linhaRotaAtiva) {
        carregarFilaDePedidos();
      }
    };
  } catch (err) {}

  carregarFilaDePedidos();
});