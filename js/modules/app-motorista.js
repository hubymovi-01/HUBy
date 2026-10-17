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
});