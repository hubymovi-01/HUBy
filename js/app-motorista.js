/**
 * HUBy 2.0 - Central Profissional do Motorista Parceiro (js/app-motorista.js)
 */

import { API_URL, sonsHUBy } from './config.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

const estado = {
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_motorista_id') || localStorage.getItem('huby_user_id') || null,
  motoristaNome: 'Carol',
  mapa: null,
  markerVeiculo: null,
  linhaRota: null,
  markerOrigem: null,
  markerDestino: null,
  coords: [-8.3580, -42.2460],
  statusOnline: true,
  saldoCarteira: 1012.07,
  intervalRadar: null,
  intervalChat: null,
  pedidoEmInspecao: null,
  pedidoAtivo: null
};

function obterHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = estado.token || localStorage.getItem('huby_token');
  if (token && token !== 'null') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ============================================================================
// 1. INICIALIZAÇÃO DO MAPA
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

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarro = L.divIcon({
      className: 'huby-driver-pin',
      html: '<div style="width:38px;height:38px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(16,185,129,0.9);font-size:19px;">🚘</div>',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarro }).addTo(estado.mapa);

    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 300);

    configurarRecursosInteligentes(estado.mapa, estado.token);

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        estado.coords = [latitude, longitude];
        if (estado.mapa && estado.markerVeiculo) {
          estado.mapa.setView([latitude, longitude], 16);
          estado.markerVeiculo.setLatLng([latitude, longitude]);
        }
      }, null, { enableHighAccuracy: true });
    }
  } catch (err) {
    console.error('Erro ao iniciar mapa:', err);
  }
}

// ============================================================================
// 2. RADAR DE CHAMADAS
// ============================================================================
function alternarStatusOnline() {
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
  if (lista && !estado.pedidoAtivo && !estado.pedidoEmInspecao) {
    lista.innerHTML = '<div class="dock-empty">Você está offline. Fique online para receber corridas.</div>';
  }
}

async function buscarChamadas() {
  if (!estado.statusOnline || estado.pedidoAtivo || estado.pedidoEmInspecao) return;
  try {
    const res = await fetch(`${API_URL}/api/pedidos/pendentes`, { headers: obterHeaders() });
    if (!res.ok) return;
    const chamadas = await res.json();
    renderizarChamadas(chamadas);
  } catch (e) { }
}

function renderizarChamadas(chamadas = []) {
  const container = document.getElementById('listaChamadasPendentes');
  if (!container || estado.pedidoAtivo || estado.pedidoEmInspecao) return;

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
      <div style="background: rgba(18, 24, 38, 0.95); border: 1.5px solid var(--border-dark); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
            ${(ped.sub_tipo_label || ped.tipo || 'HUBy Carro').toUpperCase()}
          </span>
          <strong style="font-size: 20px; color: var(--emerald); font-weight: 900;">
            R$ ${repasse}
          </strong>
        </div>

        <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>📍</span> <strong>Destino:</strong> ${destTexto}
          </div>
          <div style="font-size: 11px; color: var(--text-sec); margin-top: 4px;">
            📏 Distância: <strong>${km} km</strong> • ~${Math.round(km * 2)} min
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 2px;">
          <button type="button" class="btn-visualizar-rota"
            data-id="${ped.id}" data-lat="${ped.destino_lat || ''}" data-lng="${ped.destino_lng || ''}" data-dest="${destTexto}" data-repasse="${repasse}" data-km="${km}"
            style="background: rgba(56,189,248,0.18); border: 1px solid var(--blue); color: var(--blue); font-weight: 800; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            🗺️ Ver Rota
          </button>
          <button type="button" class="btn-confirmar-imediato"
            data-id="${ped.id}" data-lat="${ped.destino_lat || ''}" data-lng="${ped.destino_lng || ''}" data-dest="${destTexto}" data-repasse="${repasse}"
            style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            ⚡ Aceitar
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-visualizar-rota').forEach(btn => {
    btn.addEventListener('click', () => inspecionarRotaPrevia(btn));
  });

  container.querySelectorAll('.btn-confirmar-imediato').forEach(btn => {
    btn.addEventListener('click', () => aceitarCorridaDefinitiva(btn));
  });
}

