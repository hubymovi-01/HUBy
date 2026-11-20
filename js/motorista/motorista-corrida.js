// js/motorista/motorista-corrida.js - Gestão de Corridas, Fila Offline/Reconexão Automática e Navegação 3D
import { API_URL, sonsHUBy, calcularPreco, sincronizarTarifasServidor, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { tracarRotaRealRuas, limparRotasMapa } from './motorista-mapa.js';
import { iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';
import { carregarPerfil } from './motorista-perfil.js';
import { carregarGanhosHoje, carregarExtratoFinanceiro } from './motorista-ganhos.js';
import { iniciarMonitoramentoDesvios, pararMonitoramentoDesvios } from './motorista-rotas.js';
import { fecharChat } from './motorista-chat.js';
import { notificar, confirmarAcao } from '../util/alertas-huby.js';

let processandoPagamento = false;
let intervalPollingPixMotorista = null;
let sincronizandoFilaOffline = false;

const CHAVE_FILA_OFFLINE = 'huby_offline_queue_mot_v1';

// ============================================================================
// MOTOR DE FILA OFFLINE / RECONEXÃO AUTOMÁTICA (PARA REDE 4G INSTÁVEL)
// ============================================================================
function lerFilaOffline() {
  try {
    const raw = localStorage.getItem(CHAVE_FILA_OFFLINE);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function salvarFilaOffline(lista) {
  localStorage.setItem(CHAVE_FILA_OFFLINE, JSON.stringify(lista));
  atualizarBannerReconexao();
}

function atualizarBannerReconexao() {
  const fila = lerFilaOffline();
  const offlineAgora = typeof navigator !== 'undefined' && navigator.onLine === false;
  let banner = document.getElementById('bannerStatusRedeOfflineHUBy');

  if (!offlineAgora && fila.length === 0) {
    if (banner) banner.remove();
    return;
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bannerStatusRedeOfflineHUBy';
    banner.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'right: 0',
      'z-index: 100090',
      'background: linear-gradient(90deg, #B45309, #D97706)',
      'color: #FFF',
      'font-size: 11.5px',
      'font-weight: 800',
      'padding: calc(env(safe-area-inset-top, 0px) + 5px) 12px 5px',
      'text-align: center',
      'box-shadow: 0 2px 10px rgba(0,0,0,0.5)'
    ].join(';');
    document.body.appendChild(banner);
  }

  banner.textContent = offlineAgora
    ? `📡 Sem sinal 4G • Ações salvas localmente (${fila.length} na fila)`
    : `🔄 Reconectando e sincronizando ${fila.length} atualização(ões) pendente(s)...`;
}

function enfileirarRequisicaoOffline(url, method, bodyObj = null, descricao = 'Atualização de corrida') {
  const fila = lerFilaOffline();
  fila.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    url,
    method,
    body: bodyObj,
    descricao,
    criadoEm: new Date().toISOString()
  });
  salvarFilaOffline(fila);
}

export async function processarFilaOfflineMotorista() {
  if (sincronizandoFilaOffline) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    atualizarBannerReconexao();
    return;
  }

  const fila = lerFilaOffline();
  if (fila.length === 0) {
    atualizarBannerReconexao();
    return;
  }

  sincronizandoFilaOffline = true;
  atualizarBannerReconexao();

  const restantes = [];
  let sincronizados = 0;

  for (const item of fila) {
    try {
      const resp = await fetch(item.url, {
        method: item.method,
        headers: obterHeaders(),
        ...(item.body ? { body: JSON.stringify(item.body) } : {})
      });
      if (resp.ok || resp.status === 400 || resp.status === 404 || resp.status === 409) {
        sincronizados++;
      } else {
        restantes.push(item);
      }
    } catch (e) {
      restantes.push(item);
      break;
    }
  }

  salvarFilaOffline(restantes);
  sincronizandoFilaOffline = false;

  if (sincronizados > 0 && restantes.length === 0) {
    notificar(`✅ Conexão restabelecida! ${sincronizados} atualização(ões) sincronizada(s).`, 'sucesso');
    try {
      await carregarPerfil();
      await carregarGanhosHoje();
      await carregarExtratoFinanceiro();
    } catch (e) {}
  }
}

