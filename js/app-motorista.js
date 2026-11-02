/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Conecta os submódulos modulares da pasta ./motorista/
 */

import { API_URL, sonsHUBy } from './config.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

// Coordenadas padrão e estado central
const estado = {
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_motorista_id') || localStorage.getItem('huby_user_id') || null,
  motoristaNome: 'Carol',
  mapa: null,
  markerVeiculo: null,
  linhaRota: null,
  markerDestino: null,
  coords: [-8.3580, -42.2460],
  statusOnline: true,
  saldoCarteira: 1001.23,
  intervalRadar: null,
  pedidoAtivo: null
};

// Utilitário para cabeçalhos HTTP autenticados limpos
function obterHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = estado.token || localStorage.getItem('huby_token');
  if (token && token !== 'null' && token !== 'undefined') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

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

    // Servidor 100% público do OpenStreetMap
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
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
    }, 300);

    // Conecta ferramentas térmicas e pausas
    configurarRecursosInteligentes(estado.mapa, estado.token);

    // Geolocalização com fallback
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
      headers: obterHeaders(),
      body: JSON.stringify({ online: estado.statusOnline, coords: estado.coords })
    });
  } catch (e) {
    console.warn('Sincronização de status online em contingência');
  }
}

function iniciarRadar() {
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);
  buscarChamadas();
  estado.intervalRadar = setInterval(buscarChamadas, 3500);
}

function pararRadar() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  const lista = document.getElementById('listaChamadasPendentes');
  if (lista && !estado.pedidoAtivo) {
    lista.innerHTML = '<div class="dock-empty">Você está offline. Fique online para receber corridas.</div>';
  }
}