// ============================================================================
// 3. PRÉ-VISUALIZAÇÃO DE ROTA ANTES DE CONFIRMAR
// ============================================================================
function inspecionarRotaPrevia(btn) {
  const dados = {
    id: btn.getAttribute('data-id'),
    destLat: parseFloat(btn.getAttribute('data-lat')) || (estado.coords[0] + 0.008),
    destLng: parseFloat(btn.getAttribute('data-lng')) || (estado.coords[1] + 0.008),
    destNome: btn.getAttribute('data-dest'),
    repasse: btn.getAttribute('data-repasse'),
    km: btn.getAttribute('data-km')
  };

  estado.pedidoEmInspecao = dados;
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  // Desenha linha de visualização prévia no Leaflet
  limparRotasMapa();

  const coordsDestino = [dados.destLat, dados.destLng];
  estado.linhaRota = L.polyline([estado.coords, coordsDestino], {
    color: '#F59E0B',
    weight: 5,
    dashArray: '10, 8',
    opacity: 0.95
  }).addTo(estado.mapa);

  const iconePin = L.divIcon({
    html: '<div style="font-size:26px;filter:drop-shadow(0 0 8px #F59E0B);">🏁</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 26]
  });
  estado.markerDestino = L.marker(coordsDestino, { icon: iconePin }).addTo(estado.mapa);
  estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [70, 70] });

  // Substitui a lista pelo painel detalhado de confirmação
  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--amber); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--amber); background: rgba(245,158,11,0.15); padding: 4px 10px; border-radius: 8px;">
          🔍 ROTA EM ANÁLISE
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        <div>📍 <strong>Destino:</strong> ${dados.destNome}</div>
        <div style="font-size: 11px; color: var(--text-sec); margin-top: 3px;">
          📏 Trajeto aproximado: <strong>${dados.km} km</strong>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin-top: 4px;">
        <button type="button" id="btnCancelarInspecao"
          style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-dark); color: #FFF; font-weight: 700; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✕ Voltar
        </button>
        <button type="button" id="btnConfirmarAposVisualizar"
          style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ✅ Confirmar Corrida
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnCancelarInspecao')?.addEventListener('click', () => {
    limparRotasMapa();
    estado.pedidoEmInspecao = null;
    iniciarRadar();
  });

  document.getElementById('btnConfirmarAposVisualizar')?.addEventListener('click', () => {
    aceitarCorridaDefinitiva(null, dados);
  });
}

// ============================================================================
// 4. ACEITAR CORRIDA DEFINITIVA E ATIVAR NAVEGAÇÃO / CHAT
// ============================================================================
async function aceitarCorridaDefinitiva(btn, dadosCache) {
  const dados = dadosCache || {
    id: btn.getAttribute('data-id'),
    destLat: parseFloat(btn.getAttribute('data-lat')) || (estado.coords[0] + 0.008),
    destLng: parseFloat(btn.getAttribute('data-lng')) || (estado.coords[1] + 0.008),
    destNome: btn.getAttribute('data-dest'),
    repasse: btn.getAttribute('data-repasse')
  };

  try {
    const r = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
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
      iniciarViagemEmAndamento(dados);
    } else {
      alert(resJson.erro || 'Esta corrida já não está disponível.');
      limparRotasMapa();
      estado.pedidoEmInspecao = null;
      iniciarRadar();
    }
  } catch (err) {
    iniciarViagemEmAndamento(dados);
  }
}

function iniciarViagemEmAndamento(dados) {
  estado.pedidoAtivo = dados;
  estado.pedidoEmInspecao = null;
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);

  // Ativa o botão de chat flutuante
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  // Traça rota ativa definitiva
  limparRotasMapa();
  const destinoCoords = [dados.destLat, dados.destLng];

  estado.linhaRota = L.polyline([estado.coords, destinoCoords], {
    color: '#38BDF8',
    weight: 5,
    dashArray: '8, 8',
    opacity: 0.95
  }).addTo(estado.mapa);

  const iconeDestino = L.divIcon({
    html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">📍</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 26]
  });
  estado.markerDestino = L.marker(destinoCoords, { icon: iconeDestino }).addTo(estado.mapa);
  estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });

  // Renderiza card ativo no Dock
  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const urlWaze = `https://waze.com/ul?ll=${dados.destLat},${dados.destLng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${dados.destLat},${dados.destLng}`;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 VIAGEM EM ANDAMENTO
        </span>
        <strong style="color: var(--emerald); font-size: 20px; font-weight: 900;">R$ ${dados.repasse}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4;">
        📍 <strong>Destino:</strong> <span style="color: #94A3B8;">${dados.destNome}</span>
      </div>

      <!-- BOTÕES DE NAVEGAÇÃO EXTERNA (WAZE & GOOGLE MAPS) -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🧭 Abrir Waze
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 11px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Google Maps
        </a>
      </div>

      <!-- BOTÃO DE CONCLUIR VIAGEM -->
      <button type="button" id="btnConcluirViagemAtiva"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 13px; border-radius: 10px; font-size: 14px; cursor: pointer;">
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

  alert('Corrida concluída com sucesso! Valor creditado na sua carteira.');
  sonsHUBy.tocarMetaBatida();

  limparRotasMapa();
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';

  estado.pedidoAtivo = null;
  carregarPerfil();
  iniciarRadar();
}

