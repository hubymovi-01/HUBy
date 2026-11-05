/**
 * HUBy 2.0 - Configurações Gerais, Tarifas Dinâmicas e Gamificação Sonora (js/config.js)
 */

// Se estiver a rodar localmente usa a porta 3000; caso contrário, aponta para a API no Render
export const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

// DESPERTADOR: Envia um ping para acordar a instância gratuita do Render em segundo plano
fetch(`${API_URL}/`).catch(() => {
  console.log('A acordar a instância do servidor HUBy...');
});

// Opções pré-definidas para recarga de saldo na Carteira Digital Pix (R$ 1.00 adicionado para testes)
export const OPCOES_RECARGA_PIX = [1.00, 10.00, 20.00, 50.00, 100.00];

// Tabela de categorias com valores base otimizados para permitir testes de R$ 1.00
export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 1.0, km: 1.0, min: 1.0 },
  moto: { id: 'moto', tipo: 'moto', nome: 'HUBy Moto', icone: '🏍️', base: 1.0, km: 0.8, min: 1.0 },
  entrega: { id: 'entrega', tipo: 'entrega', nome: 'HUBy Entrega', icone: '📦', base: 1.0, km: 1.0, min: 1.0 },
  flash_moto: { id: 'flash_moto', tipo: 'flash_moto', nome: 'Flash Moto', icone: '📦', base: 1.0, km: 1.0, min: 1.0 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo_pickup', nome: 'Picape Frete', icone: '🛻', base: 10.0, km: 2.0, min: 10.0 }
};

export let MULTIPLICADOR_PICO = 1.0;

// Sincronização em tempo real das tarifas configuradas no Painel de Administração
export async function sincronizarTarifasServidor() {
  try {
    let resp = await fetch(`${API_URL}/api/admin/tarifas`);
    if (!resp.ok) {
      resp = await fetch(`${API_URL}/api/config/tarifas`);
    }

    if (!resp.ok) return;
    const dados = await resp.json();

    const aplicarTarifa = (chave, chaveOrigem) => {
      const fonte = dados[chaveOrigem || chave];
      if (fonte && CATEGORIAS[chave]) {
        CATEGORIAS[chave] = {
          ...CATEGORIAS[chave],
          base: Number(fonte.base !== undefined ? fonte.base : CATEGORIAS[chave].base),
          km: Number(fonte.km !== undefined ? fonte.km : (dados.km_carro || CATEGORIAS[chave].km)),
          min: Number(fonte.min !== undefined ? fonte.min : CATEGORIAS[chave].min)
        };
      }
    };

    aplicarTarifa('carro');
    aplicarTarifa('moto');
    aplicarTarifa('entrega');
    aplicarTarifa('flash_moto', 'entrega');

    if (dados.multiplicador_pico) {
      MULTIPLICADOR_PICO = Number(dados.multiplicador_pico) || 1.0;
    }
  } catch (err) {
    console.warn('Utilizando tabela de tarifas local em contingência:', err.message);
  }
}

// Cálculo dinâmico respeitando o valor mínimo cadastrado
export function calcularPreco(catId, distanciaKm) {
  const chave = String(catId || 'carro').toLowerCase();
  const cat = CATEGORIAS[chave] || CATEGORIAS.carro;
  
  // Evita calcular distância 0; assume pelo menos 0.1km para trajetos minúsculos
  const dist = Math.max(0.1, Number(distanciaKm) || 1.0);

  // Fórmula base: Taxa Base + (Distância * Valor por Km)
  const custoBaseMaisKm = cat.base + (dist * cat.km);
  
  // Garante que o valor final nunca fique abaixo da tarifa mínima configurada
  const valorComMinimo = Math.max(cat.min, custoBaseMaisKm);
  const valorFinal = Number((valorComMinimo * MULTIPLICADOR_PICO).toFixed(2));

  const minutosChegadaEstimada = Math.max(2, Math.round(dist * 1.8));

  return {
    categoria: cat.nome,
    tipo: cat.tipo,
    valorTotal: valorFinal,
    multiplicador: MULTIPLICADOR_PICO,
    minutosChegada: minutosChegadaEstimada,
    tempoEstimadoTexto: `~${minutosChegadaEstimada} min de si`,
    formatado: `R$ ${valorFinal.toFixed(2).replace('.', ',')}`
  };
}

// Inicialização imediata da sincronização de tarifas
sincronizarTarifasServidor();

// Ouvinte de Socket.IO para receção de atualizações de tarifa em tempo real
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof io !== 'undefined') {
      try {
        const socket = io(API_URL);
        socket.on('tarifas_atualizadas', (novasTarifas) => {
          console.log('⚡ Tarifas atualizadas em tempo real via Socket.IO:', novasTarifas);
          sincronizarTarifasServidor();
        });
      } catch (e) {}
    }
  });
}

// ============================================================================
// EFEITOS SONOROS COM WEB AUDIO API
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

  tocarAlertaChamada() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.warn('Áudio de radar desativado:', e);
    }
  }

  tocarSucessoAceite() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const notas = [523.25, 659.25, 783.99];
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

  tocarMetaBatida() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;

      const acordes = [523.25, 659.25, 783.99, 1046.50];
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