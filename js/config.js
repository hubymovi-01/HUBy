/**
 * HUBy 2.0 - Configurações Gerais, Tarifas e Gamificação Sonora (js/config.js)
 */

export const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

// DESPERTADOR: Acorda o servidor em background assim que o app é aberto
fetch(`${API_URL}/`).catch(() => {
  console.log('A acordar o motor do servidor HUBy...');
});

// Opções rápidas de recarga da Carteira Digital Pré-Paga
export const OPCOES_RECARGA_PIX = [10.00, 20.00, 50.00, 100.00];

// Tarifas de contingência com tipos rigorosamente mapeados
export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 6.5, km: 2.2, min: 10.0 },
  moto: { id: 'moto', tipo: 'moto', nome: 'HUBy Moto', icone: '🏍️', base: 4.0, km: 1.5, min: 7.0 },
  flash_moto: { id: 'flash_moto', tipo: 'flash_moto', nome: 'Flash Moto', icone: '📦', base: 5.0, km: 1.8, min: 8.0 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo_pickup', nome: 'Picape Frete', icone: '🛻', base: 35.0, km: 4.5, min: 45.0 }
};

export let MULTIPLICADOR_PICO = 1.0;

// Sincroniza em tempo real com as tarifas configuradas pelo dono no painel
export async function sincronizarTarifasServidor() {
  try {
    const resp = await fetch(`${API_URL}/api/config/tarifas`);
    if (!resp.ok) return;
    const dados = await resp.json();

    const aplicarTarifa = (chave) => {
      if (dados[chave] && CATEGORIAS[chave]) {
        CATEGORIAS[chave] = {
          ...CATEGORIAS[chave],
          base: Number(dados[chave].base) || CATEGORIAS[chave].base,
          km: Number(dados[chave].km) || CATEGORIAS[chave].km,
          min: Number(dados[chave].min) || CATEGORIAS[chave].min
        };
      }
    };

    aplicarTarifa('carro');
    aplicarTarifa('moto');
    aplicarTarifa('flash_moto');
    aplicarTarifa('cargo_pickup');

    if (dados.multiplicador_pico) {
      MULTIPLICADOR_PICO = Number(dados.multiplicador_pico) || 1.0;
    }
  } catch (err) {
    console.warn('Utilizando tabela de tarifas local de reserva:', err.message);
  }
}

// Algoritmo de Cálculo Dinâmico com Multiplicador de Pico/Chuva
export function calcularPreco(catId, distanciaKm) {
  const cat = CATEGORIAS[catId] || CATEGORIAS.carro;
  const dist = Math.max(0.5, Number(distanciaKm) || 1.5);
  
  // Fórmula base: Max(Mínimo, Base + Km) * Multiplicador
  const valorBaseCalculado = Math.max(cat.min, cat.base + (dist * cat.km));
  const valorFinal = Number((valorBaseCalculado * MULTIPLICADOR_PICO).toFixed(2));

  return {
    categoria: cat.nome,
    tipo: cat.tipo,
    valorTotal: valorFinal,
    multiplicador: MULTIPLICADOR_PICO,
    formatado: `R$ ${valorFinal.toFixed(2).replace('.', ',')}`
  };
}

// ============================================================================
// SISTEMA DE EFEITOS SONOROS E GAMIFICAÇÃO VIA WEB AUDIO API (OFFLINE FIRST)
// ============================================================================
class AudioEfeitosHUBy {
  constructor() {
    this.ctx = null;
  }

  obterContexto() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Toque sonoro de nova corrida chegando no radar do motorista
  tocarAlertaChamada() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // Nota Lá (A5)
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15); // Nota Mi (E6)

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Áudio de radar desativado pelo navegador:', e);
    }
  }

  // Som agradável de confirmação ao aceitar viagem ou confirmar pagamento Pix
  tocarSucessoAceite() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const notas = [523.25, 659.25, 783.99]; // Dó, Mi, Sol
      notas.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08);

        gain.gain.setValueAtTime(0.25, ctx.currentTime + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.08);
        osc.stop(ctx.currentTime + idx * 0.08 + 0.2);
      });
    } catch (e) {}
  }

  // Fanfarra triunfal de comemoração ao bater a meta financeira do dia
  tocarMetaBatida() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const acordes = [523.25, 659.25, 783.99, 1046.50]; // Acorde Maior de vitória
      acordes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);

        gain.gain.setValueAtTime(0.3, ctx.currentTime + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + idx * 0.1);
        osc.stop(ctx.currentTime + idx * 0.1 + 0.4);
      });
    } catch (e) {}
  }
}

export const sonsHUBy = new AudioEfeitosHUBy();