function limparRotasMapa() {
  if (estado.linhaRota && estado.mapa) {
    estado.mapa.removeLayer(estado.linhaRota);
    estado.linhaRota = null;
  }
  if (estado.markerDestino && estado.mapa) {
    estado.mapa.removeLayer(estado.markerDestino);
    estado.markerDestino = null;
  }
}

// ============================================================================
// 5. SISTEMA DE CHAT INTEGRADO
// ============================================================================
function configurarChat() {
  const modalChat = document.getElementById('modalChatCorrida');
  const btnAbrir = document.getElementById('btnAbrirChat');
  const btnFechar = document.getElementById('btnFecharChat');
  const btnEnviar = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  btnAbrir?.addEventListener('click', () => {
    if (modalChat) {
      modalChat.style.display = 'flex';
      sincronizarChat();
      if (!estado.intervalChat) estado.intervalChat = setInterval(sincronizarChat, 3000);
    }
  });

  btnFechar?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'none';
    if (estado.intervalChat) {
      clearInterval(estado.intervalChat);
      estado.intervalChat = null;
    }
  });

  btnEnviar?.addEventListener('click', enviarMensagemChat);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
  });
}

async function sincronizarChat() {
  if (!estado.pedidoAtivo) return;
  const area = document.getElementById('chatAreaMensagens');
  if (!area) return;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAtivo.id}/chat`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const msgs = await res.json();

    area.innerHTML = msgs.map(m => {
      const souEu = m.remetente_id === estado.motoristaId;
      return `
        <div style="align-self: ${souEu ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${souEu ? 'var(--emerald)' : '#1F2937'}; color: ${souEu ? '#02261C' : '#FFF'}; font-weight: 600; padding: 8px 12px; border-radius: 12px; font-size: 13px;">
          <small style="display:block; font-size:9px; opacity:0.8; margin-bottom:2px;">${m.remetente_nome || 'Mensagem'}</small>
          ${m.mensagem}
        </div>
      `;
    }).join('');
    area.scrollTop = area.scrollHeight;
  } catch (e) { }
}

async function enviarMensagemChat() {
  const input = document.getElementById('inputChatMsg');
  const msg = input?.value?.trim();
  if (!msg || !estado.pedidoAtivo) return;

  try {
    input.value = '';
    await fetch(`${API_URL}/api/pedidos/${estado.pedidoAtivo.id}/chat`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ mensagem: msg })
    });
    sincronizarChat();
  } catch (e) { }
}

// ============================================================================
// 6. PERFIL, DRAWER E SALDO
// ============================================================================
async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/perfil`, { headers: obterHeaders() });
    if (!res.ok) return;
    const m = await res.json();

    if (m.id) {
      estado.motoristaId = m.id;
      estado.motoristaNome = m.nome || 'Carol';
      localStorage.setItem('huby_motorista_id', m.id);
    }

    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    if (topNome) topNome.textContent = (m.nome || 'Carol').split(' ')[0];
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    estado.saldoCarteira = Number(m.saldo_carteira || 1012.07);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');

    if (drawerNome) drawerNome.textContent = m.nome || 'Carol';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'ABC1D23').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Onix';
    if (drawerDetalhes) {
      drawerDetalhes.textContent = `Cor: ${m.veiculo_cor || 'Prata'} • Ano: ${m.veiculo_ano || '2023'}`;
    }

    sincronizarExtratoDiario();
  } catch (e) { }
}

async function sincronizarExtratoDiario() {
  const containerExtrato = document.getElementById('drawerListaExtrato');
  const lblGanhosHoje = document.getElementById('lblGanhosHojeValor');
  const lblViagensHoje = document.getElementById('lblCorridasHojeQtd');

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
    }

    if (lblGanhosHoje) lblGanhosHoje.textContent = `R$ ${totalGanhos.toFixed(2).replace('.', ',')}`;
    if (lblViagensHoje) lblViagensHoje.textContent = `${qtdViagens} viagens`;
  } catch (e) { }
}

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

  configurarChat();
}

document.addEventListener('DOMContentLoaded', () => {
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
  iniciarRadar();
});