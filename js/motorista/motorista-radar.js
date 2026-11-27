// js/motorista/motorista-radar.js - Radar Sincronizado + Cancelamento Instantâneo + Aba de Agendamentos
// Segurança: todo texto vindo do passageiro (endereços, observação, cupom) é exibido como texto puro.
import { API_URL, sonsHUBy, calcularPreco, aplicarObjetoTarifas, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let intervalAlertaChamada = null;
let wakeLockSentinela = null;
let gpsFallbackEmAndamento = false;
let alternandoOnline = false;
let abaRadarAtual = 'agora'; // 'agora' | 'agendados'
let ultimosPedidosAgora = [];
let ultimosPedidosAgendados = [];

// Dados completos de cada chamada na tela (o botão guarda só o id)
const pedidosNaTela = new Map();

const VALIDADE_SELFIE_MS = 12 * 60 * 60 * 1000;
const TEMPO_EXPIRACAO_TELA_MS = 30 * 1000;
const STATUS_AINDA_DISPONIVEL = ['pendente', 'aguardando', 'buscando', 'criado', 'agendado'];

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

// ============================================================================
// AJUDANTES DE SEGURANÇA E DE VALORES
// ============================================================================
function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numeroOuNulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function coordsValidas(lat, lng) {
  const a = numeroOuNulo(lat);
  const b = numeroOuNulo(lng);
  if (a === null || b === null || (a === 0 && b === 0)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return [a, b];
}

// Taxa do NÍVEL do motorista (Bronze/Prata/Ouro); cai na taxa geral só se ainda não carregou
export function taxaDoMotorista() {
  const taxaNivel = numeroOuNulo(estado.taxaHubyMotorista);
  if (taxaNivel !== null) return taxaNivel;
  return Number(TAXA_PLATAFORMA_ATUAL ?? 15);
}

function fatorRepasseMotorista() {
  return Math.max(0.1, (100 - taxaDoMotorista()) / 100);
}

function limparPreVisualizacaoPresaNoMapa() {
  estado.pedidoEmAnalise = null;
  document.getElementById('bannerNavegacao3D')?.remove();
  document.getElementById('painelPreVisualizacaoCorrida')?.remove();
  try {
    estado.hubyMapa?.limparRota?.();
    estado.hubyMapa?.limparDestino?.();
  } catch (e) {}
}

function extrairMetadadosSincronizados(p) {
  let obs = String(p.observacao || '').trim();
  let cupom = String(p.cupom_codigo || p.cupomCodigo || '').trim();
  let descontoPct = 0;
  let agendadoPara = p.agendado_para || p.agendadoPara || null;

  if (Array.isArray(p.paradas)) {
    for (const item of p.paradas) {
      if (item?.nota && !obs) obs = String(item.nota).trim();
      if (item?.cupom && !cupom) cupom = String(item.cupom).trim();
      if (item?.desconto_pct) descontoPct = Number(item.desconto_pct) || 0;
      if (item?.agendado_para && !agendadoPara) agendadoPara = item.agendado_para;
    }
  }

  return {
    obs: obs.slice(0, 300),
    cupom: cupom.slice(0, 40),
    descontoPct,
    agendadoPara
  };
}

// Junta num objeto só tudo o que a tela da corrida precisa (sem passar pelo HTML)
function montarDadosPedido(p) {
  const categoria = String(p.sub_tipo_id || p.tipo || 'carro').toLowerCase();
  const distKm = Number.parseFloat(p.distancia_km ?? p.distanciaKm) || 0;
  const durMin = Math.max(1, Math.round(Number(p.duracao_min) || distKm * 2.2 || 5));

  let valorBruto = Number(p.valor_total || 0);
  if (!(valorBruto > 0) && distKm > 0) {
    valorBruto = calcularPreco(categoria, distKm).valorTotal;
  }

  const repasseNum = Number((valorBruto * fatorRepasseMotorista()).toFixed(2));

  const coordsOrig = Array.isArray(p.coordsOrigem)
    ? coordsValidas(p.coordsOrigem[0], p.coordsOrigem[1])
    : coordsValidas(p.origem_lat, p.origem_lng);
  const coordsDest = Array.isArray(p.coordsDestino)
    ? coordsValidas(p.coordsDestino[0], p.coordsDestino[1])
    : coordsValidas(p.destino_lat, p.destino_lng);

  const meta = extrairMetadadosSincronizados(p);

  return {
    id: String(p.id),
    categoria,
    preco: valorBruto,
    valorTotal: valorBruto,
    repasse: repasseNum.toFixed(2).replace('.', ','),
    origem: String(p.origem_endereco || 'Local do passageiro').slice(0, 200),
    destino: String(p.destino_endereco || 'Destino informado').slice(0, 200),
    dist: distKm > 0 ? distKm.toFixed(1) : '--',
    dur: durMin,
    coordsOrig,
    coordsDest,
    agendadoPara: meta.agendadoPara || null
  };
}

// Compatibilidade: devolve os dados da chamada a partir do botão (que só guarda o id)
export function extrairDadosDoBotao(btn) {
  const id = btn?.getAttribute?.('data-id');
  const p = id ? pedidosNaTela.get(String(id)) : null;
  return p ? montarDadosPedido(p) : null;
}

// ============================================================================
// BOTÃO ONLINE / OFFLINE
// ============================================================================
function aplicarEstadoVisualOnline(online) {
  const ativo = Boolean(online);
  estado.isOnline = ativo;
  estado.statusOnline = ativo;

  const btn = document.getElementById('btnToggleStatusOnline');
  if (btn) {
    if (ativo) {
      btn.style.background = 'rgba(16, 185, 129, 0.2)';
      btn.style.borderColor = 'var(--emerald)';
      btn.style.color = 'var(--emerald)';
      btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
    } else {
      btn.style.background = '#1F2937';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.style.color = '#94A3B8';
      btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
    }
  }
}

function obterCoordenadasAtuaisMotorista() {
  const fonte = estado.ultimaPosicao || estado.posicaoAtual || estado.coordsAtual || null;
  if (fonte && Number.isFinite(Number(fonte.lat)) && Number.isFinite(Number(fonte.lng))) {
    return { lat: Number(fonte.lat), lng: Number(fonte.lng) };
  }
  if (Array.isArray(fonte) && fonte.length === 2) {
    const latNum = Number(fonte[0]);
    const lngNum = Number(fonte[1]);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return { lat: latNum, lng: lngNum };
    }
  }
  if (Number.isFinite(Number(estado.lat)) && Number.isFinite(Number(estado.lng))) {
    return { lat: Number(estado.lat), lng: Number(estado.lng) };
  }
  return { lat: '', lng: '' };
}

function capturarGPSFallbackSilencioso() {
  if (gpsFallbackEmAndamento || !navigator.geolocation) return;
  const atual = obterCoordenadasAtuaisMotorista();
  if (atual.lat !== '' && atual.lng !== '') return;

  gpsFallbackEmAndamento = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      gpsFallbackEmAndamento = false;
      const lat = Number(pos?.coords?.latitude);
      const lng = Number(pos?.coords?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        estado.ultimaPosicao = { lat, lng };
        estado.posicaoAtual = { lat, lng };
      }
    },
    () => {
      gpsFallbackEmAndamento = false;
    },
    { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 }
  );
}

