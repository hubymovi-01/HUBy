// js/motorista/motorista-corrida.js - Gestão de Corridas, Fila Offline/Reconexão Automática e Navegação 3D
// Segurança: endereços do passageiro são exibidos como texto puro; o aceite SEMPRE depende da confirmação do servidor.
import { API_URL, sonsHUBy, calcularPreco, sincronizarTarifasServidor } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { tracarRotaRealRuas, limparRotasMapa } from './motorista-mapa.js';
import { iniciarRadarChamadas, pararRadarChamadas, taxaDoMotorista } from './motorista-radar.js';
import { carregarPerfil } from './motorista-perfil.js';
import { carregarGanhosHoje, carregarExtratoFinanceiro } from './motorista-ganhos.js';
import { iniciarMonitoramentoDesvios, pararMonitoramentoDesvios } from './motorista-rotas.js';
import { fecharChat } from './motorista-chat.js';
import { notificar, confirmarAcao } from '../util/alertas-huby.js';

let processandoPagamento = false;
let aceitandoAgora = false;
let intervalPollingPixMotorista = null;
let sincronizandoFilaOffline = false;

const CHAVE_FILA_OFFLINE = 'huby_offline_queue_mot_v1';
const MAX_ITENS_FILA = 20;

// ============================================================================
// AJUDANTES
// ============================================================================
function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function coordsValidas(c) {
  if (!Array.isArray(c) || c.length < 2) return null;
  const lat = Number(c[0]);
  const lng = Number(c[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if ((lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}

function textoDistDur(dados) {
  const dist = Number.parseFloat(dados?.dist);
  const dur = Number.parseInt(dados?.dur, 10);
  const partes = [];
  partes.push(Number.isFinite(dist) && dist > 0 ? `📏 ${dist.toFixed(1)} km` : '📏 -- km');
  partes.push(Number.isFinite(dur) && dur > 0 ? `⏱️ ~${dur} min` : '⏱️ -- min');
  return escaparHTML(partes.join(' • '));
}

function botoesNavegacaoHTML(coords, sufixo = '') {
  if (!coords) {
    return `
      <div style="font-size: 12px; color: #FBBF24; background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.35); padding: 9px 10px; border-radius: 10px; text-align: center; font-weight: 700;">
        📍 Localização exata indisponível. Confira o endereço acima ou fale com o passageiro pelo chat.
      </div>
    `;
  }
  const [lat, lng] = coords;
  const urlWaze = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  const urlGoogle = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <a href="${urlWaze}" target="_blank" rel="noopener noreferrer"
        style="background: #33CCFF; color: #000; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
        🧭 Waze${sufixo}
      </a>
      <a href="${urlGoogle}" target="_blank" rel="noopener noreferrer"
        style="background: #EA4335; color: #FFF; font-weight: 900; text-align: center; padding: 12px; border-radius: 12px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;">
        🗺️ Maps${sufixo}
      </a>
    </div>
  `;
}

// ============================================================================
// FILA OFFLINE (SÓ PARA AÇÕES DE UMA CORRIDA QUE JÁ É DO MOTORISTA)
// Chegada ao embarque, embarque e finalização presencial podem esperar o sinal voltar.
// O ACEITE nunca entra na fila: só vale quando o servidor confirma.
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
  localStorage.setItem(CHAVE_FILA_OFFLINE, JSON.stringify(lista.slice(-MAX_ITENS_FILA)));
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
    ? `📡 Sem sinal • ${fila.length} ação(ões) aguardando para enviar`
    : `🔄 Reconectando e enviando ${fila.length} ação(ões) pendente(s)...`;
}

function enfileirarRequisicaoOffline(caminho, method, bodyObj = null, descricao = 'Atualização de corrida') {
  const fila = lerFilaOffline();
  fila.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    caminho,            // só o caminho (ex.: /api/pedidos/12/embarque); o endereço do servidor é sempre o oficial
    method,
    body: bodyObj,
    descricao: String(descricao).slice(0, 80),
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
  const recusadas = [];
  let enviadas = 0;
  let parar = false;

  for (const item of fila) {
    if (parar) {
      restantes.push(item);
      continue;
    }

    const caminho = String(item.caminho || '');
    // Só aceita caminhos da própria API de pedidos (ignora itens estranhos ou de versões antigas)
    if (!/^\/api\/pedidos\/[A-Za-z0-9_-]+\/(status|embarque|finalizar-liquidacao)$/.test(caminho)) {
      continue;
    }

    try {
      const resp = await fetch(`${API_URL}${caminho}`, {
        method: item.method,
        headers: obterHeaders(),
        ...(item.body ? { body: JSON.stringify(item.body) } : {})
      });

      if (resp.ok) {
        enviadas++;
      } else if (resp.status === 401) {
        // Sessão expirou: guarda tudo até o motorista entrar de novo
        restantes.push(item);
        parar = true;
      } else if (resp.status >= 400 && resp.status < 500) {
        // O servidor recusou (ex.: corrida já cancelada): não adianta repetir, mas o motorista PRECISA saber
        const json = await resp.json().catch(() => ({}));
        recusadas.push(`${item.descricao}: ${json.erro || 'recusada pelo servidor'}`);
      } else {
        restantes.push(item);
      }
    } catch (e) {
      restantes.push(item);
      parar = true; // sem rede de novo: tenta depois
    }
  }

  salvarFilaOffline(restantes);
  sincronizandoFilaOffline = false;

  if (recusadas.length > 0) {
    notificar(`⚠️ Não foi possível registrar: ${recusadas.join(' | ')}. Se precisar, fale com o suporte.`, 'erro', 12000);
  }

  if (enviadas > 0 && restantes.length === 0) {
    notificar(`✅ Conexão restabelecida! ${enviadas} ação(ões) enviada(s).`, 'sucesso');
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

// Valores da corrida com a taxa do NÍVEL do motorista
export function obterValoresSincronizadosPedido(dados = {}) {
  const distKm = parseFloat(dados.dist || dados.distancia_km || dados.distanciaKm || 0) || 0;
  const categoria = String(dados.categoria || dados.tipo || estado.categoriaMotorista || 'carro').toLowerCase();
  let valorBruto = Number(dados.preco || dados.valor_total || dados.valorTotal || 0);

  if (distKm > 0 && (!valorBruto || valorBruto <= 0)) {
    valorBruto = calcularPreco(categoria, distKm).valorTotal;
  }
  if (!Number.isFinite(valorBruto) || valorBruto < 0) valorBruto = 0;

  const taxaPct = taxaDoMotorista();
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
      const res = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(pedidoId)}/cancelar`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ motivo: 'Cancelado pelo motorista parceiro' })
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.erro || 'Não foi possível cancelar a corrida.');

      notificar(json.mensagem || 'Corrida cancelada com sucesso.', 'alerta');
      await concluirLimpezaPosCorrida();
    } catch (err) {
      const semRede = err instanceof TypeError;
      notificar(semRede ? 'Sem conexão. A corrida NÃO foi cancelada.' : (err.message || 'Erro ao cancelar corrida.'), 'erro');
    }
  };

  if (typeof confirmarAcao === 'function') {
    confirmarAcao({
      titulo: 'Cancelar Corrida?',
      mensagem: 'Tem certeza que deseja cancelar esta viagem? O passageiro será notificado na hora.',
      textoConfirmar: 'Sim, Cancelar Corrida',
      perigo: true,
      onConfirmar: confirmar
    });
  } else if (window.confirm('Tem certeza que deseja cancelar esta corrida?')) {
    await confirmar();
  }
}

