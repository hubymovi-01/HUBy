// js/admin-radar.js
import { API_URL } from './config.js';

let mapaAdmin = null;
let camadasZonas = [];
let marcadoresMotoristas = {};

export function inicializarRadarMaster(token) {
  const container = document.getElementById('mapaRadarContainer');
  if (!container) return;

  if (typeof L === 'undefined') {
    setTimeout(() => inicializarRadarMaster(token), 300);
    return;
  }

  if (!mapaAdmin) {
    try {
      mapaAdmin = L.map('mapaRadarContainer').setView([-8.3580, -42.2460], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors | HUBy Radar'
      }).addTo(mapaAdmin);

      mapaAdmin.on('click', async (e) => {
        const nome = prompt('Nome da Zona de Demanda (ex: Centro / Show / Chuva):');
        if (!nome || !nome.trim()) return;

        const multInput = prompt('Multiplicador de Tarifa Dinâmica (ex: 1.20):', '1.20');
        if (!multInput) return;
        const multiplicador = Number(multInput.replace(',', '.'));
        if (isNaN(multiplicador) || multiplicador <= 0) return alert('Multiplicador inválido.');

        const raioInput = prompt('Raio da área em metros (ex: 1500):', '2000');
        if (!raioInput) return;
        const raio_metros = Number(raioInput);
        if (isNaN(raio_metros) || raio_metros <= 0) return alert('Raio inválido.');

        try {
          const res = await fetch(`${API_URL}/api/dinamica`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              nome: nome.trim(),
              multiplicador,
              centro_lat: e.latlng.lat,
              centro_lng: e.latlng.lng,
              raio_metros
            })
          });

          if (res.ok) {
            alert('Zona Dinâmica criada com sucesso!');
            carregarZonasDinamicas(token);
          } else {
            alert('Erro ao criar zona.');
          }
        } catch (err) {
          alert('Falha ao comunicar com o servidor.');
        }
      });
    } catch (e) {
      console.warn('Erro ao montar mapa Leaflet:', e);
    }
  }

  setTimeout(() => {
    if (mapaAdmin) mapaAdmin.invalidateSize();
  }, 400);

  carregarZonasDinamicas(token);
}

export async function carregarZonasDinamicas(token) {
  if (!mapaAdmin) return;

  try {
    const res = await fetch(`${API_URL}/api/dinamica`);
    if (!res.ok) return;
    const zonas = await res.json();

    camadasZonas.forEach(c => mapaAdmin.removeLayer(c));
    camadasZonas = [];

    (Array.isArray(zonas) ? zonas : []).forEach(z => {
      if (!z.ativa) return;

      const circulo = L.circle([Number(z.centro_lat), Number(z.centro_lng)], {
        color: '#F59E0B',
        fillColor: '#F59E0B',
        fillOpacity: 0.20,
        weight: 2,
        radius: Number(z.raio_metros) || 2000
      }).addTo(mapaAdmin);

      camadasZonas.push(circulo);
    });
  } catch (err) {
    console.warn('Falha ao carregar zonas:', err);
  }
}

export function atualizarPosicaoCondutorNoMapa(dado) {
  if (!mapaAdmin || !dado || !dado.lat || !dado.lng) return;
  const { motoristaId, lat, lng, emCorrida } = dado;
  const cor = emCorrida ? '#F59E0B' : '#10B981';

  if (marcadoresMotoristas[motoristaId]) {
    marcadoresMotoristas[motoristaId].setLatLng([Number(lat), Number(lng)]);
  } else {
    const iconDiv = L.divIcon({
      className: 'driver-marker',
      html: `<div style="width:24px;height:24px;background:#0B0F19;border:2px solid ${cor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;">🚖</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    marcadoresMotoristas[motoristaId] = L.marker([Number(lat), Number(lng)], { icon: iconDiv }).addTo(mapaAdmin);
  }
}