async function requisitarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinela = await navigator.wakeLock.request('screen');
      wakeLockSentinela.addEventListener('release', () => {
        wakeLockSentinela = null;
      });
    } catch (err) {}
  }
}

function libertarWakeLock() {
  if (wakeLockSentinela) {
    try {
      wakeLockSentinela.release();
    } catch (e) {}
    wakeLockSentinela = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && estado.isOnline) {
    await requisitarWakeLock();
  }
});

function selfieTurnoValida() {
  const ultimoTs = Number(localStorage.getItem('huby_ultima_selfie_ts') || 0);
  if (!ultimoTs) return false;
  return (Date.now() - ultimoTs) < VALIDADE_SELFIE_MS;
}

function comprimirImagemArquivoParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler a foto selecionada.'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Imagem inválida.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const largura = 360;
        const altura = Math.round((img.height / img.width) * largura) || 480;
        canvas.width = largura;
        canvas.height = altura;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, largura, altura);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function solicitarSelfieVerificacaoOnline() {
  return new Promise((resolve) => {
    document.getElementById('modalSelfieVerificacaoHUBy')?.remove();
    const dentroDoAppNativo = Boolean(window.ReactNativeWebView);

    const overlay = document.createElement('div');
    overlay.id = 'modalSelfieVerificacaoHUBy';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100080;background:rgba(6,10,18,0.94);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:16px;';

    overlay.innerHTML = `
      <div style="background: #0E1422; border: 1.5px solid rgba(16, 185, 129, 0.4); border-radius: 22px; width: 100%; max-width: 370px; padding: 20px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.85); color: #FFF;">
        <div style="display: inline-block; background: rgba(16,185,129,0.15); color: #10B981; font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 999px; margin-bottom: 8px; text-transform: uppercase;">
          🛡️ Segurança do Turno
        </div>
        <h3 style="margin: 0 0 4px; font-size: 17px; font-weight: 900;">Selfie de Verificação</h3>
        <p style="margin: 0 0 14px; font-size: 12px; color: #94A3B8; line-height: 1.4;">
          Enquadre o seu rosto no centro para confirmar sua identidade antes de ficar online.
        </p>

        <div style="position: relative; width: 220px; height: 260px; margin: 0 auto 14px; border-radius: 50%; overflow: hidden; border: 3px solid #10B981; background: #05080F; display: flex; align-items: center; justify-content: center;">
          <video id="videoSelfieMotorista" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);"></video>
          <img id="previewSelfieCapturada" alt="Prévia Selfie" style="display: none; width: 100%; height: 100%; object-fit: cover;">
          <div id="placeholderCameraNativa" style="display: none; flex-direction: column; align-items: center; justify-content: center; padding: 16px; color: #94A3B8;">
            <span style="font-size: 44px; margin-bottom: 6px;">🤳</span>
            <small style="font-size: 11px; font-weight: 700; color: #CBD5E1;">Toque no botão verde abaixo para abrir a câmera</small>
          </div>
        </div>

        <input type="file" id="inputSelfieNativaMobile" accept="image/*" capture="user" style="display: none;">
        <div id="statusSelfieTexto" style="font-size: 11.5px; color: #38BDF8; font-weight: 700; margin-bottom: 12px;">Iniciando câmera frontal...</div>

        <div style="display: flex; gap: 8px;">
          <button type="button" id="btnCancelarSelfieOnline" style="flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.14); color: #CBD5E1; font-weight: 800; padding: 12px; border-radius: 12px; font-size: 13px; cursor: pointer;">Cancelar</button>
          <button type="button" id="btnCapturarSelfieOnline" disabled style="flex: 1.6; background: #10B981; border: none; color: #02261C; font-weight: 900; padding: 12px; border-radius: 12px; font-size: 13px; cursor: pointer; opacity: 0.6;">📸 Tirar Selfie</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const video = overlay.querySelector('#videoSelfieMotorista');
    const previewImg = overlay.querySelector('#previewSelfieCapturada');
    const placeholderNativo = overlay.querySelector('#placeholderCameraNativa');
    const inputNativo = overlay.querySelector('#inputSelfieNativaMobile');
    const statusTxt = overlay.querySelector('#statusSelfieTexto');
    const btnCapturar = overlay.querySelector('#btnCapturarSelfieOnline');
    const btnCancelar = overlay.querySelector('#btnCancelarSelfieOnline');

    let streamAtivo = null;
    let modoCameraNativa = false;
    let timerFallback = null;

    const encerrarCameraEModal = (sucesso) => {
      window.__receberSelfieNativaHUBy = null;
      if (timerFallback) clearTimeout(timerFallback);
      if (streamAtivo) {
        try { streamAtivo.getTracks().forEach((t) => t.stop()); } catch (e) {}
      }
      overlay.remove();
      resolve(sucesso);
    };

    const ativarModoCameraNativa = () => {
      if (modoCameraNativa) return;
      modoCameraNativa = true;
      if (video) video.style.display = 'none';
      if (placeholderNativo) placeholderNativo.style.display = 'flex';
      if (statusTxt) {
        statusTxt.textContent = 'Pronto para tirar a selfie pela câmera do celular';
        statusTxt.style.color = '#10B981';
      }
      btnCapturar.disabled = false;
      btnCapturar.style.opacity = '1';
      btnCapturar.textContent = '📸 Abrir Câmera';
    };

    const enviarSelfieParaServidor = async (selfieBase64) => {
      // Só aceita imagem JPEG/PNG em base64
      if (!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(String(selfieBase64 || ''))) {
        notificar('Imagem inválida. Tente tirar a selfie novamente.', 'erro');
        return;
      }

      btnCapturar.disabled = true;
      btnCapturar.textContent = 'Validando...';
      if (previewImg) {
        previewImg.src = selfieBase64;
        previewImg.style.display = 'block';
        if (video) video.style.display = 'none';
        if (placeholderNativo) placeholderNativo.style.display = 'none';
      }

      try {
        const token = localStorage.getItem('huby_token') || '';
        const resp = await fetch(`${API_URL}/api/motoristas/verificar-selfie`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ selfie_base64: selfieBase64 })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.erro || 'Falha ao validar selfie.');

        localStorage.setItem('huby_ultima_selfie_ts', String(Date.now()));
        if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
        notificar('Identidade verificada com sucesso!', 'sucesso');
        encerrarCameraEModal(true);
      } catch (err) {
        notificar(err.message || 'Erro ao enviar selfie.', 'erro');
        if (previewImg) previewImg.style.display = 'none';
        if (modoCameraNativa && placeholderNativo) placeholderNativo.style.display = 'flex';
        btnCapturar.disabled = false;
        btnCapturar.style.opacity = '1';
        btnCapturar.textContent = '📸 Tentar Novamente';
      }
    };

    window.__receberSelfieNativaHUBy = async (dataUrl) => {
      if (dataUrl) await enviarSelfieParaServidor(dataUrl);
    };

    btnCancelar.onclick = () => encerrarCameraEModal(false);

    inputNativo.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const base64 = await comprimirImagemArquivoParaBase64(file);
        await enviarSelfieParaServidor(base64);
      } catch (err) {
        notificar(err.message, 'erro');
      } finally {
        inputNativo.value = '';
      }
    });

    if (dentroDoAppNativo) {
      ativarModoCameraNativa();
    } else {
      timerFallback = setTimeout(() => {
        if (!video || !video.videoWidth) ativarModoCameraNativa();
      }, 2500);

      (async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          ativarModoCameraNativa();
          return;
        }
        try {
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
          } catch (e) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          streamAtivo = stream;
          video.srcObject = stream;
          const confirmarVideoPronto = () => {
            if (modoCameraNativa) return;
            if (timerFallback) clearTimeout(timerFallback);
            video.play().catch(() => {});
            if (statusTxt) {
              statusTxt.textContent = 'Posicione o rosto dentro da moldura';
              statusTxt.style.color = '#10B981';
            }
            btnCapturar.disabled = false;
            btnCapturar.style.opacity = '1';
            btnCapturar.textContent = '📸 Tirar Selfie';
          };
          video.onloadedmetadata = confirmarVideoPronto;
          video.onplaying = confirmarVideoPronto;
        } catch (err) {
          ativarModoCameraNativa();
        }
      })();
    }

    btnCapturar.onclick = async () => {
      if (dentroDoAppNativo && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ tipo: 'ABRIR_CAMERA_SELFIE' }));
        return;
      }
      if (modoCameraNativa || !video || !video.videoWidth) {
        inputNativo.click();
        return;
      }
      const canvas = document.createElement('canvas');
      const largura = 360;
      const altura = Math.round((video.videoHeight / video.videoWidth) * largura) || 480;
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d');
      ctx.translate(largura, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, largura, altura);
      await enviarSelfieParaServidor(canvas.toDataURL('image/jpeg', 0.72));
    };
  });
}

export function iniciarAlertaSonoroChamada() {
  if (intervalAlertaChamada) return;
  sonsHUBy.tocarAlertaChamada();
  intervalAlertaChamada = setInterval(() => {
    sonsHUBy.tocarAlertaChamada();
  }, 1400);
}

export function pararAlertaSonoroChamada() {
  if (intervalAlertaChamada) {
    clearInterval(intervalAlertaChamada);
    intervalAlertaChamada = null;
  }
}

// Liga/desliga o online: PRIMEIRO o servidor confirma, DEPOIS a tela muda
export async function alternarStatusOnline(forcarEstado = null) {
  if (alternandoOnline) return estado.isOnline;

  const novoStatus = typeof forcarEstado === 'boolean' ? forcarEstado : !estado.isOnline;

  if (!novoStatus && estado.pedidoAceitoAtual) {
    notificar('Finalize ou cancele a corrida atual antes de ficar offline.', 'alerta');
    return estado.isOnline;
  }

  if (novoStatus && !selfieTurnoValida()) {
    const selfieAprovada = await solicitarSelfieVerificacaoOnline();
    if (!selfieAprovada) {
      aplicarEstadoVisualOnline(false);
      renderizarRadarOffline();
      return false;
    }
  }

  const btn = document.getElementById('btnToggleStatusOnline');
  alternandoOnline = true;
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }

  try {
    const token = localStorage.getItem('huby_token');
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/meu-status-online`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ online: novoStatus })
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      notificar(data.erro || 'Não foi possível alterar seu status agora.', 'erro', 5000);
      return estado.isOnline;
    }

    const confirmado = typeof data.online === 'boolean' ? data.online : novoStatus;
    aplicarEstadoVisualOnline(confirmado);

    if (confirmado) {
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      await requisitarWakeLock();
      capturarGPSFallbackSilencioso();
      renderizarRadar([]);
      iniciarRadarChamadas();
      notificar('🟢 Você está online! Aguardando corridas na região.', 'sucesso');
    } else {
      libertarWakeLock();
      pararRadarChamadas();
      if (!estado.pedidoAceitoAtual) {
        limparPreVisualizacaoPresaNoMapa();
      }
      renderizarRadarOffline();
      notificar('⚪ Você ficou offline para corridas.', 'info');
    }
    return confirmado;
  } catch (err) {
    notificar('Sem conexão. Seu status NÃO foi alterado.', 'erro', 5000);
    return estado.isOnline;
  } finally {
    alternandoOnline = false;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

function lerAgendaLocal() {
  try {
    const lista = JSON.parse(localStorage.getItem('huby_motorista_agenda') || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch (e) {
    return [];
  }
}

function verificarAlertasAgendamentosAceitos() {
  const agenda = lerAgendaLocal();
  if (!agenda.length) return;
  const agora = Date.now();
  let alterou = false;

  for (const item of agenda) {
    const ts = new Date(item.agendado_para).getTime();
    if (!Number.isFinite(ts)) continue;
    const diffMin = (ts - agora) / 60000;
    if (!item.notificado && diffMin <= 15 && diffMin >= -30) {
      item.notificado = true;
      alterou = true;
      if (sonsHUBy?.tocarAlertaChamada) sonsHUBy.tocarAlertaChamada();
      notificar(`⏰ AGENDAMENTO DISPONÍVEL AGORA: ${item.origem} → ${item.destino}`, 'alerta', 9000);
    }
  }

  // Limpa agendamentos que já passaram há mais de 2 horas
  const limpa = agenda.filter((item) => {
    const ts = new Date(item.agendado_para).getTime();
    return Number.isFinite(ts) && ts > agora - 2 * 60 * 60 * 1000;
  });

  if (alterou || limpa.length !== agenda.length) {
    localStorage.setItem('huby_motorista_agenda', JSON.stringify(limpa));
  }
}

// ============================================================================
// REMOVER CHAMADA INSTANTANEAMENTE QUANDO PASSAGEIRO CANCELA
// ============================================================================
function removerChamadaCanceladaInstantaneamente(pedidoId, avisar = true) {
  if (!pedidoId) return;
  const idStr = String(pedidoId);

  if (!estado.pedidosIgnorados) estado.pedidosIgnorados = new Set();
  estado.pedidosIgnorados.add(idStr);
  pedidosNaTela.delete(idStr);

  if (estado.temposPedidosTela) {
    delete estado.temposPedidosTela[idStr];
  }

  const antesAgora = ultimosPedidosAgora.length;
  const antesAgendados = ultimosPedidosAgendados.length;

  ultimosPedidosAgora = ultimosPedidosAgora.filter(p => String(p.id) !== idStr);
  ultimosPedidosAgendados = ultimosPedidosAgendados.filter(p => String(p.id) !== idStr);

  // Se o motorista estava com a pré-visualização aberta desta corrida, limpa o mapa na hora
  if (estado.pedidoEmAnalise && String(estado.pedidoEmAnalise.id) === idStr) {
    limparPreVisualizacaoPresaNoMapa();
    if (avisar) notificar('Esta chamada não está mais disponível.', 'alerta');
  } else if (avisar && (antesAgora !== ultimosPedidosAgora.length || antesAgendados !== ultimosPedidosAgendados.length)) {
    notificar('Uma chamada saiu do radar (cancelada ou já atendida).', 'info');
  }

  if (ultimosPedidosAgora.length === 0) {
    pararAlertaSonoroChamada();
  }

  estado.ultimoRenderIds = null;
  if (estado.isOnline && !estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
    renderizarRadar();
  }
}

export function iniciarRadarChamadas() {
  solicitarPermissaoNotificacoes();

  // Botão sempre igual ao status real (ex.: ao reabrir o app, o servidor diz se está online)
  aplicarEstadoVisualOnline(estado.isOnline);

  if (!estado.isOnline) {
    renderizarRadarOffline();
    pararRadarChamadas();
    return;
  }

  capturarGPSFallbackSilencioso();
  renderizarRadar([]);
  buscarChamadasPendentes();

  if (!estado.socketRadar) {
    const ioClient = getSocketIO();
    if (ioClient) {
      const token = localStorage.getItem('huby_token');
      // Usa a conexão principal (a do mapa) quando ela já existe: uma conexão só por motorista
      estado.socketRadar = estado.socket || ioClient(API_URL, {
        auth: { token: token || '' }
      });

      estado.socketRadar.on('nova_chamada', () => {
        if (!estado.isOnline) return;
        if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise && estado.statusAprovacaoAtual === 'aprovado') {
          buscarChamadasPendentes(true);
        }
      });

      // Passageiro cancelou: some do radar na hora
      estado.socketRadar.on('corrida_cancelada', (dados) => {
        const idCancelado = dados?.pedidoId || dados?.id;
        if (idCancelado) {
          removerChamadaCanceladaInstantaneamente(idCancelado);
        }
      });

      // Outro motorista aceitou antes: some do radar na hora
      estado.socketRadar.on('corrida_aceita', (dados) => {
        const idAceito = dados?.pedidoId || dados?.id;
        if (idAceito && (!estado.pedidoAceitoAtual || String(estado.pedidoAceitoAtual.id) !== String(idAceito))) {
          removerChamadaCanceladaInstantaneamente(idAceito, false);
        }
      });

      estado.socketRadar.on('tarifas_atualizadas', (novasTarifas) => {
        aplicarObjetoTarifas(novasTarifas);
        if (estado.isOnline && !estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
          estado.ultimoRenderIds = null;
          buscarChamadasPendentes(false);
        }
      });

      estado.socketRadar.on('alerta_broadcast_geral', (dados) => {
        if (dados?.publico === 'todos' || dados?.publico === 'motoristas') {
          notificar(`📢 COMUNICADO: ${dados.titulo || ''} - ${dados.mensagem || ''}`, 'alerta', 6000);
        }
      });
    }
  }

  pararRadarChamadas();
  estado.intervalRadar = setInterval(() => {
    if (!estado.isOnline) {
      pararRadarChamadas();
      return;
    }
    verificarAlertasAgendamentosAceitos();
    if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
      buscarChamadasPendentes(false);
    }
  }, 3000);
}

export function pararRadarChamadas() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  pararAlertaSonoroChamada();
}

