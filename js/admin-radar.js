// js/admin-radar.js - Radar Master e Telemetria GPS no Admin HUBy
// Textos vindos do banco (nome da zona) são exibidos como texto puro.
import { API_URL } from './config.js';

let mapaAdmin = null;
let camadasZonas = [];
const marcadoresMotoristas = {}; // motoristaId -> { marcador, emCorrida, visto }

const SUMIR_APOS_MS = 2 * 60 * 1000; // motorista sem sinal há 2 min sai do radar

function atualizarContadorOnline() {
  const lblOnline = document.getElementById('txtCondutoresOnline');
  if (!lblOnline) return;
  const total = Object.keys(marcadoresMotoristas).length;
  lblOnline.textContent = `${total} ${total === 1 ? 'parceiro ativo' : 'parceiros ativos'}`;
}

// Remove do mapa quem parou de mandar posição (ficou offline ou fechou o app)
setInterval(() => {
  const agora = Date.now();
  let mudou = false;
  Object.keys(marcadoresMotoristas).forEach((id) => {
    const item = marcadoresMotoristas[id];
    if (agora - item.visto > SUMIR_APOS_MS) {
      try { mapaAdmin?.removeLayer(item.marcador); } catch (e) {}
      delete marcadoresMotoristas[id];
      mudou = true;
    }
  });
  if (mudou) atualizarContadorOnline();
}, 30000);

function iconeMotorista(emCorrida) {
  const cor = emCorrida ? '#F59E0B' : '#10B981';
  return L.divIcon({
    className: 'driver-marker',
    html: `<div style="width:24px;height:24px;background:#0B0F19;border:2px solid ${cor};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px ${cor};font-size:11px;">🚖</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
}

export function inicializarRadarMaster(token) {
  const container = document.getElementById('mapaRadarContainer');
  if (!container) return;

  if (typeof L === 'undefined') {
    setTimeout(() => inicializarRadarMaster(token), 300);
    return;
  }

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
        if (!Number.isFinite(multiplicador) || multiplicador < 1 || multiplicador > 5) {
          alert('Multiplicador inválido (use entre 1.00 e 5.00).');
          return;
        }

        const raioInput = prompt('Raio em metros (ex: 1500):', '2000');
        if (!raioInput) return;
        const raio_metros = Math.round(Number(raioInput));
        if (!Number.isFinite(raio_metros) || raio_metros < 100 || raio_metros > 50000) {
          alert('Raio inválido (use entre 100 e 50000 metros).');
          return;
        }

        try {
          const tokenAtual = localStorage.getItem('huby_token') || token;
          const res = await fetch(`${API_URL}/api/dinamica`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenAtual}`
            },
            body: JSON.stringify({
              nome: nome.trim().slice(0, 80),
              multiplicador,
              centro_lat: e.latlng.lat,
              centro_lng: e.latlng.lng,
              raio_metros
            })
          });

          if (res.ok) {
            alert('✅ Zona Dinâmica criada com sucesso!');
            carregarZonasDinamicas(tokenAtual);
          } else {
            const data = await res.json().catch(() => ({}));
            alert(`❌ ${data.erro || 'Falha ao criar zona.'}`);
          }
        } catch (err) {
          alert('Erro ao conectar ao servidor.');
        }
      });
    } catch (e) {
      console.warn('Erro ao inicializar mapa Leaflet:', e);
    }
  }

  // Força o redesenho do mapa (necessário para abas que estavam ocultas)
  setTimeout(() => {
    if (mapaAdmin) mapaAdmin.invalidateSize();
  }, 300);

  carregarZonasDinamicas(token);
}

// Balão da zona montado com texto puro
function popupZona(z) {
  const caixa = document.createElement('div');
  const titulo = document.createElement('strong');
  titulo.textContent = String(z.nome || 'Zona dinâmica').slice(0, 80);
  const linha = document.createElement('div');
  const mult = Number(z.multiplicador);
  linha.textContent = `Dinâmica: ${Number.isFinite(mult) ? mult.toFixed(2) : '--'}x`;
  caixa.append(titulo, linha);
  return caixa;
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
      const lat = Number(z.centro_lat);
      const lng = Number(z.centro_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const circulo = L.circle([lat, lng], {
        color: '#F59E0B',
        fillColor: '#F59E0B',
        fillOpacity: 0.20,
        weight: 2,
        radius: Math.min(50000, Math.max(100, Number(z.raio_metros) || 2000))
      }).addTo(mapaAdmin);

      circulo.bindPopup(popupZona(z));
      camadasZonas.push(circulo);
    });
  } catch (err) {
    console.warn('Falha ao carregar zonas:', err);
  }
}

export function atualizarPosicaoCondutorNoMapa(dado) {
  if (!mapaAdmin || !dado || typeof L === 'undefined') return;

  const lat = Number(dado.lat);
  const lng = Number(dado.lng);
  const id = String(dado.motoristaId || '');
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

  const emCorrida = Boolean(dado.emCorrida);
  const item = marcadoresMotoristas[id];

  if (item) {
    item.marcador.setLatLng([lat, lng]);
    item.visto = Date.now();
    if (item.emCorrida !== emCorrida) {
      item.marcador.setIcon(iconeMotorista(emCorrida)); // verde = livre, laranja = em corrida
      item.emCorrida = emCorrida;
    }
  } else {
    marcadoresMotoristas[id] = {
      marcador: L.marker([lat, lng], { icon: iconeMotorista(emCorrida) }).addTo(mapaAdmin),
      emCorrida,
      visto: Date.now()
    };
    atualizarContadorOnline();
  }
}