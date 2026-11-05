// js/admin-radar.js - Radar Master e Telemetria GPS no Admin HUBy
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

  // 1. Limpa instância antiga do Leaflet para evitar o erro de container duplicado
  if (!mapaAdmin) {
    if (container._leaflet_id) {
      delete container._leaflet_id;
    }

    try {
      mapaAdmin = L.map('mapaRadarContainer', {
        zoomControl: true,
        attributionControl: false
      }).setView([-8.3580, -42.2460], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap | HUBy Radar'
      }).addTo(mapaAdmin);

      // Criação de Zona de Tarifa Dinâmica ao clicar no mapa
      mapaAdmin.on('click', async (e) => {
        const nome = prompt('Nome da Zona de Demanda Dinâmica (ex: Centro / Evento / Chuva):');
        if (!nome || !nome.trim()) return;

        const multInput = prompt('Multiplicador de Tarifa Dinâmica (ex: 1.20):', '1.20');
        if (!multInput) return;
        const multiplicador = Number(multInput.replace(',', '.'));
        if (isNaN(multiplicador) || multiplicador <= 0) return alert('Multiplicador inválido.');

        const raioInput = prompt('Raio em metros (ex: 1500):', '2000');
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
            alert('✅ Zona Dinâmica criada com sucesso!');
            carregarZonasDinamicas(token);
          } else {
            alert('❌ Falha ao criar zona.');
          }
        } catch (err) {
          alert('Erro ao conectar ao servidor.');
        }
      });
    } catch (e) {
      console.warn('Erro ao inicializar mapa Leaflet:', e);
    }
  }

  // 2. Força o redesenho do mapa (necessário para abas que estavam ocultas)
  setTimeout(() => {
    if (mapaAdmin) mapaAdmin.invalidateSize();
  }, 300);

  carregarZonasDinamicas(token);
}

export async function carregarZonasDinamicas(token) {
  if (!mapaAdmin) return;

  try {
    const res = await fetch(`${API_URL}/api/dinamica`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) return;
    const zonas = await res.json();

    camadasZonas.forEach(c => mapaAdmin.removeLayer(c));
    camadasZonas = [];

    (Array.isArray(zonas) ? zonas : []).forEach(z => {
      if (!z.ativa && z.ativo === false) return;

      const circulo = L.circle([Number(z.centro_lat), Number(z.centro_lng)], {
        color: '#F59E0B',
        fillColor: '#F59E0B',
        fillOpacity: 0.20,
        weight: 2,
        radius: Number(z.raio_metros) || 2000
      }).addTo(mapaAdmin);

      circulo.bindPopup(`<strong>${z.nome}</strong><br>Dinâmica: ${Number(z.multiplicador).toFixed(2)}x`);
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
      html: `<div style="width:24px;height:24px;background:#0B0F19;border:2px solid ${cor};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${cor};font-size:11px;">🚖</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    marcadoresMotoristas[motoristaId] = L.marker([Number(lat), Number(lng)], { icon: iconDiv }).addTo(mapaAdmin);
  }

  // Atualiza contador de motoristas online no topo do radar
  const lblOnline = document.getElementById('txtCondutoresOnline');
  if (lblOnline) {
    const total = Object.keys(marcadoresMotoristas).length;
    lblOnline.textContent = `${total} ${total === 1 ? 'parceiro ativo' : 'parceiros ativos'}`;
  }
}