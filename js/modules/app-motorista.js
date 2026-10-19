// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  // Coordenadas de contingência (caso o usuário negue o GPS)
  const defaultCoords = [-7.7735, -42.2472];
  let motoristaCoords = [...defaultCoords];

  // Inicia o mapa inicialmente nas coordenadas padrão
  const map = L.map('mapaMotorista', {
    zoomControl: false
  }).setView(defaultCoords, 15);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Ícone/marcador de posição do motorista
  const markerMotorista = L.circleMarker(defaultCoords, {
    radius: 10,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1,
    weight: 3
  }).addTo(map);

  // Invalidação imediata do mapa para evitar blocos cinzas
  map.invalidateSize();
  setTimeout(() => map.invalidateSize(), 250);
  setTimeout(() => map.invalidateSize(), 600);
  window.addEventListener('resize', () => map.invalidateSize());

  // =========================================================================
  // GEOLOCALIZAÇÃO IMEDIATA E CONTÍNUA (SEMPRE NA POSIÇÃO REAL DO MOTORISTA)
  // =========================================================================
  function focarNoGPS(latitude, longitude, zoom = 16) {
    motoristaCoords = [latitude, longitude];
    markerMotorista.setLatLng(motoristaCoords);
    map.setView(motoristaCoords, zoom, { animate: true });
    map.invalidateSize();
  }

  if ('geolocation' in navigator) {
    // 1. Captura imediata ao entrar na página
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        focarNoGPS(latitude, longitude, 16);
      },
      (err) => {
        console.warn('GPS não autorizado ou indisponível:', err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );

    // 2. Rastreamento ativo: se o motorista se mover, atualiza a posição
    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        motoristaCoords = [latitude, longitude];
        markerMotorista.setLatLng(motoristaCoords);
      },
      (err) => console.warn('Erro ao seguir GPS:', err),
      {
        enableHighAccuracy: true,
        maximumAge: 5000
      }
    );
  }

  // Botão flutuante de recentralizar GPS
  document.getElementById('btnRecenterGPS')?.addEventListener('click', () => {
    focarNoGPS(motoristaCoords[0], motoristaCoords[1], 16);
  });

  // =========================================================================
  // GESTÃO DO RADAR E DOS PEDIDOS
  // =========================================================================
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
      btnToggleStatus.className = 'btn-toggle-online status-online';
      txtStatusMotorista.textContent = 'ONLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas...';
      if (badgeRadar) badgeRadar.style.display = 'flex';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-toggle-online status-offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = '⏸️ Modo pausa ativo';
      if (feedChamadas) {
        feedChamadas.innerHTML = `
          <div class="empty-jobs-state">
            <div class="empty-radar-icon">⏸️</div>
            <div class="empty-title">Modo Offline Ativo</div>
            <div class="empty-sub">Fique online para voltar a receber corridas e fretes.</div>
          </div>
        `;
      }
    }
  });

  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filtroAtual = pill.getAttribute('data-filter') || 'todos';
      carregarFilaDePedidos();
    });
  });

  function gerarCardHtml(p) {
    const isCargo = p.tipo === 'cargo';
    const isFlash = p.tipo === 'flash';
    const badgeClasse = isCargo ? 'cargo' : (isFlash ? 'flash' : 'viagem');
    const btnClasse = isCargo ? 'cargo-btn' : 'emerald-btn';

    return `
      <div class="job-card" id="card-${p.id}">
        <div class="job-top">
          <div class="job-badge ${badgeClasse}">${p.subTipoLabel || 'HUBy'} • #${p.id}</div>
          <div class="job-distance">📍 ${p.horario || 'Agora'}</div>
        </div>

        <div class="job-body">
          <div class="job-route-line">
            <div class="route-point">
              <span class="dot-indicator green"></span>
              <p>${p.origem}</p>
            </div>
            <div class="route-point">
              <span class="dot-indicator orange"></span>
              <p>${p.destino} (${p.distancia})</p>
            </div>
          </div>

          <div class="job-pricing">
            <span class="price-tag">${p.preco}</span>
            <span class="split-info">${(p.metodoPgto || 'Pix').toUpperCase()}</span>
          </div>
        </div>

        <div class="job-actions">
          <button type="button" class="btn-job-reject" onclick="rejeitarPedido('${p.id}')">Recusar</button>
          <button type="button" class="btn-job-accept ${btnClasse}" onclick="aceitarPedido('${p.id}')">Aceitar Corrida</button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="empty-jobs-state">
        <div class="empty-radar-icon">📡</div>
        <div class="empty-title">Radar de Chamadas Ativo</div>
        <div class="empty-sub">Aguardando novas solicitações de passageiros e fretes nas proximidades...</div>
      </div>
    `;
  }

  async function carregarFilaDePedidos() {
    if (!feedChamadas || !isOnline) return;

    let listaPedidos = [];

    // 1. Consulta Render / Neon
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

    // 2. Fallback local
    if (listaPedidos.length === 0) {
      listaPedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    }

    // 3. Filtro
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

  window.aceitarPedido = async (id) => {
    try {
      await fetch(`${API_URL}/api/pedidos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus: 'em_andamento' })
      });
    } catch (e) {}

    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.innerHTML = `<div style="text-align:center; padding:14px; font-weight:800; color:#10B981;">🚀 Corrida #${id} Aceita! Iniciando rota...</div>`;
      setTimeout(() => {
        card.remove();
        carregarFilaDePedidos();
      }, 2000);
    }
  };

  window.rejeitarPedido = async (id) => {
    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.remove();
      carregarFilaDePedidos();
    }
  };

  // Polling a cada 6s
  setInterval(() => {
    if (isOnline) carregarFilaDePedidos();
  }, 6000);

  // BroadcastChannel
  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline) {
        carregarFilaDePedidos();
      }
    };
  } catch (err) {}

  carregarFilaDePedidos();
});