// ============================================================================
// PRÉ-VISUALIZAÇÃO DA CHAMADA (ANTES DE ACEITAR)
// ============================================================================
function voltarAoRadar() {
  limparRotasMapa();
  pararMonitoramentoDesvios();
  estado.pedidoEmAnalise = null;
  iniciarRadarChamadas();
  reajustarMapa();
}

export async function preVisualizarRotaPedido(dados) {
  if (!dados || !dados.id) return;
  await sincronizarTarifasServidor();
  estado.pedidoEmAnalise = dados;
  pararRadarChamadas();
  pararMonitoramentoDesvios();
  limparRotasMapa();

  const coordsOrigem = coordsValidas(dados.coordsOrig);
  const coordsDestino = coordsValidas(dados.coordsDest);

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
          <strong style="color: var(--emerald); font-size: 22px; font-weight: 900; display: block; letter-spacing: -0.5px;">R$ ${escaparHTML(repasseFmt)}</strong>
          <small style="color: #94A3B8; font-size: 10px; font-weight: 600;">Ganhos Limpos</small>
        </div>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px; word-break: break-word;">
        <div style="color: #94A3B8; margin-bottom: 4px;"><strong style="color:#10B981;">A</strong> ${escaparHTML(dados.origem)}</div>
        <div><strong style="color:#EF4444;">B</strong> ${escaparHTML(dados.destino)}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          ${textoDistDur(dados)}
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

  document.getElementById('btnCancelarPreviaRota')?.addEventListener('click', voltarAoRadar);

  document.getElementById('btnConfirmarAceiteViagem')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Confirmando...';
    aceitarCorrida(dados);
  });

  if (estado.mapa && window.L) {
    if (coordsOrigem) {
      estado.markerOrigem = window.L.marker(coordsOrigem, {
        icon: window.L.divIcon({ html: '<div style="font-size:24px;">🟢</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
      }).addTo(estado.mapa);
    }
    if (coordsDestino) {
      estado.markerDestino = window.L.marker(coordsDestino, {
        icon: window.L.divIcon({ html: '<div style="font-size:24px;">🏁</div>', iconSize: [26, 26], iconAnchor: [13, 24] })
      }).addTo(estado.mapa);
    }
    if (coordsOrigem && coordsDestino) {
      await tracarRotaRealRuas(coordsOrigem, coordsDestino, '#F59E0B');
    }
  }

  reajustarMapa();
}

export async function aceitarPedidoPrevia() {
  if (estado.pedidoEmAnalise) {
    await aceitarCorrida(estado.pedidoEmAnalise);
  }
}

// O aceite SÓ vale com a confirmação do servidor (outro motorista pode ter pego a corrida)
export async function aceitarCorrida(dados) {
  if (aceitandoAgora || !dados?.id) return;
  aceitandoAgora = true;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(dados.id)}/aceitar`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({})
    });

    const resJson = await res.json().catch(() => ({}));

    if (res.ok) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      await iniciarFaseBuscarPassageiro(dados);
    } else {
      notificar(resJson.erro || 'Esta corrida já não está disponível.', 'alerta');
      voltarAoRadar();
    }
  } catch (err) {
    notificar('Sem conexão. A corrida NÃO foi aceita. Verifique o sinal e tente de novo.', 'erro', 6000);
    voltarAoRadar();
  } finally {
    aceitandoAgora = false;
  }
}

// ============================================================================
// FASE 1: INDO BUSCAR O PASSAGEIRO
// ============================================================================
async function iniciarFaseBuscarPassageiro(dados) {
  estado.pedidoAceitoAtual = dados;
  estado.pedidoAtivo = dados;
  estado.pedidoEmAnalise = null;
  estado.etapaCorridaAtual = 'a_caminho';
  localStorage.setItem('huby_corrida_ativa_mot_id', String(dados.id));
  pararRadarChamadas();

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'flex';

  limparRotasMapa();
  const coordsOrigem = coordsValidas(dados.coordsOrig);

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { repasseFmt } = obterValoresSincronizadosPedido(dados);

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--blue); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 4px 10px; border-radius: 8px;">
          🚗 A CAMINHO DO PASSAGEIRO
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900; letter-spacing: -0.5px;">R$ ${escaparHTML(repasseFmt)}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px; word-break: break-word;">
        <div style="color: #94A3B8;"><strong style="color:#10B981;">A</strong> ${escaparHTML(dados.origem)}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          ${textoDistDur(dados)}
        </div>
      </div>

      ${botoesNavegacaoHTML(coordsOrigem)}

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

  document.getElementById('btnChegueiLocalEmbarque')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Avisando...';

    const caminho = `/api/pedidos/${encodeURIComponent(dados.id)}/status`;
    const bodyObj = { status: 'chegou_local' };
    let avisado = false;

    try {
      const resp = await fetch(`${API_URL}${caminho}`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify(bodyObj)
      });
      if (resp.ok) {
        avisado = true;
        if (estado.socket) estado.socket.emit('motorista_chegou', { pedidoId: dados.id });
        notificar('📍 Passageiro avisado que você chegou ao local de embarque!', 'sucesso');
      } else {
        const json = await resp.json().catch(() => ({}));
        notificar(json.erro || 'Não foi possível avisar a chegada agora.', 'erro');
        btn.disabled = false;
        btn.textContent = '📍 Cheguei Aqui';
        return;
      }
    } catch (err) {
      enfileirarRequisicaoOffline(caminho, 'PUT', bodyObj, 'Chegada ao embarque');
      notificar('📡 Sinal fraco: o aviso de chegada será enviado assim que a internet voltar.', 'aviso');
    }

    btn.textContent = avisado ? '✅ Passageiro Avisado' : '⏳ Aviso na fila';
    btn.style.background = avisado ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.18)';
    btn.style.borderColor = avisado ? '#10B981' : '#F59E0B';
    btn.style.color = avisado ? '#10B981' : '#FBBF24';
  });

  document.getElementById('btnIniciarCorridaAtiva')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Iniciando...';
    confirmarEmbarqueEIrAoDestino(dados).finally(() => {
      if (document.body.contains(btn)) {
        btn.disabled = false;
        btn.textContent = '🚀 Iniciar Viagem';
      }
    });
  });
  document.getElementById('btnCancelarCorridaMotoristaAtiva')?.addEventListener('click', () => executarCancelamentoCorridaMotorista(dados));

  if (estado.mapa && window.L && coordsOrigem) {
    estado.markerOrigem = window.L.marker(coordsOrigem, {
      icon: window.L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #38BDF8);">👤</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    const partida = coordsValidas(estado.coords);
    if (partida) await tracarRotaRealRuas(partida, coordsOrigem, '#38BDF8');
    iniciarMonitoramentoDesvios(coordsOrigem);
  }

  reajustarMapa();
}

// ============================================================================
// FASE 2: PASSAGEIRO A BORDO, INDO AO DESTINO
// ============================================================================
export async function confirmarEmbarqueEIrAoDestino(dados) {
  const caminho = `/api/pedidos/${encodeURIComponent(dados.id)}/embarque`;
  try {
    const resp = await fetch(`${API_URL}${caminho}`, {
      method: 'PUT',
      headers: obterHeaders()
    });
    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}));
      notificar(json.erro || 'Não foi possível iniciar a viagem agora.', 'erro');
      return;
    }
  } catch (e) {
    enfileirarRequisicaoOffline(caminho, 'PUT', null, 'Embarque do passageiro');
    notificar('📡 Sem sinal: o embarque será enviado assim que a internet voltar.', 'aviso');
  }

  estado.etapaCorridaAtual = 'em_viagem';
  if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();

  pararMonitoramentoDesvios();
  limparRotasMapa();
  const coordsDestino = coordsValidas(dados.coordsDest);

  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  const { repasseFmt } = obterValoresSincronizadosPedido(dados);

  container.innerHTML = `
    <div style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid var(--emerald); border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 11px; box-shadow: 0 8px 30px rgba(0,0,0,0.6);">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 800; color: var(--emerald); background: rgba(16,185,129,0.15); padding: 4px 10px; border-radius: 8px;">
          🚀 EM VIAGEM
        </span>
        <strong style="color: var(--emerald); font-size: 21px; font-weight: 900; letter-spacing: -0.5px;">R$ ${escaparHTML(repasseFmt)}</strong>
      </div>

      <div style="font-size: 13px; color: #FFF; line-height: 1.4; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 10px; word-break: break-word;">
        <div style="color: #94A3B8;"><strong style="color:#EF4444;">B</strong> ${escaparHTML(dados.destino)}</div>
        <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05);">
          ${textoDistDur(dados)}
        </div>
      </div>

      ${botoesNavegacaoHTML(coordsDestino, ' (Destino)')}

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

  document.getElementById('btnConcluirCorrida')?.addEventListener('click', () => abrirModalOpcoesPagamento(dados));
  document.getElementById('btnCancelarCorridaMotoristaViagem')?.addEventListener('click', () => executarCancelamentoCorridaMotorista(dados));

  if (estado.mapa && window.L && coordsDestino) {
    estado.markerDestino = window.L.marker(coordsDestino, {
      icon: window.L.divIcon({ html: '<div style="font-size:28px;filter:drop-shadow(0 0 10px #10B981);">🏁</div>', iconSize: [28, 28], iconAnchor: [14, 26] })
    }).addTo(estado.mapa);

    const partida = coordsValidas(estado.coords);
    if (partida) await tracarRotaRealRuas(partida, coordsDestino, '#10B981');
    iniciarMonitoramentoDesvios(coordsDestino);
  }

  reajustarMapa();
}