window.addEventListener('online', () => {
  atualizarBannerReconexao();
  processarFilaOfflineMotorista();
});
window.addEventListener('offline', atualizarBannerReconexao);
setInterval(processarFilaOfflineMotorista, 6000);

// ============================================================================
// REAJUSTE DE CÂMERA 3D
// ============================================================================
export function reajustarMapa() {
  if (!estado.mapa) return;

  const refresh = () => {
    estado.mapa.invalidateSize(true);
    if (typeof estado.mapa.fire === 'function') {
      estado.mapa.fire('viewreset');
    }
  };

  [50, 250, 600].forEach(ms => setTimeout(refresh, ms));

  const corridaEmAndamento = !!(estado.pedidoAtivo || estado.pedidoAceitoAtual);

  setTimeout(() => {
    if (!estado.mapa) return;

    if (!corridaEmAndamento && estado.markerOrigem && estado.markerDestino && window.L) {
      const grupoMarkers = window.L.featureGroup([estado.markerOrigem, estado.markerDestino]);
      estado.mapa.fitBounds(grupoMarkers.getBounds(), { padding: [50, 50], animate: true });
    } else if (estado.coords) {
      estado.mapa.panTo(estado.coords, { animate: true, forcar: true });
    }
  }, 300);
}

export function obterValoresSincronizadosPedido(dados = {}) {
  const distKm = parseFloat(dados.dist || dados.distancia_km || dados.distanciaKm || 0);
  const categoria = String(dados.categoria || dados.tipo || estado.categoriaMotorista || 'carro').toLowerCase();
  let valorBruto = Number(dados.preco || dados.valor_total || dados.valorTotal || 0);

  if (distKm > 0 && (!valorBruto || valorBruto <= 0)) {
    valorBruto = calcularPreco(categoria, distKm).valorTotal;
  }

  const taxaPct = Number(TAXA_PLATAFORMA_ATUAL ?? 15);
  const fatorMotorista = Math.max(0.1, (100 - taxaPct) / 100);
  const repasseNum = Number((valorBruto * fatorMotorista).toFixed(2));

  return {
    valorBruto,
    repasseNum,
    taxaPct,
    valorBrutoFmt: valorBruto.toFixed(2).replace('.', ','),
    repasseFmt: repasseNum.toFixed(2).replace('.', ',')
  };
}

export async function executarCancelamentoCorridaMotorista(dados) {
  const pedidoId = dados?.id || estado.pedidoAceitoAtual?.id || estado.pedidoAtivo?.id;
  if (!pedidoId) {
    notificar('Nenhuma corrida ativa encontrada para cancelar.', 'alerta');
    return;
  }

  const confirmar = async () => {
    try {
      const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/cancelar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ motivo: 'Cancelado pelo motorista parceiro' })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.erro || 'Não foi possível cancelar a corrida.');

      if (estado.socket) {
        estado.socket.emit('corrida_cancelada_motorista', { pedidoId: pedidoId });
      }

      pararMonitoramentoDesvios();
      limparRotasMapa();
      fecharChat();

      const btnChat = document.getElementById('btnAbrirChat');
      if (btnChat) btnChat.style.display = 'none';

      estado.pedidoAceitoAtual = null;
      estado.pedidoAtivo = null;
      estado.pedidoEmAnalise = null;
      estado.etapaCorridaAtual = 'a_caminho';
      localStorage.removeItem('huby_corrida_ativa_mot_id');

      notificar(json.mensagem || 'Corrida cancelada com sucesso.', 'alerta');
      await carregarPerfil();
      iniciarRadarChamadas();
      reajustarMapa();
    } catch (err) {
      notificar(err.message || 'Erro ao cancelar corrida.', 'erro');
    }
  };

  if (typeof confirmarAcao === 'function') {
    confirmarAcao({
      titulo: 'Cancelar Corrida?',
      mensagem: 'Tem certeza que deseja cancelar esta viagem? O passageiro será notificado na hora.',
      textoConfirmar: 'Sim, Cancelar Corrida',
      onConfirmar: confirmar
    });
  } else if (window.confirm('Tem certeza que deseja cancelar esta corrida?')) {
    await confirmar();
  }
}

