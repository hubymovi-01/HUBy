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
  const driverMarker = L.circleMarker(defaultCoords, {
    radius: 9,
    color: '#10B981',
    fillColor: '#10B981',
    fillOpacity: 1
  }).addTo(map);

  // Toggle Online/Offline
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
    } else {
      btnToggleStatus.className = 'btn-status-toggle status-offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      badgeRadar.innerHTML = '⏸️ Modo pausa ativo. Fique online para receber pedidos.';
    }
  });

  // Ações nos cards de corrida
  document.querySelectorAll('.btn-job-accept').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.job-card');
      btn.textContent = 'Rota Aceita! 🚀';
      btn.style.opacity = '0.8';
      setTimeout(() => {
        card.style.display = 'none';
      }, 1000);
    });
  });

  document.querySelectorAll('.btn-job-reject').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.job-card');
      card.remove();
    });
  });
  // Canal de escuta de pedidos em tempo real
  const hubyChannel = new BroadcastChannel('huby_orders_channel');
  const feedChamadas = document.getElementById('feedChamadas');

  hubyChannel.onmessage = (event) => {
    if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline) {
      const p = event.data.pedido;
      inserirCardCorrida(p);
    }
  };

  function inserirCardCorrida(p) {
    if (!feedChamadas) return;

    const badgeClasse = p.tipo === 'cargo' ? 'cargo' : (p.tipo === 'flash' ? 'flash' : 'viagem');
    const btnClasse = p.tipo === 'cargo' ? 'cargo-btn' : 'emerald-btn';

    const cardHtml = `
      <div class="job-card" id="card-${p.id}">
        <div class="job-top">
          <div class="job-badge ${badgeClasse}">${p.subTipoLabel} • #${p.id}</div>
          <div class="job-distance">📍 Novo Pedido • ${p.horario}</div>
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
            <span class="split-info">${p.metodoPgto.toUpperCase()}</span>
          </div>
        </div>

        <div class="job-actions">
          <button type="button" class="btn-job-reject" onclick="document.getElementById('card-${p.id}').remove()">Recusar</button>
          <button type="button" class="btn-job-accept ${btnClasse}" onclick="aceitarPedidoLocal('${p.id}')">Aceitar</button>
        </div>
      </div>
    `;

    feedChamadas.insertAdjacentHTML('afterbegin', cardHtml);
  }

  window.aceitarPedidoLocal = (id) => {
    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.innerHTML = `<div style="text-align:center; padding:10px; font-weight:800; color:#10B981;">🚀 Corrida #${id} Aceite! A iniciar navegação...</div>`;
      setTimeout(() => card.remove(), 2000);
    }
  };
});