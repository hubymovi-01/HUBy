/**
 * ============================================================================
 * HUBy 2.0 - Configuração Central de Segurança e Endpoint da API (js/config.js)
 * Preço: MESMA fórmula do servidor (services/precificacao.service.js)
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

// "Acorda" o servidor do Render enquanto a página carrega
try {
  fetch(`${API_URL}/`, { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
} catch (e) {}

export const OPCOES_RECARGA_PIX = [1.00, 10.00, 20.00, 50.00, 100.00];

// ============================================================================
// TARIFAS (valores padrão iguais aos do servidor; são trocados pelos do painel admin)
// ============================================================================
export let TAXA_PLATAFORMA_ATUAL = 15;
export let MULTIPLICADOR_PICO = 1.0;      // última tarifa dinâmica recebida do servidor
export let TAXA_PARADA_EXTRA = 2.50;      // R$ por parada extra
export let TAXA_ESPERA_MINUTO = 0.50;     // R$ por minuto de espera

const VALOR_MINIMO_ABSOLUTO = 0.50;

// Só existem 3 tabelas de preço: carro, moto e entrega
export let CATEGORIAS = {
  carro: { id: 'carro', tipo: 'carro', nome: 'HUBy Carro', icone: '🚗', base: 6.0, km: 2.2, min: 0, km_incluidos: 0, minimo: 0 },
  moto: { id: 'moto', tipo: 'moto', nome: 'HUBy Moto', icone: '🏍️', base: 4.0, km: 1.4, min: 0, km_incluidos: 0, minimo: 0 },
  entrega: { id: 'entrega', tipo: 'entrega', nome: 'HUBy Entrega', icone: '📦', base: 5.0, km: 1.8, min: 0, km_incluidos: 0, minimo: 0 }
};

// Converte qualquer nome de categoria do app para uma das 3 tabelas (igual ao servidor)
export function chaveCategoriaPreco(categoria) {
  const c = String(categoria || 'carro').toLowerCase().trim();
  if (['moto', 'hubymoto', 'huby moto'].includes(c)) return 'moto';
  if (['entrega', 'flash', 'flash_moto', 'hubyflash', 'huby flash', 'frete', 'cargo_pickup'].includes(c)) return 'entrega';
  return 'carro';
}

function numeroSeguro(v, padrao = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

function arred(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

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

  ['carro', 'moto', 'entrega'].forEach((chave) => {
    const origem = dados[chave];
    if (!origem || typeof origem !== 'object') return;
    ['base', 'km', 'min', 'km_incluidos', 'minimo'].forEach((campo) => {
      if (origem[campo] === undefined || origem[campo] === null) return;
      const n = Number(origem[campo]);
      if (Number.isFinite(n) && n >= 0) CATEGORIAS[chave][campo] = n;
    });
  });

  if (dados.taxa_parada !== undefined) {
    const n = Number(dados.taxa_parada);
    if (Number.isFinite(n) && n >= 0) TAXA_PARADA_EXTRA = n;
  }
  if (dados.taxa_espera !== undefined) {
    const n = Number(dados.taxa_espera);
    if (Number.isFinite(n) && n >= 0) TAXA_ESPERA_MINUTO = n;
  }

  try {
    const copiaCat = (c) => ({ base: c.base, km: c.km, min: c.min, km_incluidos: c.km_incluidos, minimo: c.minimo });
    localStorage.setItem('huby_tarifas_cache', JSON.stringify({
      taxa_plataforma: TAXA_PLATAFORMA_ATUAL,
      taxa_parada: TAXA_PARADA_EXTRA,
      taxa_espera: TAXA_ESPERA_MINUTO,
      ...(dados.niveis_motorista ? { niveis_motorista: dados.niveis_motorista } : {}),
      carro: copiaCat(CATEGORIAS.carro),
      moto: copiaCat(CATEGORIAS.moto),
      entrega: copiaCat(CATEGORIAS.entrega)
    }));
  } catch (e) {}
}

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

// ============================================================================
// ESTIMATIVA INSTANTÂNEA (mesma conta do servidor, sem descontos)
//   km cobrados = km - km incluídos
//   valor = (base + km cobrados × R$/km + minutos × R$/min) × dinâmica
//   nunca abaixo do mínimo da categoria, + paradas + adicionais
// O preço OFICIAL vem de cotarCorrida(); esta conta só serve para mostrar algo na hora.
// ============================================================================
export function normalizarDistanciaTempo(distanciaKm, duracaoMin) {
  const km = arred(Math.max(0.2, numeroSeguro(distanciaKm, 0)));
  const minimoMin = Math.max(2, km * 1.2);
  const maximoMin = km * 6 + 20;
  const informado = numeroSeguro(duracaoMin, 0) || km * 2;
  const minutos = Math.round(Math.min(maximoMin, Math.max(minimoMin, informado)));
  return { km, minutos };
}

export function calcularPreco(catId, distanciaKm, duracaoMin, opcoes = {}) {
  const chave = chaveCategoriaPreco(catId);
  const cat = CATEGORIAS[chave] || CATEGORIAS.carro;
  const { km, minutos } = normalizarDistanciaTempo(distanciaKm, duracaoMin);

  const qtdParadas = Math.min(10, Math.max(0, parseInt(opcoes.qtdParadas, 10) || 0));
  const adicionais = Math.min(500, Math.max(0, numeroSeguro(opcoes.adicionais, 0)));
  const multiplicador = Math.max(1, numeroSeguro(opcoes.multiplicador ?? MULTIPLICADOR_PICO, 1));

  const kmCobrados = Math.max(0, km - Math.max(0, numeroSeguro(cat.km_incluidos)));
  const valorCorrida = Math.max(0, numeroSeguro(cat.base))
    + kmCobrados * Math.max(0, numeroSeguro(cat.km))
    + minutos * Math.max(0, numeroSeguro(cat.min));
  const comMinimo = Math.max(Math.max(0, numeroSeguro(cat.minimo)), valorCorrida * multiplicador);
  const valorParadas = qtdParadas * TAXA_PARADA_EXTRA;
  const valorFinal = arred(Math.max(VALOR_MINIMO_ABSOLUTO, comMinimo + valorParadas + adicionais));

  const minutosChegadaEstimada = Math.max(2, Math.round(km * 1.8));

  return {
    categoria: cat.nome,
    tipo: cat.tipo,
    chavePreco: chave,
    distanciaKm: km,
    duracaoMin: minutos,
    valorTotal: valorFinal,
    valorParadas: arred(valorParadas),
    multiplicador,
    taxaParadaAplicada: TAXA_PARADA_EXTRA,
    taxaEsperaAplicada: TAXA_ESPERA_MINUTO,
    minutosChegada: minutosChegadaEstimada,
    tempoEstimadoTexto: `~${minutosChegadaEstimada} min`,
    formatado: `R$ ${valorFinal.toFixed(2).replace('.', ',')}`
  };
}

// ============================================================================
// COTAÇÃO OFICIAL NO SERVIDOR (preço que será cobrado, com dinâmica, indicação e cupom)
// Uso:
//   const cot = await cotarCorrida({
//     origem: [lat, lng], destino: [lat, lng],
//     distanciaKm, duracaoMin, qtdParadas, adicionais, cupom, categoria
//   });
//   cot.categorias.carro.valorFinal  → valor a mostrar
//   Se der erro de rede, devolve null (mostre a estimativa de calcularPreco).
// ============================================================================
const cacheCotacoes = new Map();
const VALIDADE_COTACAO_MS = 15000;

export async function cotarCorrida({
  origem, destino,
  distanciaKm, duracaoMin,
  qtdParadas = 0,
  adicionais = 0,
  cupom = null,
  categoria = null
} = {}) {
  const [origLat, origLng] = Array.isArray(origem) ? origem.map(Number) : [];
  const [destLat, destLng] = Array.isArray(destino) ? destino.map(Number) : [];
  if (![origLat, origLng, destLat, destLng].every(Number.isFinite)) return null;

  const corpo = {
    origem_lat: origLat,
    origem_lng: origLng,
    destino_lat: destLat,
    destino_lng: destLng,
    distancia_km: numeroSeguro(distanciaKm, 0),
    duracao_min: numeroSeguro(duracaoMin, 0),
    qtdParadas: Math.max(0, parseInt(qtdParadas, 10) || 0),
    valor_adicionais: Math.max(0, numeroSeguro(adicionais, 0)),
    cupom_codigo: cupom ? String(cupom).trim().toUpperCase() : null,
    categoria: categoria || null
  };

  // Mesma consulta em menos de 15 s reaproveita a resposta (não estoura o limite do servidor)
  const chaveCache = JSON.stringify(corpo);
  const emCache = cacheCotacoes.get(chaveCache);
  if (emCache && Date.now() - emCache.em < VALIDADE_COTACAO_MS) return emCache.promessa;

  const promessa = (async () => {
    try {
      const token = localStorage.getItem('huby_token');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(`${API_URL}/api/pedidos/cotacao`, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token && token !== 'null' && token !== 'undefined' ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(corpo)
      });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        cacheCotacoes.delete(chaveCache);
        return null;
      }
      const dados = await resp.json();
      if (!dados || !dados.categorias) {
        cacheCotacoes.delete(chaveCache);
        return null;
      }

      const mult = Number(dados.multiplicador);
      if (Number.isFinite(mult) && mult >= 1) MULTIPLICADOR_PICO = mult;
      const taxaParada = Number(dados.taxaParada);
      if (Number.isFinite(taxaParada) && taxaParada >= 0) TAXA_PARADA_EXTRA = taxaParada;

      return dados;
    } catch (err) {
      cacheCotacoes.delete(chaveCache);
      return null;
    }
  })();

  cacheCotacoes.set(chaveCache, { em: Date.now(), promessa });
  if (cacheCotacoes.size > 50) {
    const maisAntiga = cacheCotacoes.keys().next().value;
    cacheCotacoes.delete(maisAntiga);
  }
  return promessa;
}

sincronizarTarifasServidor();

// ============================================================================
// SONS DO APP
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