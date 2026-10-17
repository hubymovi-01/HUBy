// ./js/modules/app-admin.js

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaAdmin');
  if (!mapElement) return;

  const defaultCoords = [-7.7735, -42.2472]; // Paes Landim
  const map = L.map('mapaAdmin', {
    zoomControl: true
  }).setView(defaultCoords, 14);

  // Tiles gratuitos OpenStreetMap com o filtro Dark Mode de global.css
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Veículos simulados ativos na região
  const veiculos = [
    { nome: 'Tarcyo (HUBy Carro)', coords: [-7.7720, -42.2485], cor: '#10B981' },
    { nome: 'Carlos (HUBy Cargo VUC)', coords: [-7.7755, -42.2440], cor: '#FF6B00' },
    { nome: 'Lucas (HUBy Flash)', coords: [-7.7710, -42.2430], cor: '#38BDF8' }
  ];

  veiculos.forEach(v => {
    L.circleMarker(v.coords, {
      radius: 8,
      color: v.cor,
      fillColor: v.cor,
      fillOpacity: 0.9
    }).addTo(map).bindPopup(`<strong>${v.nome}</strong><br>Status: Disponível`);
  });
});