function renderizarRadarOffline() {
  const feedEl = document.getElementById('listaChamadasPendentes');
  if (feedEl) {
    feedEl.style.display = 'block';
    estado.ultimoRenderIds = null;
    feedEl.innerHTML = `
      <div class="dock-empty" style="background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(10px); border-radius: 12px; padding: 14px; text-align: center; border: 1px solid rgba(255, 255, 255, 0.1);">
        <span style="color: #94A3B8; font-weight: 800; font-size: 13px;">⚪ Fique online para receber chamadas</span>
      </div>
    `;
  }
}

export async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (!estado.isOnline) {
    pararAlertaSonoroChamada();
    renderizarRadarOffline();
    return;
  }

  if (estado.pedidoAceitoAtual || estado.pedidoEmAnalise) {
    pararAlertaSonoroChamada();
    return;
  }

  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const cat = estado.categoriaMotorista || 'carro';
    const aceitaEntrega = Boolean(estado.aceitaEntrega);
    const { lat, lng } = obterCoordenadasAtuaisMotorista();

    const resp = await fetch(
      `${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(cat)}&aceitaEntrega=${aceitaEntrega}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&t=${Date.now()}`,
      {
        cache: 'no-store',
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!resp.ok) {
      ultimosPedidosAgora = [];
      ultimosPedidosAgendados = [];
      pedidosNaTela.clear();
      pararAlertaSonoroChamada();
      renderizarRadar([]);
      return;
    }

    const pedidos = await resp.json();
    const agora = Date.now();
    if (!estado.temposPedidosTela) estado.temposPedidosTela = {};

    const agoraList = [];
    const agendadosList = [];

    if (Array.isArray(pedidos)) {
      for (const p of pedidos) {
        if (!p || p.id === undefined || p.id === null) continue;
        const idStr = String(p.id);
        if (estado.pedidosIgnorados?.has(idStr)) continue;

        const meta = extrairMetadadosSincronizados(p);
        if (meta.agendadoPara) {
          agendadosList.push(p);
          continue;
        }

        if (typeof window.pedidoCompativelComRotaCasa === 'function') {
          if (!window.pedidoCompativelComRotaCasa(p)) continue;
        }

        if (!estado.temposPedidosTela[idStr]) {
          estado.temposPedidosTela[idStr] = agora;
        }

        const tempoQuePassou = agora - estado.temposPedidosTela[idStr];
        if (tempoQuePassou >= TEMPO_EXPIRACAO_TELA_MS) {
          if (!estado.pedidosIgnorados) estado.pedidosIgnorados = new Set();
          estado.pedidosIgnorados.add(idStr);
          continue;
        }

        agoraList.push(p);
      }
    }

    ultimosPedidosAgora = agoraList;
    ultimosPedidosAgendados = agendadosList;

    pedidosNaTela.clear();
    [...agoraList, ...agendadosList].forEach((p) => pedidosNaTela.set(String(p.id), p));

    const idsCombinados = `${abaRadarAtual}|${agoraList.map(p => p.id).join(',')}|${agendadosList.map(p => p.id).join(',')}`;

    if (agoraList.length === 0) {
      pararAlertaSonoroChamada();
    } else if (estado.ultimoRenderIds !== idsCombinados || tocarSomForcado) {
      iniciarAlertaSonoroChamada();
      dispararNotificacaoNovaChamada(agoraList.length);
    }

    if (estado.ultimoRenderIds !== idsCombinados || tocarSomForcado) {
      estado.ultimoRenderIds = idsCombinados;
      renderizarRadar();
    }
  } catch (err) {
    // Sem rede: mantém o que já está na tela em vez de apagar tudo
  }
}

