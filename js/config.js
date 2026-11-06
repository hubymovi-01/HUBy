/**
 * ============================================================================
 * HUBy 2.0 - Configuração Central de Segurança e Endpoint da API (js/config.js)
 * Versão Blindada e Protegida contra Modificações e Roubo de Sessão
 * ============================================================================
 */

// 1. DOMÍNIOS OFICIALMENTE AUTORIZADOS A EXECUTAR O CLIENTE HUBy
const DOMINIOS_AUTORIZADOS = [
  'hubymovi-01.github.io',
  'localhost',
  '127.0.0.1'
];

// 2. VALIDAÇÃO DE SEGURANÇA DA ORIGEM DA PÁGINA
function validarOrigemSegura() {
  if (typeof window === 'undefined') return true; // Se rodar em ambiente Node/SSR
  
  const hostAtual = window.location.hostname;
  const protocoloAtual = window.location.protocol;

  // Em produção, obriga o uso estrito de HTTPS (exceto para localhost)
  if (hostAtual !== 'localhost' && hostAtual !== '127.0.0.1' && protocoloAtual !== 'https:') {
    console.error('🚨 SEGURANÇA HUBy: Conexão não encriptada rejeitada.');
    window.location.replace('https://' + window.location.hostname + window.location.pathname);
    return false;
  }

  // Verifica se o host atual faz parte da lista de domínios confiáveis
  const autorizado = DOMINIOS_AUTORIZADOS.some(dominio => hostAtual === dominio || hostAtual.endsWith('.' + dominio));
  
  if (!autorizado) {
    console.warn('⚠️ ALERTA DE SEGURANÇA: Tentativa de execução em domínio não autorizado (' + hostAtual + ').');
    // Limpa vestígios de sessão para evitar roubo de tokens em clones maliciosos
    try {
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_user_id');
    } catch (e) {}
    return false;
  }

  return true;
}

// Executa a barreira de segurança imediatamente ao carregar o script
if (!validarOrigemSegura()) {
  throw new Error('Acesso bloqueado por razões de segurança do HUBy 2.0.');
}

// 3. DEFINIÇÃO BLINDADA DO ENDPOINT DA API OFICIAL
export const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://huby.onrender.com';

// DESPERTADOR SEGURO: Envia um ping assíncrono estrito apenas para acordar a instância no Render
try {
  fetch(`${API_URL}/`, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
} catch (e) {}

// Opções pré-definidas para recarga de saldo na Carteira Digital Pix
export const OPCOES_RECARGA_PIX = [1.00, 10.00, 20.00, 50.00, 100.00];

// Tabela de categorias protegida contra injeções
export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 1.0, km: 1.0, min: 1.0 },
  moto: { id: 'moto', tipo: 'moto', nome: 'HUBy Moto', icone: '🏍️', base: 1.0, km: 0.8, min: 1.0 },
  entrega: { id: 'entrega', tipo: 'entrega', nome: 'HUBy Entrega', icone: '📦', base: 1.0, km: 1.0, min: 1.0 },
  flash_moto: { id: 'flash_moto', tipo: 'flash_moto', nome: 'Flash Moto', icone: '📦', base: 1.0, km: 1.0, min: 1.0 },
  cargo_pickup: { id: 'cargo_pickup', tipo: 'cargo_pickup', nome: 'Picape Frete', icone: '🛻', base: 10.0, km: 2.0, min: 10.0 }
};

export let MULTIPLICADOR_PICO = 1.0;

// Sincronização segura de tarifas em tempo real
export async function sincronizarTarifasServidor() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // Timeout de segurança contra travamentos

    let resp = await fetch(`${API_URL}/api/admin/tarifas`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!resp.ok) return;
    const dados = await resp.json();

    if (dados && typeof dados === 'object') {
      ['carro', 'moto', 'entrega'].forEach(chave => {
        if (dados[chave] && CATEGORIAS[chave]) {
          CATEGORIAS[chave].base = Number(dados[chave].base) || CATEGORIAS[chave].base;
          CATEGORIAS[chave].km = Number(dados[chave].km) || CATEGORIAS[chave].km;
          CATEGORIAS[chave].min = Number(dados[chave].min) || CATEGORIAS[chave].min;
        }
      });
      if (dados.multiplicador_pico) {
        MULTIPLICADOR_PICO = Number(dados.multiplicador_pico) || 1.0;
      }
    }
  } catch (err) {
    // Mantém fallback silencioso sem expor detalhes sensíveis da infraestrutura no console
  }
}

// Cálculo seguro de preços com validação numérica estrita
export function calcularPreco(catId, distanciaKm) {
  const chave = String(catId || 'carro').toLowerCase();
  const cat = CATEGORIAS[chave] || CATEGORIAS.carro;
  
  const dist = Math.max(0.1, Number(distanciaKm) || 1.0);
  const custoBaseMaisKm = cat.base + (dist * cat.km);
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

sincronizarTarifasServidor();

// ============================================================================
// EFEITOS SONOROS COM WEB AUDIO API (Isolados e Seguros)
// ============================================================================
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