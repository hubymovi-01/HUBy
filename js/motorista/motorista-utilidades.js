// js/motorista/motorista-utilidades.js

// ============================================================================
// 1. WAKE LOCK API (Tela sempre ligada)
// ============================================================================
let wakeLockSentinel = null;

export async function ativarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch (err) {
      console.warn('Wake Lock indisponível:', err.message);
    }
  }
}

export function liberarWakeLock() {
  if (wakeLockSentinel !== null) {
    wakeLockSentinel.release().then(() => {
      wakeLockSentinel = null;
    }).catch(() => {});
  }
}

document.addEventListener('visibilitychange', () => {
  const estaOnline = localStorage.getItem('huby_motorista_online') === 'true';
  if (wakeLockSentinel === null && document.visibilityState === 'visible' && estaOnline) {
    ativarWakeLock();
  }
});

// ============================================================================
// 2. WEB AUDIO API (Bipe Sonoro de Chamada)
// ============================================================================
let audioCtx = null;
let intervaloToque = null;

function obterAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function emitirBipeChamada() {
  const ctx = obterAudioContext();
  if (!ctx) return;
  const agora = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const ganho1 = ctx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.setValueAtTime(880, agora);
  ganho1.gain.setValueAtTime(0.3, agora);
  ganho1.gain.exponentialRampToValueAtTime(0.01, agora + 0.18);
  osc1.connect(ganho1);
  ganho1.connect(ctx.destination);
  osc1.start(agora);
  osc1.stop(agora + 0.18);

  const osc2 = ctx.createOscillator();
  const ganho2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(1174, agora + 0.20);
  ganho2.gain.setValueAtTime(0.35, agora + 0.20);
  ganho2.gain.exponentialRampToValueAtTime(0.01, agora + 0.45);
  osc2.connect(ganho2);
  ganho2.connect(ctx.destination);
  osc2.start(agora + 0.20);
  osc2.stop(agora + 0.45);
}

export function iniciarAlertaSonoroChamada() {
  pararAlertaSonoroChamada();
  emitirBipeChamada();
  intervaloToque = setInterval(() => emitirBipeChamada(), 1200);
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 600]);
}

export function pararAlertaSonoroChamada() {
  if (intervaloToque) {
    clearInterval(intervaloToque);
    intervaloToque = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}

// ============================================================================
// 3. DOCUMENT PICTURE-IN-PICTURE (Widget Flutuante sobre o GPS)
// ============================================================================
let pipWindow = null;

export async function abrirWidgetFlutuantePiP(titulo, valor, onAcaoClick) {
  if (!('documentPictureInPicture' in window)) {
    console.warn('Picture-in-Picture não suportado neste navegador.');
    return;
  }

  if (pipWindow) return;

  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({
      width: 280,
      height: 160
    });

    pipWindow.document.body.innerHTML = `
      <style>
        body {
          margin: 0;
          background: #0B0F19;
          color: #FFF;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 12px;
          box-sizing: border-box;
          user-select: none;
        }
        .header { display: flex; justify-content: space-between; align-items: center; }
        .badge { background: rgba(16, 185, 129, 0.2); color: #10B981; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 6px; }
        .preco { font-size: 15px; font-weight: 900; color: #FFF; }
        .titulo { font-size: 12px; color: #94A3B8; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .btn-acao {
          background: #10B981; color: #03251E; border: none; border-radius: 8px;
          padding: 10px; font-weight: 800; font-size: 12px; cursor: pointer; width: 100%;
        }
      </style>
      <div>
        <div class="header">
          <span class="badge">HUBy ROTA</span>
          <span class="preco">${valor}</span>
        </div>
        <div class="titulo">${titulo}</div>
      </div>
      <button class="btn-acao" id="btnPipAcao">Voltar ao App</button>
    `;

    pipWindow.document.getElementById('btnPipAcao')?.addEventListener('click', () => {
      window.focus();
      if (onAcaoClick) onAcaoClick();
    });

    pipWindow.addEventListener('pagehide', () => {
      pipWindow = null;
    });
  } catch (e) {
    console.warn('Erro ao abrir Picture-in-Picture:', e);
  }
}

export function fecharWidgetFlutuantePiP() {
  if (pipWindow) {
    pipWindow.close();
    pipWindow = null;
  }
}

// ============================================================================
// 4. MONITOR OFFLINE & RECONEXÃO RESILIENTE
// ============================================================================
export function inicializarMonitorConexao() {
  const criarBannerOffline = () => {
    let banner = document.getElementById('hubyBannerOffline');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hubyBannerOffline';
      banner.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0;
        background: #EF4444;
        color: #FFF;
        font-size: 12px;
        font-weight: 800;
        text-align: center;
        padding: 8px 12px;
        z-index: 999999;
        display: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      `;
      banner.textContent = '⚠️ Sem sinal de internet. Tentando reconectar...';
      document.body.appendChild(banner);
    }
    return banner;
  };

  const banner = criarBannerOffline();

  window.addEventListener('offline', () => {
    banner.style.display = 'block';
  });

  window.addEventListener('online', () => {
    banner.style.background = '#10B981';
    banner.textContent = '✓ Conexão restabelecida!';
    setTimeout(() => {
      banner.style.display = 'none';
      banner.style.background = '#EF4444';
      banner.textContent = '⚠️ Sem sinal de internet. Tentando reconectar...';
    }, 2500);
  });
}