// ============================================================================
// PAGAMENTO E FINALIZAÇÃO
// ============================================================================
export function abrirModalOpcoesPagamento(dados) {
  const modal = document.getElementById('modalEscolhaPagamentoMotorista');
  const lblValor = document.getElementById('lblValorTotalPagamentoMotorista');

  const { valorBrutoFmt, taxaPct } = obterValoresSincronizadosPedido(dados);
  if (lblValor) {
    lblValor.textContent = `R$ ${valorBrutoFmt}`;
  }

  // Textos de taxa sempre com a taxa do nível do motorista
  const lblTaxaModal = document.getElementById('lblTaxaModalPagamento');
  if (lblTaxaModal) lblTaxaModal.textContent = `Taxa HUBy: ${taxaPct}% retidos pela plataforma`;
  const lblTaxaDin = document.getElementById('lblTaxaDinheiroDesc');
  if (lblTaxaDin) lblTaxaDin.textContent = `Você recebe 100% em mãos. A taxa de ${taxaPct}% é descontada da carteira.`;
  const lblTaxaMaq = document.getElementById('lblTaxaMaquininhaDesc');
  if (lblTaxaMaq) lblTaxaMaq.textContent = `Passou no seu cartão. A taxa de ${taxaPct}% é descontada da sua carteira.`;

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
  botoes.forEach(b => { b.style.opacity = '0.5'; b.disabled = true; });

  const caminho = `/api/pedidos/${encodeURIComponent(pedidoId)}/finalizar-liquidacao`;
  const presencial = formaPagamento === 'dinheiro' || formaPagamento === 'cartao_maquininha';

  try {
    let res;
    try {
      res = await fetch(`${API_URL}${caminho}`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ forma_pagamento: formaPagamento })
      });
    } catch (erroRede) {
      // Sem internet: pagamento presencial pode esperar na fila; Pix precisa de sinal
      if (presencial) {
        enfileirarRequisicaoOffline(caminho, 'POST', { forma_pagamento: formaPagamento }, 'Finalização da corrida');
        if (modal) modal.style.display = 'none';
        notificar('📡 Sem internet: a finalização será enviada assim que o sinal voltar. Não feche o app.', 'aviso', 7000);
        await concluirLimpezaPosCorrida();
      } else {
        notificar('Sem sinal para gerar o QR Code Pix agora. Tente novamente ou receba presencialmente.', 'erro');
      }
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.erro || `Falha ao finalizar a corrida (código ${res.status}).`);
    }

    if (modal) modal.style.display = 'none';

    if (formaPagamento === 'pix_mp') {
      exibirQrCodePixMotorista(data.pix, pedidoId);
    } else {
      notificar(`✅ Corrida encerrada! A taxa de ${taxaDoMotorista()}% foi registrada na sua carteira.`, 'sucesso');
      if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
      await concluirLimpezaPosCorrida();
    }
  } catch (err) {
    notificar(err.message || 'Não foi possível finalizar a corrida.', 'erro');
  } finally {
    botoes.forEach(b => { b.style.opacity = '1'; b.disabled = false; });
    processandoPagamento = false;
  }
}

