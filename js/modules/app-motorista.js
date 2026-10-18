// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim
  const map = L.map('mapaMotorista', {
    zoomControl: false
  }).setView(defaultCoords, 14);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Azulejos do OpenStreetMap com filtro Dark Mode do global.css
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

  // Toggle Online/Offline
  const btnToggleStatus = document.getElementById('btnToggleStatus');
  const txtStatusMotorista = document.getElementById('txtStatusMotorista');
  const badgeRadar = document.getElementById('badgeRadarStatus');
  const feedChamadas = document.getElementById('feedChamadas');
  let isOnline = true;

  btnToggleStatus?.addEventListener('click', () => {
    isOnline = !isOnline;

    if (isOnline) {
      btnToggleStatus.className = 'btn-status-toggle status-online';
      txtStatusMotorista.textContent = 'ONLINE';
      badgeRadar.innerHTML = '<span class="radar-dot"></span> A rastrear corridas e fretes em Paes Landim...';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-status-toggle status-offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      badgeRadar.innerHTML = '⏸️ Modo pausa ativo. Fique online para receber pedidos.';
    }
  });

  // Construtor do card HTML da chamada
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

  // Carrega e desenha os pedidos (tenta via API segura do Neon na Vercel; fallback para localStorage)
  async function carregarFilaDePedidos() {
    if (!feedChamadas) return;

    try {
      const resposta = await fetch('/api/pedidos?status=pendente');
      if (resposta.ok) {
        const pedidosApi = await resposta.json();
        if (pedidosApi && pedidosApi.length > 0) {
          feedChamadas.innerHTML = pedidosApi.map(p => gerarCardHtml({
            id: p.id,
            tipo: p.tipo,
            subTipoLabel: p.sub_tipo_label,
            origem: p.origem,
            destino: p.destino,
            distancia: p.distancia,
            preco: p.preco,
            metodoPgto: p.metodo_pgto,
            horario: new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          })).join('');
          return;
        }
      }
    } catch (e) {
      console.warn('API /api/pedidos indisponível no momento, buscando do cache local.', e);
    }

    // Leitura local
    const pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    if (pedidosLocais.length === 0) {
      feedChamadas.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          Nenhum pedido pendente de momento.<br>Aguardando novas solicitações de passageiros...
        </div>
      `;
      return;
    }

    feedChamadas.innerHTML = pedidosLocais.map(p => gerarCardHtml(p)).join('');
  }

  // Ações de aceite e recusa globais
  window.aceitarPedido = async (id) => {
    // 1. Tenta atualizar status no banco Neon
    try {
      await fetch('/api/pedidos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus: 'em_andamento' })
      });
    } catch (e) {
      console.warn('Não foi possível persistir status na API.', e);
    }

    // 2. Remove do cache local
    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.innerHTML = `<div style="text-align:center; padding:16px; font-weight:800; color:#10B981;">🚀 Corrida #${id} Aceita! A rota foi enviada para o seu GPS.</div>`;
      setTimeout(() => card.remove(), 2500);
    }
  };

  window.rejeitarPedido = async (id) => {
    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();
  };

  // Canal de escuta em tempo real (para quando as abas estiverem abertas simultaneamente)
  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline) {
        carregarFilaDePedidos();
      }
    };
  } catch (err) {
    console.warn('BroadcastChannel não suportado neste navegador.', err);
  }

  // Carrega ao abrir
  carregarFilaDePedidos();
});