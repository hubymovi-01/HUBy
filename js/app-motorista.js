/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Conecta os submódulos modulares da pasta ./motorista/
 */

import { API_URL, sonsHUBy } from './config.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

// Coordenadas padrão e estado central
const estado = {
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_user_id') || null,
  mapa: null,
  markerVeiculo: null,
  coords: [-8.3580, -42.2460],
  statusOnline: false,
  saldoCarteira: 0.0,
  intervalRadar: null
};

// ============================================================================
// 1. INICIALIZAÇÃO DO MAPA LEAFLET
// ============================================================================
function inicializarMapa() {
  const container = document.getElementById('mapaMotorista');
  if (!container) return;

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  try {
    estado.mapa = L.map('mapaMotorista', {
      zoomControl: false,
      attributionControl: false
    }).setView(estado.coords, 15);

    // Tiles CartoDB Voyager / OSM com alto contraste
    L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
  maxZoom: 19,
  subdomains: 'abcd'
}).addTo(estado.mapa);

    const iconeCarro = L.divIcon({
      className: 'huby-driver-pin',
      html: '<div style="width:36px;height:36px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(16,185,129,0.8);font-size:18px;">🚘</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarro }).addTo(estado.mapa);

    // Força o Leaflet a renderizar as dimensões corretas e eliminar a tela cinza
    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 250);

    // Conecta as ferramentas inteligentes (Calor, Pausa, Casa) passando a instância do mapa
    configurarRecursosInteligentes(estado.mapa, estado.token);

    // Geolocalização
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        estado.coords = [latitude, longitude];
        if (estado.mapa && estado.markerVeiculo) {
          estado.mapa.setView([latitude, longitude], 16);
          estado.markerVeiculo.setLatLng([latitude, longitude]);
          estado.mapa.invalidateSize();
        }
      }, null, { enableHighAccuracy: true });
    }
  } catch (err) {
    console.error('Erro na inicialização do mapa:', err);
  }
}

// ============================================================================
// 2. STATUS ONLINE / RADAR
// ============================================================================
async function alternarStatusOnline() {
  const btn = document.getElementById('btnToggleStatusOnline');
  if (!btn) return;

  estado.statusOnline = !estado.statusOnline;

  if (estado.statusOnline) {
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.borderColor = 'var(--emerald)';
    btn.style.color = 'var(--emerald)';
    btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
    sonsHUBy.tocarSucessoAceite();
    iniciarRadar();
  } else {
    btn.style.background = '#1F2937';
    btn.style.borderColor = 'rgba(255,255,255,0.12)';
    btn.style.color = '#94A3B8';
    btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
    pararRadar();
  }

  try {
    await fetch(`${API_URL}/api/motoristas/status-online`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {})
      },
      body: JSON.stringify({ online: estado.statusOnline, coords: estado.coords })
    });
  } catch (e) {
    console.warn('Sincronização de status online em contingência');
  }
}

function iniciarRadar() {
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);
  buscarChamadas();
  estado.intervalRadar = setInterval(buscarChamadas, 4000);
}

function pararRadar() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  const lista = document.getElementById('listaChamadasPendentes');
  if (lista) {
    lista.innerHTML = '<div class="dock-empty">Você está offline. Fique online para receber corridas.</div>';
  }
}

async function buscarChamadas() {
  if (!estado.statusOnline) return;
  try {
    const res = await fetch(`${API_URL}/api/pedidos/pendentes`, {
      headers: { ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}) }
    });
    if (!res.ok) return;
    const chamadas = await res.json();
    renderizarChamadas(chamadas);
  } catch (e) {}
}

function renderizarChamadas(chamadas = []) {
  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  if (!chamadas.length) {
    container.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  container.innerHTML = chamadas.map(ped => {
    const valorBruto = Number(ped.valor_total || 0);
    const repasse = (valorBruto * 0.85).toFixed(2).replace('.', ',');
    const km = Number(ped.distancia_km || 1.0).toFixed(1);

    return `
      <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-dark); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 3px 8px; border-radius: 6px;">
            ${(ped.sub_tipo_label || ped.tipo || 'HUBy Carro').toUpperCase()}
          </span>
          <strong style="font-size: 17px; color: var(--emerald); font-weight: 900;">
            R$ ${repasse}
          </strong>
        </div>
        <div style="font-size: 12px; color: #FFF; line-height: 1.4;">
          <div>📍 <strong>Destino:</strong> ${ped.destino || 'Destino informado'}</div>
          <div style="font-size: 11px; color: var(--text-sec); margin-top: 2px;">📏 Distância: ${km} km</div>
        </div>
        <button type="button" class="btn-aceitar" data-id="${ped.id}"
          style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ⚡ Aceitar Viagem
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-aceitar').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        const r = await fetch(`${API_URL}/api/pedidos/${id}/aceitar`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {})
          },
          body: JSON.stringify({ motoristaId: estado.motoristaId })
        });
        if (r.ok) {
          sonsHUBy.tocarSucessoAceite();
          alert('Corrida aceita com sucesso!');
          buscarChamadas();
        } else {
          alert('Esta corrida já não está disponível.');
        }
      } catch (err) {
        alert('Erro ao aceitar corrida.');
      }
    });
  });
}

// ============================================================================
// 3. PERFIL, DRAWER E MODAIS
// ============================================================================
async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/meu-perfil`, {
      headers: { ...(estado.token ? { Authorization: `Bearer ${estado.token}` } : {}) }
    });
    if (!res.ok) return;
    const m = await res.json();

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    if (topNome) topNome.textContent = (m.nome || 'Motorista').split(' ')[0];
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    estado.saldoCarteira = Number(m.saldo_carteira || 0);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerFoto = document.getElementById('drawerFotoImg');

    if (drawerNome) drawerNome.textContent = m.nome || 'Motorista Parceiro';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'HUB-0000').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Carro Padrão';
    if (drawerFoto && m.foto_perfil_url) drawerFoto.src = m.foto_perfil_url;
  } catch (e) {}
}

function registrarEventosUI() {
  // Toggle Online
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', alternarStatusOnline);

  // Drawer
  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');
  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
  });
  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };
  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  // Modal Saque
  const modalSaque = document.getElementById('modalSaquePix');
  document.getElementById('btnAbrirModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'flex';
  });
  document.getElementById('btnFecharModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'none';
  });

  // Modal Incidentes
  const modalIncidente = document.getElementById('modalReportarIncidente');
  document.getElementById('btnAbrirModalIncidente')?.addEventListener('click', () => {
    if (modalIncidente) modalIncidente.style.display = 'flex';
  });
  document.getElementById('btnFecharModalIncidente')?.addEventListener('click', () => {
    if (modalIncidente) modalIncidente.style.display = 'none';
  });

  // Logout
  document.getElementById('btnLogoutMotorista')?.addEventListener('click', () => {
    if (confirm('Deseja realmente encerrar a sessão de parceiro?')) {
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_user_id');
      window.location.href = './index.html';
    }
  });
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
});