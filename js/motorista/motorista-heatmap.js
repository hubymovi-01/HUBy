// js/motorista/motorista-heatmap.js
import { estado } from './motorista-estado.js';

let camadaHeatmap = null;

export function inicializarHeatmapDemanda() {
  const btnToggleHeat = document.getElementById('btnToggleHeatmap');
  if (!btnToggleHeat) return;

  btnToggleHeat.addEventListener('click', () => {
    if (!estado.hubyMapa || !estado.hubyMapa.map) return;

    if (camadaHeatmap) {
      estado.hubyMapa.map.removeLayer(camadaHeatmap);
      camadaHeatmap = null;
      btnToggleHeat.style.background = 'rgba(18, 24, 38, 0.94)';
      btnToggleHeat.style.color = 'var(--text-sec)';
      btnToggleHeat.textContent = '🔥 Mapa de Calor';
    } else {
      desenharAreasDemanda();
      btnToggleHeat.style.background = '#F59E0B';
      btnToggleHeat.style.color = '#000';
      btnToggleHeat.textContent = '🔥 Ocultar Calor';
    }
  });
}

function desenharAreasDemanda() {
  if (!estado.hubyMapa || !estado.hubyMapa.map || typeof L === 'undefined') return;

  const centro = estado.hubyMapa.coordsOrigem || [-8.3580, -42.2460];
  camadaHeatmap = L.layerGroup();

  // Simula zonas de alta densidade de pedidos ao redor do centro do condutor
  const zonas = [
    { offsetLat: 0.003, offsetLng: 0.002, raio: 380, intensidade: 'rgba(239, 68, 68, 0.35)', borda: '#EF4444', label: 'Alta Demanda 🔥' },
    { offsetLat: -0.004, offsetLng: -0.003, raio: 450, intensidade: 'rgba(245, 158, 11, 0.30)', borda: '#F59E0B', label: 'Média Demanda ⚡' },
    { offsetLat: 0.005, offsetLng: -0.004, raio: 320, intensidade: 'rgba(16, 185, 129, 0.25)', borda: '#10B981', label: 'Chamadas Frequentes' }
  ];

  zonas.forEach((z) => {
    const lat = centro[0] + z.offsetLat;
    const lng = centro[1] + z.offsetLng;

    const circulo = L.circle([lat, lng], {
      color: z.borda,
      fillColor: z.intensidade,
      fillOpacity: 0.5,
      radius: z.raio,
      weight: 1.5
    }).bindPopup(`<strong>${z.label}</strong><br>Mais passageiros buscando corridas aqui.`);

    camadaHeatmap.addLayer(circulo);
  });

  camadaHeatmap.addTo(estado.hubyMapa.map);
}