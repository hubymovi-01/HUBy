// js/motorista/motorista-utilidades.js

// ============================================================================
// 1. WAKE LOCK API (Manter Tela Ligada enquanto Online / Em Corrida)
// ============================================================================
let wakeLockSentinel = null;

export async function ativarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
      console.log('💡 Wake Lock ativo: tela permanecerá ligada.');
    } catch (err) {
      console.warn('Wake Lock não pôde ser ativado:', err.message);
    }
  }
}

export function liberarWakeLock() {
  if (wakeLockSentinel !== null) {
    wakeLockSentinel.release().then(() => {
      wakeLockSentinel = null;
      console.log('💡 Wake Lock liberado: tela volta ao comportamento normal.');
    }).catch(() => {});
  }
}

// Reativa o Wake Lock caso o motorista minimize e volte ao app
document.addEventListener('visibilitychange', () => {
  const estaOnline = localStorage.getItem('huby_motorista_online') === 'true';
  if (wakeLockSentinel === null && document.visibilityState === 'visible' && estaOnline) {
    ativarWakeLock();
  }
});

// ============================================================================
// 2. WEB AUDIO API (Toque de Chamada Sintetizado sem MP3 externo)
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

// Emite um par de bipes eletrônicos de alta atenção estilo Uber/99
function emitirBipeChamada() {
  const ctx = obterAudioContext();
  if (!ctx) return;

  const agora = ctx.currentTime;

  // Primeiro tom (880 Hz - Nota Lá5)
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

  // Segundo tom mais agudo (1174 Hz - Ré6)
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

  // Toca o primeiro bipe imediatamente
  emitirBipeChamada();

  // Repete o bipe sonoro a cada 1.2 segundos em loop enquanto a chamada estiver tocando
  intervaloToque = setInterval(() => {
    emitirBipeChamada();
  }, 1200);

  // Vibração contínua de chamada no smartphone
  if (navigator.vibrate) {
    navigator.vibrate([400, 200, 400, 200, 600]);
  }
}

export function pararAlertaSonoroChamada() {
  if (intervaloToque) {
    clearInterval(intervaloToque);
    intervaloToque = null;
  }
  if (navigator.vibrate) {
    navigator.vibrate(0);
  }
}