function renderizarCardPedidoMotorista(p, ehAgendado = false) {
  const agora = Date.now();
  const meta = extrairMetadadosSincronizados(p);
  const dados = montarDadosPedido(p);

  const idAttr = escaparHTML(dados.id);
  const idCurto = escaparHTML(dados.id.slice(-4));
  const valorDisplay = `R$ ${escaparHTML(dados.repasse)}`;
  const rotuloCategoria = escaparHTML(String(p.sub_tipo_label || 'HUBy').slice(0, 40));
  const origem = escaparHTML(dados.origem);
  const destino = escaparHTML(dados.destino);
  const distTxt = escaparHTML(dados.dist);
  const durTxt = escaparHTML(dados.dur);

  const dataAgObj = meta.agendadoPara ? new Date(meta.agendadoPara) : null;
  const dataAgValida = dataAgObj && Number.isFinite(dataAgObj.getTime()) ? dataAgObj : null;
  const agendadoDisponivelAgora = dataAgValida ? (dataAgValida.getTime() - agora <= 15 * 60 * 1000) : false;

  const agendamentoHTML = dataAgValida
    ? `<div style="background: rgba(245, 158, 11, 0.16); border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 8px; padding: 6px 8px; margin-bottom: 6px; font-size: 11.5px; color: #FBBF24; font-weight: 800;">
        ⏰ Agendado: ${escaparHTML(dataAgValida.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}
        ${agendadoDisponivelAgora ? '<span style="background:#10B981;color:#02261C;padding:2px 6px;border-radius:6px;margin-left:6px;font-size:10px;">DISPONÍVEL AGORA</span>' : ''}
      </div>`
    : '';

  const descontoTxt = meta.descontoPct > 0 ? ` (-${escaparHTML(Math.round(meta.descontoPct))}%)` : '';
  const cupomHTML = meta.cupom
    ? `<div style="background: rgba(16, 185, 129, 0.14); border-left: 2.5px solid #10B981; padding: 5px 8px; margin-bottom: 6px; font-size: 11px; color: #34D399; font-weight: 800;">
        🏷️ Cupom aplicado: ${escaparHTML(meta.cupom)}${descontoTxt}
      </div>`
    : '';

  const obsHTML = meta.obs
    ? `<div style="background: rgba(56, 189, 248, 0.14); border-left: 2.5px solid #38BDF8; padding: 6px 8px; margin-bottom: 6px; font-size: 11.5px; color: #BAE6FD; font-weight: 700; word-break: break-word;">
        📝 Obs do passageiro: ${escaparHTML(meta.obs)}
      </div>`
    : '';

  const inicio = estado.temposPedidosTela?.[dados.id] || agora;
  const tempoRestanteSeg = Math.max(0, (TEMPO_EXPIRACAO_TELA_MS - (agora - inicio)) / 1000).toFixed(1);

  const botaoAcaoHTML = ehAgendado
    ? `<button type="button" class="btn-accept-scheduled" data-id="${idAttr}"
        style="width: 100%; background: ${agendadoDisponivelAgora ? '#10B981' : '#F59E0B'}; border: none; border-radius: 10px; padding: 13px; font-weight: 900; font-size: 14px; color: #090D16; cursor: pointer; text-transform: uppercase;">
        ${agendadoDisponivelAgora ? '🚀 Iniciar Corrida Agendada' : '📅 Aceitar Agendamento'}
      </button>`
    : `<button type="button" class="btn-accept-order" data-id="${idAttr}"
        style="position: relative; width: 100%; background: #10B981; border: none; border-radius: 10px; padding: 14px; font-weight: 900; font-size: 15px; color: #022C22; cursor: pointer; overflow: hidden; display: flex; justify-content: center; align-items: center; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 15px rgba(16,185,129,0.3);">
        <div class="huby-progress-bar" style="position: absolute; top: 0; left: 0; bottom: 0; width: 100%; background: #059669; z-index: 1; transform-origin: left; animation-duration: ${tempoRestanteSeg}s;"></div>
        <span style="position: relative; z-index: 2; text-shadow: 0 1px 2px rgba(255,255,255,0.3);">🚀 Aceitar Corrida</span>
      </button>`;

  return `
    <div class="order-card" data-pedido-card-id="${idAttr}" style="position: relative; background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(10px); border-radius: 12px; padding: 14px; margin-bottom: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.6); border: 1px solid ${ehAgendado ? 'rgba(245, 158, 11, 0.35)' : 'rgba(255,255,255,0.08)'};">
      <button type="button" class="btn-dispensar-pedido" data-id="${idAttr}" title="Recusar"
        style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.06); border: none; color: #94A3B8; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 800; cursor: pointer; z-index: 10;">
        ✕
      </button>

      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; padding-right: 35px;">
        <div>
          <span style="background: rgba(56, 189, 248, 0.15); color: #38BDF8; font-weight: 800; font-size: 11px; padding: 4px 8px; border-radius: 6px; display: inline-block; margin-bottom: 4px;">
            ${rotuloCategoria} #${idCurto}
          </span>
          <div style="font-size: 12px; color: #94A3B8; font-weight: 600;">
            📏 ${distTxt} km • ⏱️ ${durTxt} min
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 20px; font-weight: 900; color: #10B981; display: block; letter-spacing: -0.5px;">
            ${valorDisplay}
          </span>
          <small style="font-size: 10px; color: #64748B; text-transform: uppercase;">Ganhos (Líquido)</small>
        </div>
      </div>

      <div style="font-size: 13px; line-height: 1.4; color: #E2E8F0; padding-left: 10px; border-left: 2px solid rgba(255,255,255,0.1); margin-bottom: 8px; word-break: break-word;">
        <span style="display: block; margin-bottom: 5px;"><strong style="color: #10B981;">A</strong> ${origem}</span>
        <span style="display: block;"><strong style="color: #EF4444;">B</strong> ${destino}</span>
      </div>

      ${agendamentoHTML}
      ${cupomHTML}
      ${obsHTML}

      ${botaoAcaoHTML}
    </div>
  `;
}