export function exibirQrCodePixMotorista(pixBruto, pedidoIdInformado = null) {
  const modalPix = document.getElementById('modalExibicaoPixMotorista');
  const imgQr = document.getElementById('imgQrCodePixMotorista');
  const lblValor = document.getElementById('lblValorPixMotorista');
  const btnFechar = document.getElementById('btnFecharPixMotorista');

  const pix = pixBruto || {};
  const valor = Number(pix.valor || 0);
  const qrBase64 = String(pix.qr_code_base64 || '').replace(/[^A-Za-z0-9+/=]/g, '');

  if (!qrBase64) {
    notificar('O QR Code Pix não foi gerado. Tente novamente ou receba presencialmente.', 'erro');
    return;
  }

  if (lblValor) {
    lblValor.style.color = '';
    lblValor.textContent = `R$ ${valor.toFixed(2).replace('.', ',')}`;
  }
  if (imgQr) imgQr.src = `data:image/png;base64,${qrBase64}`;

  if (modalPix) modalPix.style.display = 'flex';

  const txid = pix.txid || pix.transacao_id || '';
  const pedidoId = String(pix.pedido_id || pedidoIdInformado || estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id || '');
  let jaConfirmado = false;

  const socketAtivo = estado.socket || estado.socketRadar;
  const eventosSocket = pedidoId ? [`corrida_finalizada_${pedidoId}`, `pix_confirmado_${pedidoId}`] : [];

  const limparMonitoramento = () => {
    if (intervalPollingPixMotorista) {
      clearInterval(intervalPollingPixMotorista);
      intervalPollingPixMotorista = null;
    }
    if (socketAtivo) eventosSocket.forEach((ev) => socketAtivo.off(ev, concluirAoConfirmarPix));
  };

  async function concluirAoConfirmarPix() {
    if (jaConfirmado) return;
    jaConfirmado = true;
    limparMonitoramento();

    const taxaPct = taxaDoMotorista();
    const repasse = Number((valor * ((100 - taxaPct) / 100)).toFixed(2));
    const repasseFmt = repasse.toFixed(2).replace('.', ',');

    if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();

    if (lblValor) {
      lblValor.style.color = '#10B981';
      lblValor.textContent = `✅ PIX CONFIRMADO! (+R$ ${repasseFmt})`;
    }

    notificar(`🎉 Pagamento Pix confirmado! +R$ ${repasseFmt} (${100 - taxaPct}%) creditados na sua carteira!`, 'sucesso', 5000);

    setTimeout(async () => {
      if (modalPix) modalPix.style.display = 'none';
      await concluirLimpezaPosCorrida();
    }, 1500);
  }

  limparMonitoramento();
  if (socketAtivo) eventosSocket.forEach((ev) => socketAtivo.once(ev, concluirAoConfirmarPix));

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

  // "Voltar" NÃO encerra a corrida: volta para a escolha da forma de pagamento
  if (btnFechar) {
    btnFechar.textContent = 'Voltar (escolher outra forma de pagamento)';
    btnFechar.onclick = () => {
      limparMonitoramento();
      if (modalPix) modalPix.style.display = 'none';
      const dadosCorrida = estado.pedidoAtivo || estado.pedidoAceitoAtual || { id: pedidoId };
      abrirModalOpcoesPagamento(dadosCorrida);
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
  fecharModaisPagamento();
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

  try {
    await carregarPerfil();
    await carregarGanhosHoje();
    await carregarExtratoFinanceiro();
  } catch (e) {}
  iniciarRadarChamadas();
  reajustarMapa();
}