export async function preVisualizarRotaPedido(dados) {
  await sincronizarTarifasServidor();
  estado.pedidoEmAnalise = dados;
  pararRadarChamadas();
  pararMonitoramentoDesvios();
  limparRotasMapa();

  const coordsOrigem = dados.coordsOrig || [estado.coords[0] + 0.003, estado.coords[1] + 0.003];
  const coordsDestino = dados.coordsDest || [estado.coords[0] + 0.009, estado.coords[1] + 0.009];

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { repasseFmt } = obterValoresSincronizadosPedido(dados);

  container.innerHTML = `
    <div id="modalPreviaRotaCorrida" style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--amber); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--amber); background: rgba(245,158,11,0.15); padding: 4px 10px; border-radius: 8px;">
          🔍 ROTA EM ANÁLISE
        </span>
        <div style="text-align: right;">
          <strong style="color: var(--emerald); font-size: 22px; font-weight: 900; display: block; letter-spacing: -0.5px;">R$ ${repasseFmt}</strong>
          <small style="color: #94A3B8; font-size: 10px; font-weight: 600;">Ganhos Limpos</small>
        </div>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px;">
        <div style="color: #94A3B8; margin-bottom: 4px;"><strong style="color:#10B981;">A</strong> ${dados.origem}</div>
        <div><strong style="color:#EF4444;">B</strong> ${dados.destino}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          📏 <span id="lblPreviaDistKm">${dados.dist || '1.0'} km</span> • ⏱️ ~<span id="lblPreviaDurMin">${dados.dur || 5} min</span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 8px; margin-top: 4px;">
        <button type="button" id="btnCancelarPreviaRota"
          style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15); color: #FFF; font-weight: 800; padding: 12px; border-radius: 12px; font-size: 13px; cursor: pointer;">
          ✕ Voltar
        </button>
        <button type="button" id="btnConfirmarAceiteViagem"
          style="background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 12px; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🚀 Aceitar Corrida
        </button>
      </div>
    </div>
  `;

  if (estado.mapa && window.L) {
    estado.markerOrigem = window.L.marker(coordsOrigem, {
      icon: window.L.divIcon({ html: '<div style="font-size:24px;">🟢</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
    }).addTo(estado.mapa);

    estado.markerDestino = window.L.marker(coordsDestino, {
      icon: window.L.divIcon({ html: '<div style="font-size:24px;">🏁</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(coordsOrigem, coordsDestino, '#F59E0B');
  }

  reajustarMapa();

  document.getElementById('btnCancelarPreviaRota')?.addEventListener('click', () => {
    limparRotasMapa();
    pararMonitoramentoDesvios();
    estado.pedidoEmAnalise = null;
    iniciarRadarChamadas();
    reajustarMapa();
  });

  document.getElementById('btnConfirmarAceiteViagem')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '⏳ Confirmando...';
    aceitarCorrida(dados);
  });
}

export async function aceitarPedidoPrevia() {
  if (estado.pedidoEmAnalise) {
    await aceitarCorrida(estado.pedidoEmAnalise);
  }
}

export async function aceitarCorrida(dados) {
  try {
    const res = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({
        motoristaId: estado.motoristaId || localStorage.getItem('huby_motorista_id'),
        motoristaNome: estado.motoristaNome || localStorage.getItem('huby_user_name') || 'Motorista'
      })
    });

    const resJson = await res.json().catch(() => ({}));

    if (res.ok || resJson.sucesso) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();

      if (estado.socket) {
        estado.socket.emit('motorista_aceitou', {
          pedidoId: dados.id,
          motoristaId: estado.motoristaId
        });
      }

      iniciarFaseBuscarPassageiro(dados);
    } else {
      notificar(resJson.erro || 'Esta corrida já não está disponível.', 'alerta');
      limparRotasMapa();
      pararMonitoramentoDesvios();
      estado.pedidoEmAnalise = null;
      iniciarRadarChamadas();
      reajustarMapa();
    }
  } catch (err) {
    enfileirarRequisicaoOffline(
      `${API_URL}/api/pedidos/${dados.id}/aceitar`,
      'PUT',
      {
        motoristaId: estado.motoristaId || localStorage.getItem('huby_motorista_id'),
        motoristaNome: estado.motoristaNome || localStorage.getItem('huby_user_name') || 'Motorista'
      },
      'Aceitar corrida'
    );
    iniciarFaseBuscarPassageiro(dados);
  }
}

async function iniciarFaseBuscarPassageiro(dados) {
  estado.pedidoAceitoAtual = dados;
  estado.pedidoAtivo = dados;
  estado.pedidoEmAnalise = null;
  estado.etapaCorridaAtual = 'a_caminho';
  localStorage.setItem('huby_corrida_ativa_mot_id', dados.id);
  pararRadarChamadas();

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  limparRotasMapa();
  const coordsOrigem = dados.coordsOrig || [estado.coords[0] + 0.003, estado.coords[1] + 0.003];

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { repasseFmt } = obterValoresSincronizadosPedido(dados);
  const urlWaze = `https://waze.com/ul?ll=${coordsOrigem[0]},${coordsOrigem[1]}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${coordsOrigem[0]},${coordsOrigem[1]}`;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--blue); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
          🚗 A CAMINHO DO PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900; letter-spacing: -0.5px;">R$ ${repasseFmt}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px;">
        <div style="color: #94A3B8;"><strong style="color:#10B981;">A</strong> ${dados.origem}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          📏 ${dados.dist || '1.0'} km • ⏱️ ~${dados.dur || 5} min
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🧭 Waze
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🗺️ Maps
        </a>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" id="btnChegueiLocalEmbarque"
          style="background: rgba(56,189,248,0.18); border: 1.5px solid #38BDF8; color: #38BDF8; font-weight: 900; padding: 13px; border-radius: 12px; font-size: 13px; cursor: pointer;">
          📍 Cheguei Aqui
        </button>
        <button type="button" id="btnIniciarCorridaAtiva"
          style="background: #38BDF8; border: none; color: #000; font-weight: 900; padding: 13px; border-radius: 12px; font-size: 13px; cursor: pointer;">
          🚀 Iniciar Viagem
        </button>
      </div>

      <button type="button" id="btnCancelarCorridaMotoristaAtiva"
        style="width: 100%; background: transparent; border: none; color: #94A3B8; font-weight: 800; padding: 6px; border-radius: 8px; font-size: 11px; cursor: pointer; text-decoration: underline;">
        Cancelar Corrida
      </button>
    </div>
  `;

  if (estado.mapa && window.L) {
    estado.markerOrigem = window.L.marker(coordsOrigem, {
      icon: window.L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">👤</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(estado.coords, coordsOrigem, '#38BDF8');
  }

  iniciarMonitoramentoDesvios(coordsOrigem);
  reajustarMapa();

  document.getElementById('btnChegueiLocalEmbarque')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.innerHTML = '⏳ Avisando...';
    const url = `${API_URL}/api/pedidos/${dados.id}/status`;
    const bodyObj = { status: 'chegou_local' };

    try {
      const resp = await fetch(url, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify(bodyObj)
      });
      if (!resp.ok) throw new Error();
      if (estado.socket) estado.socket.emit('motorista_chegou', { pedidoId: dados.id });
      notificar('📍 Passageiro avisado que você chegou ao local de embarque!', 'sucesso');
    } catch (err) {
      enfileirarRequisicaoOffline(url, 'PUT', bodyObj, 'Chegada ao embarque');
      notificar('📡 Sinal fraco: chegada salva e será enviada assim que reconectar.', 'aviso');
    }

    btn.innerHTML = '✅ Passageiro Avisado';
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.borderColor = '#10B981';
    btn.style.color = '#10B981';
  });

  document.getElementById('btnIniciarCorridaAtiva')?.addEventListener('click', () => confirmarEmbarqueEIrAoDestino(dados));
  document.getElementById('btnCancelarCorridaMotoristaAtiva')?.addEventListener('click', () => executarCancelamentoCorridaMotorista(dados));
}

export async function confirmarEmbarqueEIrAoDestino(dados) {
  const urlEmbarque = `${API_URL}/api/pedidos/${dados.id}/embarque`;
  try {
    const resp = await fetch(urlEmbarque, {
      method: 'PUT',
      headers: obterHeaders()
    });
    if (!resp.ok) throw new Error();
    if (estado.socket) estado.socket.emit('corrida_iniciada', { pedidoId: dados.id });
  } catch (e) {
    enfileirarRequisicaoOffline(urlEmbarque, 'PUT', null, 'Embarque do passageiro');
    notificar('📡 Modo offline: embarque registrado na fila de sincronização.', 'aviso');
  }

  estado.etapaCorridaAtual = 'em_viagem';
  if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();

  limparRotasMapa();
  const coordsDestino = dados.coordsDest || [estado.coords[0] + 0.009, estado.coords[1] + 0.009];

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { repasseFmt } = obterValoresSincronizadosPedido(dados);
  const urlWaze = `https://waze.com/ul?ll=${coordsDestino[0]},${coordsDestino[1]}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${coordsDestino[0]},${coordsDestino[1]}`;

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 EM VIAGEM
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900; letter-spacing: -0.5px;">R$ ${repasseFmt}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px;">
        <div style="color: #94A3B8;"><strong style="color:#EF4444;">B</strong> ${dados.destino}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          📏 ${dados.dist || '1.0'} km • ⏱️ ~${dados.dur || 5} min
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <a href="${urlWaze}" target="_blank" rel="noopener"
          style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🧭 Waze (Destino)
        </a>
        <a href="${urlGoogle}" target="_blank" rel="noopener"
          style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
          🗺️ Maps (Destino)
        </a>
      </div>

      <button type="button" id="btnConcluirCorrida"
        style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 14px; border-radius: 12px; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;">
        🏁 Cheguei ao Destino / Cobrar
      </button>

      <button type="button" id="btnCancelarCorridaMotoristaViagem"
        style="width: 100%; background: transparent; border: none; color: #94A3B8; font-weight: 800; padding: 6px; border-radius: 8px; font-size: 11px; cursor: pointer; text-decoration: underline;">
        Cancelar Corrida
      </button>
    </div>
  `;

  if (estado.mapa && window.L) {
    estado.markerDestino = window.L.marker(coordsDestino, {
      icon: window.L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #10B981);">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    await tracarRotaRealRuas(estado.coords, coordsDestino, '#10B981');
  }

  iniciarMonitoramentoDesvios(coordsDestino);
  reajustarMapa();

  document.getElementById('btnConcluirCorrida')?.addEventListener('click', () => abrirModalOpcoesPagamento(dados));
  document.getElementById('btnCancelarCorridaMotoristaViagem')?.addEventListener('click', () => executarCancelamentoCorridaMotorista(dados));
}

export function abrirModalOpcoesPagamento(dados) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const lblValor = document.getElementById('lblValorTotalPagamentoMotorista');

  const { valorBrutoFmt } = obterValoresSincronizadosPedido(dados);
  if (lblValor) {
    lblValor.textContent = `R$ ${valorBrutoFmt}`;
  }

  const btnDinheiro = document.getElementById('btnPagarDinheiro');
  const btnMaquininha = document.getElementById('btnPagarMaquininha');
  const btnPixMP = document.getElementById('btnPagarPixMP');
  const btnCancelar = document.getElementById('btnCancelarModalPagamento');

  if (btnDinheiro) btnDinheiro.style.display = estado.aceitaDinheiro ? 'flex' : 'none';
  if (btnMaquininha) btnMaquininha.style.display = estado.aceitaCartao ? 'flex' : 'none';
  if (btnPixMP) btnPixMP.style.display = estado.aceitaPix ? 'flex' : 'none';

  if (!estado.aceitaDinheiro && !estado.aceitaCartao && !estado.aceitaPix) {
    if (btnDinheiro) btnDinheiro.style.display = 'flex';
    if (btnMaquininha) btnMaquininha.style.display = 'flex';
    if (btnPixMP) btnPixMP.style.display = 'flex';
  }

  if (modal) modal.style.display = 'flex';

  if (btnDinheiro) btnDinheiro.onclick = () => processarLiquidacao(dados.id, 'dinheiro');
  if (btnMaquininha) btnMaquininha.onclick = () => processarLiquidacao(dados.id, 'cartao_maquininha');
  if (btnPixMP) btnPixMP.onclick = () => processarLiquidacao(dados.id, 'pix_mp');
  if (btnCancelar) {
    btnCancelar.onclick = () => {
      if (modal) modal.style.display = 'none';
    };
  }
}

export async function processarLiquidacao(pedidoId, formaPagamento) {
  if (processandoPagamento) return;
  processandoPagamento = true;

  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const botoes = modal ? modal.querySelectorAll('.btn-metodo-pagto') : [];
  botoes.forEach(b => b.style.opacity = '0.5');

  const urlLiquidar = `${API_URL}/api/pedidos/${pedidoId}/finalizar-liquidacao`;

  try {
    const res = await fetch(urlLiquidar, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({ forma_pagamento: formaPagamento })
    });

    const textoResposta = await res.text();
    let data;
    try {
      data = JSON.parse(textoResposta);
    } catch (eJson) {
      throw new Error('Falha ao processar pagamento com o servidor.');
    }

    if (!res.ok) {
      throw new Error(data.erro || `Falha na liquidação (HTTP: ${res.status})`);
    }

    if (modal) modal.style.display = 'none';

    if (formaPagamento === 'pix_mp') {
      exibirQrCodePixMotorista(data.pix);
    } else {
      if (estado.socket) {
        estado.socket.emit('corrida_finalizada_motorista', {
          pedidoId: pedidoId,
          formaPagamento: formaPagamento
        });
      }

      const taxa = Number(TAXA_PLATAFORMA_ATUAL || 15);
      notificar(`✅ Corrida encerrada com sucesso! Taxa de ${taxa}% atualizada na carteira.`, 'sucesso');
      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      await concluirLimpezaPosCorrida();
    }
  } catch (err) {
    // Se caiu a internet na finalização presencial (Dinheiro ou Maquininha), salva na fila offline e libera o motorista sem travar!
    if (formaPagamento === 'dinheiro' || formaPagamento === 'cartao_maquininha') {
      enfileirarRequisicaoOffline(urlLiquidar, 'POST', { forma_pagamento: formaPagamento }, 'Finalização de corrida');
      if (modal) modal.style.display = 'none';
      notificar('📡 Sem internet: conclusão salva localmente e será sincronizada ao voltar o sinal!', 'aviso', 5000);
      await concluirLimpezaPosCorrida();
    } else {
      notificar(err.message || 'Sem sinal para gerar QR Code Pix agora. Tente novamente ou receba presencialmente.', 'erro');
    }
  } finally {
    botoes.forEach(b => b.style.opacity = '1');
    processandoPagamento = false;
  }
}

export function exibirQrCodePixMotorista(pix) {
  const modalPix = document.getElementById('modalExibicaoPixMotorista');
  const imgQr = document.getElementById('imgQrCodePixMotorista');
  const lblValor = document.getElementById('lblValorPixMotorista');
  const btnFechar = document.getElementById('btnFecharPixMotorista');

  if (lblValor) lblValor.textContent = `R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}`;
  if (imgQr) imgQr.src = `data:image/png;base64,${pix.qr_code_base64}`;

  if (modalPix) modalPix.style.display = 'flex';

  const txid = pix.txid || pix.transacao_id;
  const pedidoId = pix.pedido_id || estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id || '';
  let jaConfirmado = false;

  const limparMonitoramento = () => {
    if (intervalPollingPixMotorista) {
      clearInterval(intervalPollingPixMotorista);
      intervalPollingPixMotorista = null;
    }
  };

  const concluirAoConfirmarPix = async () => {
    if (jaConfirmado) return;
    jaConfirmado = true;
    limparMonitoramento();

    const taxaPct = Number(TAXA_PLATAFORMA_ATUAL ?? 15);
    const repasse = Number((Number(pix.valor || 0) * ((100 - taxaPct) / 100)).toFixed(2));
    const repasseFmt = repasse.toFixed(2).replace('.', ',');

    if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();

    if (lblValor) {
      lblValor.innerHTML = `<span style="color:#10B981;">✅ PIX CONFIRMADO! (+R$ ${repasseFmt})</span>`;
    }

    if (estado.socket) {
      estado.socket.emit('corrida_finalizada_motorista', {
        pedidoId: pedidoId,
        formaPagamento: 'pix_mp'
      });
    }

    notificar(`🎉 Pagamento Pix confirmado! +R$ ${repasseFmt} (${100 - taxaPct}%) creditados na sua carteira!`, 'sucesso', 5000);

    setTimeout(async () => {
      if (modalPix) modalPix.style.display = 'none';
      await concluirLimpezaPosCorrida();
    }, 1500);
  };

  const socketAtivo = estado.socket || estado.socketRadar;
  if (socketAtivo && pedidoId) {
    socketAtivo.once(`corrida_finalizada_${pedidoId}`, concluirAoConfirmarPix);
    socketAtivo.once(`pix_confirmado_${pedidoId}`, concluirAoConfirmarPix);
  }

  limparMonitoramento();
  intervalPollingPixMotorista = setInterval(async () => {
    try {
      if (txid) {
        const urlStatus = `${API_URL}/api/carteira/pix/status/${encodeURIComponent(txid)}?pedidoId=${encodeURIComponent(pedidoId)}&t=${Date.now()}`;
        const res = await fetch(urlStatus, { cache: 'no-store', headers: obterHeaders() });
        if (res.ok) {
          const statusData = await res.json();
          if (statusData.status === 'pago') {
            await concluirAoConfirmarPix();
            return;
          }
        }
      }
      if (pedidoId) {
        const resPed = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(pedidoId)}/status?t=${Date.now()}`, { cache: 'no-store', headers: obterHeaders() });
        if (resPed.ok) {
          const p = await resPed.json();
          if (String(p.status).toLowerCase() === 'concluido') {
            await concluirAoConfirmarPix();
          }
        }
      }
    } catch (e) {}
  }, 2500);

  if (btnFechar) {
    btnFechar.onclick = async () => {
      limparMonitoramento();
      if (modalPix) modalPix.style.display = 'none';
      await concluirLimpezaPosCorrida();
    };
  }
}

export function fecharModaisPagamento() {
  if (intervalPollingPixMotorista) {
    clearInterval(intervalPollingPixMotorista);
    intervalPollingPixMotorista = null;
  }
  const modal1 = document.getElementById('modalEscolhaPagamentoMotorista');
  const modal2 = document.getElementById('modalExibicaoPixMotorista');
  if (modal1) modal1.style.display = 'none';
  if (modal2) modal2.style.display = 'none';
}

export async function concluirLimpezaPosCorrida() {
  pararMonitoramentoDesvios();
  limparRotasMapa();
  fecharChat();
  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';

  estado.pedidoAceitoAtual = null;
  estado.pedidoAtivo = null;
  estado.etapaCorridaAtual = 'a_caminho';
  localStorage.removeItem('huby_corrida_ativa_mot_id');

  try {
    await carregarPerfil();
    await carregarGanhosHoje();
    await carregarExtratoFinanceiro();
  } catch (e) {}
  iniciarRadarChamadas();
  reajustarMapa();
}