// Confere no servidor se a chamada ainda está livre antes de abrir a prévia
async function chamadaAindaDisponivel(pedidoId) {
  try {
    const token = localStorage.getItem('huby_token') || '';
    const chk = await fetch(`${API_URL}/api/pedidos/${encodeURIComponent(pedidoId)}/status?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (chk.status === 404) return false;
    if (!chk.ok) return true; // na dúvida, deixa abrir: o aceite final é sempre conferido pelo servidor
    const st = await chk.json();
    const s = String(st.status || '').toLowerCase();
    if (!s) return true;
    return STATUS_AINDA_DISPONIVEL.includes(s) && !st.motorista_id;
  } catch (e) {
    return true;
  }
}

function renderizarRadar(listaForcada = null) {
  const feedEl = document.getElementById('listaChamadasPendentes');
  if (!feedEl) return;
  feedEl.style.display = 'block';

  if (!estado.isOnline) {
    renderizarRadarOffline();
    return;
  }

  // Durante uma corrida (ou prévia) o painel pertence à tela da corrida
  if (estado.pedidoAceitoAtual || estado.pedidoEmAnalise) return;

  if (Array.isArray(listaForcada) && listaForcada.length === 0 && ultimosPedidosAgora.length === 0 && ultimosPedidosAgendados.length === 0) {
    estado.ultimoRenderIds = null;
  }

  const qtdAgora = ultimosPedidosAgora.length;
  const qtdAgendados = ultimosPedidosAgendados.length;

  const navAbasHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
      <button type="button" id="tabRadarAgora"
        style="padding: 8px; border-radius: 10px; font-size: 12px; font-weight: 900; cursor: pointer; border: 1px solid ${abaRadarAtual === 'agora' ? '#10B981' : 'rgba(255,255,255,0.1)'}; background: ${abaRadarAtual === 'agora' ? 'rgba(16,185,129,0.2)' : 'rgba(15,23,42,0.85)'}; color: ${abaRadarAtual === 'agora' ? '#10B981' : '#94A3B8'};">
        📡 Agora (${qtdAgora})
      </button>
      <button type="button" id="tabRadarAgendados"
        style="padding: 8px; border-radius: 10px; font-size: 12px; font-weight: 900; cursor: pointer; border: 1px solid ${abaRadarAtual === 'agendados' ? '#F59E0B' : 'rgba(255,255,255,0.1)'}; background: ${abaRadarAtual === 'agendados' ? 'rgba(245,158,11,0.2)' : 'rgba(15,23,42,0.85)'}; color: ${abaRadarAtual === 'agendados' ? '#FBBF24' : '#94A3B8'};">
        📅 Agendados (${qtdAgendados})
      </button>
    </div>
  `;

  const listaExibir = abaRadarAtual === 'agendados' ? ultimosPedidosAgendados : ultimosPedidosAgora;

  let corpoHTML = '';
  if (listaExibir.length === 0) {
    const msgVazio = abaRadarAtual === 'agendados'
      ? '📅 Nenhuma solicitação agendada no momento'
      : '🟢 Aguardando novas chamadas...';
    corpoHTML = `
      <div class="dock-empty" style="background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(10px); border-radius: 12px; padding: 14px; text-align: center; border: 1px solid rgba(255, 255, 255, 0.1);">
        <span style="color: ${abaRadarAtual === 'agendados' ? '#FBBF24' : '#10B981'}; font-weight: 800; font-size: 13px;">${msgVazio}</span>
      </div>
    `;
  } else {
    corpoHTML = listaExibir.map((p) => renderizarCardPedidoMotorista(p, abaRadarAtual === 'agendados')).join('');
  }

  feedEl.innerHTML = navAbasHTML + corpoHTML;

  feedEl.querySelector('#tabRadarAgora')?.addEventListener('click', () => {
    abaRadarAtual = 'agora';
    estado.ultimoRenderIds = null;
    renderizarRadar();
  });

  feedEl.querySelector('#tabRadarAgendados')?.addEventListener('click', () => {
    abaRadarAtual = 'agendados';
    estado.ultimoRenderIds = null;
    renderizarRadar();
  });

  feedEl.querySelectorAll('.btn-dispensar-pedido').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!estado.pedidosIgnorados) estado.pedidosIgnorados = new Set();
      estado.pedidosIgnorados.add(String(id));
      pedidosNaTela.delete(String(id));
      buscarChamadasPendentes(false);
    });
  });

  feedEl.querySelectorAll('.btn-accept-order').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const dadosExtraidos = extrairDadosDoBotao(btn);
      if (!dadosExtraidos) {
        notificar('Esta chamada não está mais disponível.', 'alerta');
        buscarChamadasPendentes(false);
        return;
      }

      btn.disabled = true;
      pararAlertaSonoroChamada();

      const disponivel = await chamadaAindaDisponivel(dadosExtraidos.id);
      if (!disponivel) {
        removerChamadaCanceladaInstantaneamente(dadosExtraidos.id, false);
        notificar('Esta chamada já foi cancelada ou atendida.', 'alerta');
        return;
      }

      sonsHUBy.tocarSucessoAceite();
      preVisualizarRotaPedido(dadosExtraidos);
    });
  });

  feedEl.querySelectorAll('.btn-accept-scheduled').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const dadosExtraidos = extrairDadosDoBotao(btn);
      if (!dadosExtraidos) {
        notificar('Este agendamento não está mais disponível.', 'alerta');
        buscarChamadasPendentes(false);
        return;
      }

      const dataAg = dadosExtraidos.agendadoPara ? new Date(dadosExtraidos.agendadoPara) : null;
      const dataValida = dataAg && Number.isFinite(dataAg.getTime()) ? dataAg : null;
      const disponivelAgora = dataValida ? (dataValida.getTime() - Date.now() <= 15 * 60 * 1000) : true;

      if (disponivelAgora) {
        btn.disabled = true;
        const disponivel = await chamadaAindaDisponivel(dadosExtraidos.id);
        if (!disponivel) {
          removerChamadaCanceladaInstantaneamente(dadosExtraidos.id, false);
          notificar('Este agendamento já foi cancelado ou atendido.', 'alerta');
          return;
        }
        sonsHUBy.tocarSucessoAceite();
        preVisualizarRotaPedido(dadosExtraidos);
        return;
      }

      // Lembrete local: o motorista é avisado 15 min antes (a corrida só é dele quando aceitar de fato)
      const agenda = lerAgendaLocal();
      if (!agenda.some(a => String(a.id) === String(dadosExtraidos.id))) {
        agenda.push({
          id: dadosExtraidos.id,
          origem: dadosExtraidos.origem,
          destino: dadosExtraidos.destino,
          agendado_para: dadosExtraidos.agendadoPara,
          notificado: false
        });
        localStorage.setItem('huby_motorista_agenda', JSON.stringify(agenda.slice(-30)));
      }

      if (!estado.pedidosIgnorados) estado.pedidosIgnorados = new Set();
      estado.pedidosIgnorados.add(String(dadosExtraidos.id));

      sonsHUBy.tocarSucessoAceite();
      const horaFmt = dataValida ? dataValida.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      notificar(`📅 Lembrete salvo para ${horaFmt}! Avisaremos 15 min antes para você aceitar a corrida.`, 'sucesso', 5000);
      buscarChamadasPendentes(false);
    });
  });
}

export function solicitarPermissaoNotificacoes() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch?.(() => {});
  }
}

export function dispararNotificacaoNovaChamada(qtd) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!estado.isOnline) return;

  if (document.visibilityState === 'hidden') {
    const titulo = '🚘 HUBy: Nova corrida disponível!';
    const opcoes = {
      body: `${Number(qtd) || 1} chamada(s) aguardando atendimento. Toque para aceitar.`,
      icon: './assets/icons/icon-192.png',
      vibrate: [300, 150, 300],
      tag: 'nova-chamada-huby',
      renotify: true,
      data: { url: './motorista.html' }
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(titulo, opcoes)).catch(() => {});
      } else {
        new Notification(titulo, opcoes);
      }
    } catch (e) {}
  }
}