async function buscarChamadas() {
  if (!estado.statusOnline || estado.pedidoAtivo) return;
  try {
    const res = await fetch(`${API_URL}/api/pedidos/pendentes`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const chamadas = await res.json();
    renderizarChamadas(chamadas);
  } catch (e) { }
}

function renderizarChamadas(chamadas = []) {
  const container = document.getElementById('listaChamadasPendentes');
  if (!container || estado.pedidoAtivo) return;

  if (!chamadas.length) {
    container.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  container.innerHTML = chamadas.map(ped => {
    const valorBruto = Number(ped.valor_total || 0);
    const repasse = (valorBruto * 0.85).toFixed(2).replace('.', ',');
    const km = Number(ped.distancia_km || 1.0).toFixed(1);
    const destTexto = ped.destino_endereco || ped.destino || 'Destino informado';

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
          <div>📍 <strong>Destino:</strong> ${destTexto}</div>
          <div style="font-size: 11px; color: var(--text-sec); margin-top: 2px;">📏 Distância: ${km} km</div>
        </div>
        <button type="button" class="btn-aceitar" 
          data-id="${ped.id}" 
          data-lat="${ped.destino_lat || ''}" 
          data-lng="${ped.destino_lng || ''}" 
          data-dest="${destTexto}" 
          data-repasse="${repasse}"
          style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ⚡ Aceitar Viagem
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-aceitar').forEach(btn => {
    btn.addEventListener('click', () => aceitarCorrida(btn));
  });
}

// ============================================================================
// 3. FLUXO DE ACEITAR, VISUALIZAR ROTA E CONCLUIR CORRIDA
// ============================================================================
async function aceitarCorrida(btn) {
  const id = btn.getAttribute('data-id');
  const lat = parseFloat(btn.getAttribute('data-lat')) || (estado.coords[0] + 0.008);
  const lng = parseFloat(btn.getAttribute('data-lng')) || (estado.coords[1] + 0.008);
  const dest = btn.getAttribute('data-dest');
  const repasse = btn.getAttribute('data-repasse');

  try {
    btn.disabled = true;
    btn.textContent = 'Aceitando...';

    const r = await fetch(`${API_URL}/api/pedidos/${id}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ 
        motoristaId: estado.motoristaId,
        motoristaNome: estado.motoristaNome 
      })
    });

    const resJson = await r.json().catch(() => ({}));

    if (r.ok || resJson.sucesso) {
      sonsHUBy.tocarSucessoAceite();
      iniciarViagemEmAndamento({ id, destLat: lat, destLng: lng, destNome: dest, repasse });
    } else {
      alert(resJson.erro || 'Esta corrida já não está disponível.');
      buscarChamadas();
    }
  } catch (err) {
    iniciarViagemEmAndamento({ id, destLat: lat, destLng: lng, destNome: dest, repasse });
  }
}

function iniciarViagemEmAndamento(dados) {
  estado.pedidoAtivo = dados;
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  // 1. Traça rota no Leaflet com linha visual de navegação
  if (estado.mapa) {
    if (estado.linhaRota) estado.mapa.removeLayer(estado.linhaRota);
    if (estado.markerDestino) estado.mapa.removeLayer(estado.markerDestino);

    const destinoCoords = [dados.destLat, dados.destLng];

    estado.linhaRota = L.polyline([estado.coords, destinoCoords], {
      color: '#38BDF8',
      weight: 5,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(estado.mapa);

    const iconeDestino = L.divIcon({
      html: '<div style="font-size:26px;filter:drop-shadow(0 0 8px #EF4444);">📍</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 26]
    });
    estado.markerDestino = L.marker(destinoCoords, { icon: iconeDestino }).addTo(estado.mapa);

    estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });
  }

  // 2. Renderiza os botões Waze, Google Maps e Concluir no Dock
  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const urlWaze = `https://waze.com/ul?ll=${dados.destLat},${dados.destLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.destLat},${dados.destLng}`;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.96); border: 1.5px solid var(--emerald); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 8px; border-radius: 6px;">
          🚀 VIAGEM EM ANDAMENTO
        </span>
        <strong style="color: var(--emerald); font-size: 18px;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; font-weight: 600;">
        📍 Destino: <span style="color: #94A3B8;">${dados.destNome}</span>
      </div>

      <!-- BOTÕES DE NAVEGAÇÃO EXTERNA (WAZE & GOOGLE MAPS) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 10px; border-radius: 8px; text-decoration: none; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Abrir Waze
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 10px; border-radius: 8px; text-decoration: none; font-size: 12px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Google Maps
        </a>
      </div>

      <!-- FINALIZAR CORRIDA -->
      <button type="button" id="btnConcluirViagemAtiva"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 10px; font-size: 14px; cursor: pointer; margin-top: 4px;">
        🏁 Concluir e Receber Corrida
      </button>
    </div>
  `;

  document.getElementById('btnConcluirViagemAtiva')?.addEventListener('click', () => finalizarViagem(dados.id));
}

async function finalizarViagem(id) {
  try {
    await fetch(`${API_URL}/api/pedidos/${id}/concluir`, {
      method: 'PUT',
      headers: obterHeaders()
    });
  } catch (e) { }

  alert('Corrida concluída com sucesso! Valor creditado na carteira.');
  sonsHUBy.tocarMetaBatida();

  if (estado.linhaRota && estado.mapa) estado.mapa.removeLayer(estado.linhaRota);
  if (estado.markerDestino && estado.mapa) estado.mapa.removeLayer(estado.markerDestino);

  estado.pedidoAtivo = null;
  carregarPerfil();
  iniciarRadar();
}

// ============================================================================
// 4. PERFIL, DRAWER, EXTRATO E METAS
// ============================================================================
async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/perfil`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const m = await res.json();

    if (m.id) {
      estado.motoristaId = m.id;
      estado.motoristaNome = m.nome || 'Carol';
      localStorage.setItem('huby_motorista_id', m.id);
    }

    // Top Bar
    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    const primeiroNome = (m.nome || 'Carol').split(' ')[0];
    if (topNome) topNome.textContent = primeiroNome;
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    // Saldo disponível
    estado.saldoCarteira = Number(m.saldo_carteira || 1001.23);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    // Drawer lateral do motorista
    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerFoto = document.getElementById('drawerFotoImg');
    const drawerTotalViagens = document.getElementById('drawerTotalViagensTxt');
    const drawerInputPix = document.getElementById('drawerInputChavePix');
    const badgeCategoria = document.getElementById('drawerCategoriaBadge');

    if (drawerNome) drawerNome.textContent = m.nome || 'Carol';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'ABC1D23').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Onix';
    if (drawerDetalhes) {
      drawerDetalhes.textContent = `Cor: ${m.veiculo_cor || 'Prata'} • Ano: ${m.veiculo_ano || '2023'}`;
    }
    if (drawerFoto && m.foto_perfil_url) drawerFoto.src = m.foto_perfil_url;
    if (drawerTotalViagens) drawerTotalViagens.textContent = `${m.total_corridas || 0} viagens`;
    if (drawerInputPix && m.chave_pix_padrao) drawerInputPix.value = m.chave_pix_padrao;
    if (badgeCategoria) badgeCategoria.textContent = (m.categoria || 'HUBY CARRO').toUpperCase();

    // Sincroniza extrato diário
    await sincronizarExtratoDiario();
  } catch (e) {
    console.warn('Erro ao carregar perfil do motorista:', e);
  }
}

async function sincronizarExtratoDiario() {
  const containerExtrato = document.getElementById('drawerListaExtrato');
  const lblGanhosHoje = document.getElementById('lblGanhosHojeValor');
  const lblViagensHoje = document.getElementById('lblCorridasHojeQtd');
  const barraMeta = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  try {
    const res = await fetch(`${API_URL}/api/motoristas/extrato`, { headers: obterHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const corridas = data.corridas || data.historico || [];

    let totalGanhos = 0;
    let qtdViagens = 0;

    if (corridas.length && containerExtrato) {
      containerExtrato.innerHTML = corridas.map(c => {
        const repasse = Number(c.repasse_liquido || c.valor_total * 0.85);
        totalGanhos += repasse;
        qtdViagens++;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-dark); font-size: 12px;">
            <div style="max-width: 65%;">
              <div style="color: #FFF; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${c.destino_endereco || 'Viagem Concluída'}
              </div>
              <small style="color: var(--text-sec); font-size: 10px;">${new Date(c.criado_em || c.concluido_em).toLocaleDateString('pt-BR')}</small>
            </div>
            <strong style="color: var(--emerald);">+ R$ ${repasse.toFixed(2).replace('.', ',')}</strong>
          </div>
        `;
      }).join('');
    } else if (containerExtrato) {
      containerExtrato.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 0;">Nenhuma corrida realizada ainda.</div>';
    }

    if (lblGanhosHoje) lblGanhosHoje.textContent = `R$ ${totalGanhos.toFixed(2).replace('.', ',')}`;
    if (lblViagensHoje) lblViagensHoje.textContent = `${qtdViagens} viagens`;

    const meta = 200.0;
    const perc = Math.min(100, Math.round((totalGanhos / meta) * 100));
    if (barraMeta) barraMeta.style.width = `${perc}%`;
    if (lblMetaTxt) lblMetaTxt.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${perc}%)`;
  } catch (e) {
    if (containerExtrato) {
      containerExtrato.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 0;">Sem movimentações registradas.</div>';
    }
  }
}

// ============================================================================
// 5. REGISTRO DE EVENTOS DA INTERFACE (DRAWER, MODAIS E SAQUE)
// ============================================================================
function registrarEventosUI() {
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', alternarStatusOnline);

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

  // Salvar Chave Pix
  document.getElementById('btnSalvarChavePix')?.addEventListener('click', async () => {
    const chave = document.getElementById('drawerInputChavePix')?.value?.trim();
    if (!chave) return alert('Digite uma chave Pix válida.');

    try {
      const res = await fetch(`${API_URL}/api/motoristas/chave-pix`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ chavePix: chave })
      });
      if (res.ok) alert('Chave Pix salva com sucesso!');
      else alert('Erro ao registrar chave Pix.');
    } catch (e) {
      alert('Erro de conexão ao salvar chave.');
    }
  });

  // Modal Saque Pix
  const modalSaque = document.getElementById('modalSaquePix');
  document.getElementById('btnAbrirModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'flex';
  });
  document.getElementById('btnFecharModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'none';
  });

  // Logout
  document.getElementById('btnLogoutMotorista')?.addEventListener('click', () => {
    if (confirm('Deseja realmente encerrar a sessão de parceiro?')) {
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_user_id');
      localStorage.removeItem('huby_motorista_id');
      window.location.href = './index.html';
    }
  });
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
  iniciarRadar();
});