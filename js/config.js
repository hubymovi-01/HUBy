/**
 * ============================================================================
 * HUBy 2.0 - Configuração Central de Segurança e Endpoint da API (js/config.js)
 * Versão Blindada e Sincronizada em Tempo Real com o Painel Admin Master
 * ============================================================================
 */

const DOMINIOS_AUTORIZADOS = [
  'hubymovi-01.github.io',
  'localhost',
  '127.0.0.1'
];

function validarOrigemSegura() {
  if (typeof window === 'undefined') return true;
  
  const hostAtual = window.location.hostname;
  const protocoloAtual = window.location.protocol;

  if (hostAtual !== 'localhost' && hostAtual !== '127.0.0.1' && protocoloAtual !== 'https:') {
    console.error('🚨 SEGURANÇA HUBy: Conexão não encriptada rejeitada.');
    window.location.replace('https://' + window.location.hostname + window.location.pathname);
    return false;
  }

  const autorizado = DOMINIOS_AUTORIZADOS.some(dominio => hostAtual === dominio || hostAtual.endsWith('.' + dominio));
  
  if (!autorizado) {
    console.warn('⚠️ ALERTA DE SEGURANÇA: Tentativa de execução em domínio não autorizado (' + hostAtual + ').');
    try {
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_user_id');
    } catch (e) {}
    return false;
  }

  return true;
}

if (!validarOrigemSegura()) {
  throw new Error('Acesso bloqueado por razões de segurança do HUBy 2.0.');
}

export const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

try {
  fetch(`${API_URL}/`, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
} catch (e) {}

export const OPCOES_RECARGA_PIX = [1.00, 10.00, 20.00, 50.00, 100.00];

export let TAXA_PLATAFORMA_ATUAL = 15;

export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 1.0, km: 1.0, min: 0.30 },
  moto: { id: 'moto', tipo: 'moto', nome: 'HUBy Moto', icone: '🏍️', base: 1.0, km: 0.8, min: 0.20 },
  entrega: { id: 'entrega', tipo: 'entrega', nome: 'HUBy Entrega', icone: '📦', base: 1.0, km: 1.0, min: 0.25 },
  flash_moto: { id: 'flash_moto', tipo: 'flash_moto', nome: 'Flash Moto', icone: '📦', base: 1.0, km: 1.0, min: 0.25 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo_pickup', nome: 'Picape Frete', icone: '🛻', base: 10.0, km: 2.0, min: 10.0 }
};

export let MULTIPLICADOR_PICO = 1.0;

export function aplicarObjetoTarifas(raw) {
  if (!raw) return;
  let dados = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof dados === 'string') {
      try { dados = JSON.parse(dados); } catch (e) { return; }
    } else {
      break;
    }
  }
  if (!dados || typeof dados !== 'object') return;

  if (dados.tarifas && typeof dados.tarifas === 'object') {
    dados = { ...dados, ...dados.tarifas };
  }

  if (dados.taxa_plataforma !== undefined) {
    const t = Number(dados.taxa_plataforma);
    if (Number.isFinite(t) && t >= 0) TAXA_PLATAFORMA_ATUAL = t;
  }

  ['carro', 'moto', 'entrega'].forEach(chave => {
    if (dados[chave] && CATEGORIAS[chave]) {
      const b = Number(dados[chave].base);
      const k = Number(dados[chave].km);
      const m = Number(dados[chave].min);
      if (Number.isFinite(b) && b >= 0) CATEGORIAS[chave].base = b;
      if (Number.isFinite(k) && k >= 0) CATEGORIAS[chave].km = k;
      if (Number.isFinite(m) && m >= 0) CATEGORIAS[chave].min = m;
    }
  });

  if (CATEGORIAS.entrega && CATEGORIAS.flash_moto) {
    CATEGORIAS.flash_moto.base = CATEGORIAS.entrega.base;
    CATEGORIAS.flash_moto.km = CATEGORIAS.entrega.km;
    CATEGORIAS.flash_moto.min = CATEGORIAS.entrega.min;
  }

  if (dados.multiplicador_pico !== undefined) {
    MULTIPLICADOR_PICO = Number(dados.multiplicador_pico) || 1.0;
  }

  try {
    localStorage.setItem('huby_tarifas_cache', JSON.stringify({
      taxa_plataforma: TAXA_PLATAFORMA_ATUAL,
      carro: { base: CATEGORIAS.carro.base, km: CATEGORIAS.carro.km, min: CATEGORIAS.carro.min },
      moto: { base: CATEGORIAS.moto.base, km: CATEGORIAS.moto.km, min: CATEGORIAS.moto.min },
      entrega: { base: CATEGORIAS.entrega.base, km: CATEGORIAS.entrega.km, min: CATEGORIAS.entrega.min }
    }));
  } catch (e) {}
}

// Carrega imediatamente do cache local enquanto busca a versão mais recente do servidor
try {
  const salvo = localStorage.getItem('huby_tarifas_cache');
  if (salvo) aplicarObjetoTarifas(JSON.parse(salvo));
} catch (e) {}

export async function sincronizarTarifasServidor() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(`${API_URL}/api/admin/tarifas?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!resp.ok) return;
    const dados = await resp.json();
    aplicarObjetoTarifas(dados);
  } catch (err) {}
}

// Cálculo oficial sincronizado com Base + (DistânciaKm * PreçoKm) + (MinutosEstimados * PreçoMin)
export function calcularPreco(catId, distanciaKm) {
  let chave = String(catId || 'carro').toLowerCase();
  if (chave === 'flash') chave = 'entrega';
  const cat = CATEGORIAS[chave] || CATEGORIAS.carro;
  
  const dist = Math.max(0.1, Number(distanciaKm) || 1.0);
  const minutosChegadaEstimada = Math.max(2, Math.round(dist * 1.8));

  const custoBaseMaisKm = Number(cat.base || 0) + (dist * Number(cat.km || 0));
  const valorFinal = Number(Math.max(0.50, custoBaseMaisKm * MULTIPLICADOR_PICO).toFixed(2));

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

sincronizarTarifasServidor();

class AudioEfeitosHUBy {
  constructor() {
    this.ctx = null;
  }

  obterContexto() {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch (e) {}
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
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  tocarSucessoAceite() {
    try {
      const ctx = this.obterContexto();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) {}
  }

  tocarMetaBatida() {
    try {
      this.tocarSucessoAceite();
    } catch (e) {}
  }
}

export const sonsHUBy = new AudioEfeitosHUBy();