// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim
  const map = L.map('mapaMotorista', {
    zoomControl: false
  }).setView(defaultCoords, 14);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Azulejos do OpenStreetMap com filtro Dark Mode
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Marcador da posição atual do motorista
  L.circleMarker(defaultCoords, {
    radius: 9,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1
  }).addTo(map);

  // Controle de Status Online / Offline
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
      btnToggleStatus.className = 'btn-status-toggle status-online';
      txtStatusMotorista.textContent = 'ONLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'Radar ativo • A procurar corridas e fretes...';
      if (badgeRadar) badgeRadar.style.display = 'flex';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-status-toggle status-offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = '⏸️ Modo pausa ativo. Fique online para receber pedidos.';
      if (feedChamadas) {
        feedChamadas.innerHTML = `
          <div class="empty-jobs-state">
            <div class="empty-radar-icon" style="border-color: rgba(239, 68, 68, 0.3); color: #EF4444;">⏸️</div>
            <div class="empty-title">Modo Offline Ativo</div>
            <div class="empty-sub">Ative o botão ONLINE no topo para voltar a receber solicitações.</div>
          </div>
        `;
      }
    }
  });

  // Filtros de Categoria (Todos, Carro, Flash, Cargo)
  document.querySelectorAll('.tab-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.tab-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filtroAtual = chip.getAttribute('data-filter') || 'todos';
      carregarFilaDePedidos();
    });
  });

  // Construtor do card HTML da chamada (Corrigido)
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

  // Componente de Estado Vazio Profissional
  function renderEmptyState() {
    return `
      <div class="empty-jobs-state">
        <div class="empty-radar-icon">📡</div>
        <div class="empty-title">Radar de Chamadas Ativo</div>
        <div class="empty-sub">Aguardando novas solicitações de passageiros e fretes nas proximidades...</div>
      </div>
    `;
  }

  // Carrega e desenha os pedidos (API Neon na Vercel + Fallback LocalStorage)
  async function carregarFilaDePedidos() {
    if (!feedChamadas || !isOnline) return;

    let listaPedidos = [];

    // 1. Tenta buscar da API na nuvem (Vercel/Neon)
    try {
      const resposta = await fetch('/api/pedidos?status=pendente');
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
      console.warn('API /api/pedidos em modo estático local.', e);
    }

    // 2. Se a API estiver vazia ou offline, busca da fila persistente do localStorage
    if (listaPedidos.length === 0) {
      listaPedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    }

    // 3. Aplica o filtro de abas (todos, viagem/carro, flash, cargo)
    if (filtroAtual !== 'todos') {
      listaPedidos = listaPedidos.filter(p => {
        if (filtroAtual === 'carro') return p.tipo === 'carro' || p.tipo === 'viagem';
        return p.tipo === 'flash' ? p.tipo === 'flash' : p.tipo === 'cargo';
      });
    }

    // 4. Renderiza
    if (listaPedidos.length === 0) {
      feedChamadas.innerHTML = renderEmptyState();
      return;
    }

    feedChamadas.innerHTML = listaPedidos.map(p => gerarCardHtml(p)).join('');
  }

  // Ações de aceite e recusa globais
  window.aceitarPedido = async (id) => {
    try {
      await fetch('/api/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus: 'em_andamento' })
      });
    } catch (e) {
      console.warn('API indisponível para PATCH.', e);
    }

    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.innerHTML = `<div style="text-align:center; padding:16px; font-weight:800; color:#10B981;">🚀 Corrida #${id} Aceita! Iniciando rota no GPS...</div>`;
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

  // Canal de escuta em tempo real
  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline) {
        carregarFilaDePedidos();
      }
    };
  } catch (err) {
    console.warn('BroadcastChannel não suportado.', err);
  }

  // Carregamento inicial
  carregarFilaDePedidos();
});