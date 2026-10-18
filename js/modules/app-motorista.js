// ./js/modules/app-motorista.js

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim
  const map = L.map('mapaMotorista', {
    zoomControl: false
  }).setView(defaultCoords, 14);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  L.circleMarker(defaultCoords, {
    radius: 9,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1
  }).addTo(map);

  // Alternância Online / Offline
  const btnToggleStatus = document.getElementById('btnToggleStatus');
  const txtStatusMotorista = document.getElementById('txtStatusMotorista');
  const badgeRadar = document.getElementById('badgeRadarStatus');
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

  const feedChamadas = document.getElementById('feedChamadas');

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

  // Carrega e desenha os pedidos guardados no localStorage
  function carregarFilaDePedidos() {
    if (!feedChamadas) return;
    const pedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');

    if (pedidos.length === 0) {
      feedChamadas.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
          Nenhum pedido pendente de momento.<br>Aguardando novas solicitações de passageiros...
        </div>
      `;
      return;
    }

    feedChamadas.innerHTML = pedidos.map(p => gerarCardHtml(p)).join('');
  }

  // Ações de aceite e recusa
  window.aceitarPedido = (id) => {
    let pedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidos = pedidos.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidos));

    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.innerHTML = `<div style="text-align:center; padding:16px; font-weight:800; color:#10B981;">🚀 Corrida #${id} Aceite! A rota foi enviada para o seu GPS.</div>`;
      setTimeout(() => card.remove(), 2500);
    }
  };

  window.rejeitarPedido = (id) => {
    let pedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidos = pedidos.filter(p => p.id !== id);
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidos));

    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();
  };

  // Escuta canal em tempo real se o motorista estiver com a aba aberta
  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline) {
        carregarFilaDePedidos();
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel não disponível.', e);
  }

  carregarFilaDePedidos();
});