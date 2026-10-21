// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const API_URL = 'https://huby.onrender.com';
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim (fallback inicial)
  let motoristaCoords = [...defaultCoords];
  let linhaRotaAtiva = null;
  let marcadorDestinoAtivo = null;

  // Inicia o mapa sem controlo de zoom e sem atribuição
  const map = L.map('mapaMotorista', {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultCoords, 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
  }).addTo(map);

  // Marcador do Motorista
  const markerMotorista = L.circleMarker(defaultCoords, {
    radius: 11,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1,
    weight: 3
  }).addTo(map);

  // Calibrações iniciais para prevenir quadrantes cinzentos
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
        if (linhaRotaAtiva) {
          const pontosAtuais = linhaRotaAtiva.getLatLngs();
          if (pontosAtuais.length > 0) {
            pontosAtuais[0] = L.latLng(motoristaCoords);
            linhaRotaAtiva.setLatLngs(pontosAtuais);
          }
        }
      },
      (err) => console.warn('Erro watchPosition:', err),
      { enableHighAccuracy: true, maximumAge: 5000 }
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
      if (linhaRotaAtiva) return; // Bloqueia filtro se estiver com corrida ativa
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
          <div class="job-badge ${badgeClasse}">${p.subTipoLabel || 'HUBy'} #${p.id}</div>
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
              <p>${p.destino} (${p.distancia || '1.0 km'})</p>
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

  let listaPedidosCache = [];

  async function carregarFilaDePedidos() {
    // Se já estiver com entrega em andamento, mantém o painel de navegação limpo
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
  // TRAÇAR A ROTA NO MAPA AO ACEITAR A CORRIDA (MODO NAVEGAÇÃO LIMPO)
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

    // 1. Limpa trajeto anterior
    if (linhaRotaAtiva) map.removeLayer(linhaRotaAtiva);
    if (marcadorDestinoAtivo) map.removeLayer(marcadorDestinoAtivo);

    // 2. Cria marcador de destino (Bandeira de Chegada Laranja)
    marcadorDestinoAtivo = L.circleMarker(pontoDest, {
      radius: 12,
      color: '#F97316',
      fillColor: '#F97316',
      fillOpacity: 1,
      weight: 3
    }).addTo(map);

    // 3. Traça a linha contínua e nítida da rota
    const pontosRota = [
      L.latLng(motoristaCoords[0], motoristaCoords[1]),
      L.latLng(pontoDest[0], pontoDest[1])
    ];

    linhaRotaAtiva = L.polyline(pontosRota, {
      color: '#10B981',
      weight: 6,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '8, 8'
    }).addTo(map);

    // 4. Força o redesenho do Leaflet para eliminar blocos cinzentos e enquadrar a rota
    map.invalidateSize();
    const bounds = L.latLngBounds([motoristaCoords, pontoDest]);
    map.fitBounds(bounds, { padding: [70, 70], animate: true });
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
      badgeRadar.style.borderColor = '#10B981';
      if (txtRadarStatus) txtRadarStatus.textContent = `Em rota para entrega #${id}`;
    }

    // 7. ISOLA O FEED: remove todos os outros pedidos e exibe apenas o painel de entrega
    if (feedChamadas) {
      feedChamadas.innerHTML = `
        <div class="job-card active-delivery-card" style="border-color: #10B981; background: rgba(16, 185, 129, 0.08); padding: 18px 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <span style="background: rgba(16, 185, 129, 0.2); color: #10B981; font-weight: 800; font-size: 11px; padding: 4px 10px; border-radius: 20px;">
              🧭 NAVEGAÇÃO ATIVA #${id}
            </span>
            <strong style="color: #10B981; font-size: 16px;">${pedido?.preco || 'R$ 16,10'}</strong>
          </div>
          
          <div style="font-size: 13px; color: #F8FAFC; margin-bottom: 4px; font-weight: 700;">
            Destino: ${pedido?.destino || 'Ponto selecionado'}
          </div>
          <p style="font-size: 11px; color: #94A3B8; margin-bottom: 14px;">
            Siga o trajeto traçado até o ponto de embarque/entrega.
          </p>

          <button type="button" onclick="finalizarCorrida('${id}')" style="
            width: 100%;
            background: linear-gradient(135deg, #10B981, #059669);
            color: #03251E;
            border: none;
            border-radius: 12px;
            padding: 13px;
            font-weight: 900;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
          ">
            ✅ Concluir Entrega
          </button>
        </div>
      `;
    }
  };

  window.finalizarCorrida = (id) => {
    if (linhaRotaAtiva) map.removeLayer(linhaRotaAtiva);
    if (marcadorDestinoAtivo) map.removeLayer(marcadorDestinoAtivo);
    linhaRotaAtiva = null;
    marcadorDestinoAtivo = null;

    if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas...';
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