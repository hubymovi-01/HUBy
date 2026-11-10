// js/ia/voz-ui.js - Feedback Visual, Efeitos Sonoros e Gestão de Voz HUBy IA
class HUByVozUI {
  constructor() {
    this.audioCtx = null;
    this.btnIA = document.getElementById('btnBuscaIA');
    this.searchBox = document.querySelector('.modern-search');
    this.badgeRetentativa = null;
  }

  // Inicializa a API nativa de áudio do navegador (sem arquivos externos)
  obterContextoAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) this.audioCtx = new AudioContext();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  // Bip suave ao iniciar gravação (tom agudo amigável)
  tocarBipInicio() {
    try {
      const ctx = this.obterContextoAudio();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
      console.warn('Áudio não permitido ainda:', e.message);
    }
  }

  // Som suave de sucesso ao identificar e traçar rota (duplo tom ascendente)
  tocarSucesso() {
    try {
      const ctx = this.obterContextoAudio();
      if (!ctx) return;

      const agora = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(440, agora); // Lá
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, agora + 0.1); // Lá oitava acima

      gain.gain.setValueAtTime(0.09, agora);
      gain.gain.exponentialRampToValueAtTime(0.001, agora + 0.3);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(agora);
      osc1.stop(agora + 0.1);
      osc2.start(agora + 0.1);
      osc2.stop(agora + 0.3);
    } catch (e) {
      console.warn('Erro ao tocar som de sucesso:', e.message);
    }
  }

  // Ativa a animação de pulso no microfone
  ativarPulsoGravando() {
    if (!this.btnIA) return;
    this.btnIA.classList.add('huby-mic-gravando');
    this.removerBadgeRetentativa();
  }

  // Desativa a animação de pulso
  desativarPulso() {
    if (!this.btnIA) return;
    this.btnIA.classList.remove('huby-mic-gravando');
  }

  // Exibe a tag flutuante "Destino errado? Tentar de novo"
  exibirBadgeRetentativa(onTentarDeNovo) {
    this.removerBadgeRetentativa();

    if (!this.searchBox) return;

    this.badgeRetentativa = document.createElement('div');
    this.badgeRetentativa.className = 'huby-badge-retentativa';
    this.badgeRetentativa.innerHTML = `
      <span>Não é aqui?</span>
      <button type="button">🔄 Falar de novo</button>
    `;

    const btn = this.badgeRetentativa.querySelector('button');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removerBadgeRetentativa();
      if (typeof onTentarDeNovo === 'function') onTentarDeNovo();
    });

    this.searchBox.parentNode.insertBefore(this.badgeRetentativa, this.searchBox.nextSibling);

    // Some sozinho após 8 segundos se o usuário não clicar
    setTimeout(() => {
      this.removerBadgeRetentativa();
    }, 8000);
  }

  removerBadgeRetentativa() {
    if (this.badgeRetentativa) {
      this.badgeRetentativa.remove();
      this.badgeRetentativa = null;
    }
  }
}

export const vozUI = new HUByVozUI();