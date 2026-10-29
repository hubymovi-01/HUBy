// js/admin-radar.js
import { API_URL } from './config.js';

let mapaAdmin = null;
let camadasZonas = [];
let marcadoresMotoristas = {};

export function inicializarRadarMaster(token) {
  const container = document.getElementById('mapaRadarContainer');
  if (!container) return;

  if (!mapaAdmin) {
    mapaAdmin = L.map('mapaRadarContainer').setView([-8.3580, -42.2460], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: 'HUBy Radar Intelligence'
    }).addTo(mapaAdmin);

    // Clique no mapa para criar uma zona dinâmica
    mapaAdmin.on('click', async (e) => {
      const nome = prompt('Nome da Zona de Demanda (ex: Centro / Show / Chuva):');
      if (!nome || !nome.trim()) return;

      const multInput = prompt('Multiplicador de Tarifa Dinâmica (ex: 1.30 para +30%):', '1.20');
      if (!multInput) return;
      const multiplicador = Number(multInput.replace(',', '.'));
      if (isNaN(multiplicador) || multiplicador <= 0) {
        alert('Multiplicador inválido.');
        return;
      }

      const raioInput = prompt('Raio da área em metros (ex: 1500):', '2000');
      if (!raioInput) return;
      const raio_metros = Number(raioInput);
      if (isNaN(raio_metros) || raio_metros <= 0) {
        alert('Raio inválido.');
        return;
      }

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
          alert('Zona Dinâmica criada e ativa no sistema!');
          carregarZonasDinamicas(token);
        } else {
          const erro = await res.json().catch(() => ({}));
          alert(`Erro ao criar zona: ${erro.erro || 'Falha na requisição'}`);
        }
      } catch (err) {
        console.error('Erro na criação de zona dinâmica:', err);
        alert('Falha de conexão com o servidor.');
      }
    });

    // Registra ações globais de clique nos botões dos popups
    window.toggleZonaAdmin = async (id) => {
      try {
        await fetch(`${API_URL}/api/dinamica/${id}/toggle`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        carregarZonasDinamicas(token);
      } catch (e) {
        alert('Erro ao alternar zona.');
      }
    };

    window.excluirZonaAdmin = async (id) => {
      if (!confirm('Deseja realmente remover esta zona de demanda?')) return;
      try {
        await fetch(`${API_URL}/api/dinamica/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        carregarZonasDinamicas(token);
      } catch (e) {
        alert('Erro ao remover zona.');
      }
    };
  }

  setTimeout(() => mapaAdmin.invalidateSize(), 300);
  carregarZonasDinamicas(token);
}

export async function carregarZonasDinamicas(token) {
  if (!mapaAdmin) return;

  try {
    const res = await fetch(`${API_URL}/api/dinamica`);
    if (!res.ok) return;
    const zonas = await res.json();

    // Limpa camadas existentes
    camadasZonas.forEach(c => mapaAdmin.removeLayer(c));
    camadasZonas = [];

    zonas.forEach(z => {
      if (!z.ativa) return;

      const centroLat = Number(z.centro_lat);
      const centroLng = Number(z.centro_lng);
      const raio = Number(z.raio_metros) || 2000;

      const circulo = L.circle([centroLat, centroLng], {
        color: '#F59E0B',
        fillColor: '#F59E0B',
        fillOpacity: 0.20,
        weight: 2,
        radius: raio
      }).addTo(mapaAdmin);

      circulo.bindPopup(`
        <div style="font-family: inherit; font-size: 13px; color: #111;">
          <strong style="font-size: 14px;">📍 ${z.nome}</strong><br>
          <span style="color: #D97706; font-weight: 800;">Taxa: ${Number(z.multiplicador).toFixed(2)}x</span><br>
          <small style="color: #6B7280;">Raio: ${raio} metros</small>
          <div style="margin-top: 8px; display: flex; gap: 6px;">
            <button onclick="toggleZonaAdmin(${z.id})" style="background: #F59E0B; border: none; padding: 4px 8px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 11px;">Pausar</button>
            <button onclick="excluirZonaAdmin(${z.id})" style="background: #EF4444; color: #FFF; border: none; padding: 4px 8px; border-radius: 4px; font-weight: 700; cursor: pointer; font-size: 11px;">Excluir</button>
          </div>
        </div>
      `);

      camadasZonas.push(circulo);
    });
  } catch (err) {
    console.error('Erro ao plotar zonas dinâmicas:', err);
  }
}

export function atualizarPosicaoCondutorNoMapa(dado) {
  if (!mapaAdmin) return;
  const { motoristaId, lat, lng, emCorrida } = dado;
  if (!lat || !lng) return;

  const numLat = Number(lat);
  const numLng = Number(lng);
  const corPino = emCorrida ? '#F59E0B' : '#10B981';
  const textoStatus = emCorrida ? 'Em Corrida' : 'Disponível';

  if (marcadoresMotoristas[motoristaId]) {
    marcadoresMotoristas[motoristaId].setLatLng([numLat, numLng]);
    const popupContent = `<b>Motorista:</b> #${motoristaId}<br><b>Status:</b> <span style="color: ${corPino}; font-weight: 700;">${textoStatus}</span>`;
    marcadoresMotoristas[motoristaId].setPopupContent(popupContent);
  } else {
    const iconDiv = L.divIcon({
      className: 'driver-marker',
      html: `<div style="width:26px;height:26px;background:#0B0F19;border:2.5px solid ${corPino};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${corPino};font-size:12px;">🚖</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });

    const marcador = L.marker([numLat, numLng], { icon: iconDiv }).addTo(mapaAdmin);
    marcador.bindPopup(`<b>Motorista:</b> #${motoristaId}<br><b>Status:</b> <span style="color: ${corPino}; font-weight: 700;">${textoStatus}</span>`);
    marcadoresMotoristas[motoristaId] = marcador;
  }

  // Atualiza contador de frota online no cabeçalho do radar
  const contadorEl = document.getElementById('txtCondutoresOnline');
  if (contadorEl) {
    const total = Object.keys(marcadoresMotoristas).length;
    contadorEl.textContent = `${total} parceiro${total === 1 ? '' : 's'} monitorado${total === 1 ? '' : 's'}`;
  }
}