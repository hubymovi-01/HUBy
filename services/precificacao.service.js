// services/precificacao.service.js - Fórmula ÚNICA de preço da HUBy (usada na cotação e na criação da corrida)
//
// Preço de uma categoria:
//   1) km cobrados   = distância - km incluídos na base (nunca negativo)
//   2) valor corrida = base + km cobrados × R$/km + minutos × R$/min
//   3) × multiplicador da tarifa dinâmica (pico/zona)
//   4) nunca abaixo do "valor mínimo" da categoria
//   5) + paradas × taxa por parada + adicionais
//   6) − desconto de indicação (1ª corrida) − cupom
//   O app (js/config.js) usa exatamente a mesma conta para a estimativa instantânea.
import { sql } from '../db.js';
import { lerTarifasDoBanco } from '../routes/admin.routes.js';

export const CATEGORIAS_PRECO = ['carro', 'moto', 'entrega'];

const VALOR_MINIMO_ABSOLUTO = 0.50;
const CACHE_MULTIPLICADOR_MS = 20000;
const cacheMultiplicador = new Map();

function arred(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function numeroSeguro(v, padrao = 0) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : padrao;
}

// Converte qualquer nome de categoria do app para uma das 3 tabelas de preço
export function chaveCategoriaPreco(categoria) {
  const c = String(categoria || 'carro').toLowerCase().trim();
  if (['moto', 'hubymoto', 'huby moto'].includes(c)) return 'moto';
  if (['entrega', 'flash', 'flash_moto', 'hubyflash', 'huby flash', 'frete', 'cargo_pickup'].includes(c)) return 'entrega';
  return 'carro';
}

// Distância e tempo que o servidor aceita
export function normalizarDistanciaTempo({ origLat, origLng, destLat, destLng, distanciaKmApp, duracaoMinApp }) {
  const linhaReta = calcularDistanciaKm(origLat, origLng, destLat, destLng);
  const km = arred(Math.max(0.2, numeroSeguro(distanciaKmApp, 0), linhaReta));

  // Tempo: não pode ser menor que ~50 km/h de média nem absurdamente alto
  const minimoMin = Math.max(2, km * 1.2);
  const maximoMin = km * 6 + 20;
  const minutos = Math.round(Math.min(maximoMin, Math.max(minimoMin, numeroSeguro(duracaoMinApp, 0))));

  return { km, minutos, linhaRetaKm: arred(linhaReta) };
}

export function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const vals = [lat1, lng1, lat2, lng2].map(Number);
  if (!vals.every(Number.isFinite)) return 0;
  const [a1, o1, a2, o2] = vals;
  const R = 6371.0;
  const dLat = ((a2 - a1) * Math.PI) / 180;
  const dLng = ((o2 - o1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a1 * Math.PI) / 180) * Math.cos((a2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Valor de UMA categoria, sem descontos
export function calcularValorCategoria(cfgCat, { km, minutos, multiplicador = 1, qtdParadas = 0, taxaParada = 0, adicionais = 0 }) {
  const base = Math.max(0, numeroSeguro(cfgCat?.base));
  const precoKm = Math.max(0, numeroSeguro(cfgCat?.km));
  const precoMin = Math.max(0, numeroSeguro(cfgCat?.min));
  const kmIncluidos = Math.max(0, numeroSeguro(cfgCat?.km_incluidos));
  const valorMinimo = Math.max(0, numeroSeguro(cfgCat?.minimo));

  const kmCobrados = Math.max(0, km - kmIncluidos);
  const valorCorrida = base + kmCobrados * precoKm + minutos * precoMin;
  const comDinamica = valorCorrida * Math.max(1, numeroSeguro(multiplicador, 1));
  const comMinimo = Math.max(valorMinimo, comDinamica);
  const valorParadas = Math.max(0, qtdParadas) * Math.max(0, taxaParada);
  const total = Math.max(VALOR_MINIMO_ABSOLUTO, comMinimo + valorParadas + Math.max(0, adicionais));

  return {
    kmCobrados: arred(kmCobrados),
    valorCorrida: arred(comMinimo),
    valorParadas: arred(valorParadas),
    valorSemDesconto: arred(total)
  };
}

// Multiplicador da tarifa dinâmica (com cache curto para não pesar o banco)
export async function obterMultiplicador(lat, lng) {
  const chave = `${Number(lat).toFixed(2)}_${Number(lng).toFixed(2)}`;
  const emCache = cacheMultiplicador.get(chave);
  if (emCache && Date.now() - emCache.em < CACHE_MULTIPLICADOR_MS) return emCache.valor;

  let valor = { multiplicador: 1, motivo: 'normal' };
  try {
    // Import dinâmico evita dependência circular entre os arquivos de rotas
    const { calcularMultiplicadorAtual } = await import('../routes/dinamica.routes.js');
    const r = await calcularMultiplicadorAtual(lat, lng);
    valor = {
      multiplicador: Math.max(1, numeroSeguro(r?.multiplicador, 1)),
      motivo: r?.motivo || 'normal'
    };
  } catch (e) {}

  cacheMultiplicador.set(chave, { em: Date.now(), valor });
  if (cacheMultiplicador.size > 500) cacheMultiplicador.clear();
  return valor;
}

// Desconto de indicação (1ª corrida de quem foi convidado)
async function obterDescontoIndicacao(clienteId) {
  if (!clienteId) return 0;
  try {
    const ind = await sql`
      SELECT valor_desconto_indicado FROM indicacoes_huby
      WHERE indicado_id = ${String(clienteId)} AND status = 'pendente'
      LIMIT 1;
    `;
    return ind.length ? Math.max(0, numeroSeguro(ind[0].valor_desconto_indicado, 5)) : 0;
  } catch (e) {
    return 0;
  }
}

// Confere o cupom SEM gastar um uso (o uso só é reservado ao criar a corrida)
export async function consultarCupom(codigo) {
  const cod = String(codigo || '').trim().toUpperCase().slice(0, 40);
  if (!cod) return null;
  try {
    const cupons = await sql`
      SELECT id, codigo, tipo, valor, expira_em, limite_usos, usos_atuais, ativo
      FROM cupons_desconto
      WHERE codigo = ${cod}
      LIMIT 1;
    `;
    if (!cupons.length || cupons[0].ativo === false) {
      return { codigo: cod, valido: false, motivo: 'Cupom inválido.' };
    }
    const c = cupons[0];
    if (c.expira_em && new Date(c.expira_em) < new Date()) {
      return { codigo: cod, valido: false, motivo: 'Cupom expirado.' };
    }
    const limite = Number(c.limite_usos || 0);
    if (limite > 0 && Number(c.usos_atuais || 0) >= limite) {
      return { codigo: cod, valido: false, motivo: 'Cupom esgotado.' };
    }
    const tipo = c.tipo === 'porcentagem' ? 'porcentagem' : 'fixo';
    const valor = tipo === 'porcentagem'
      ? Math.min(100, Math.max(0, numeroSeguro(c.valor)))
      : Math.max(0, numeroSeguro(c.valor));
    return { id: c.id, codigo: cod, valido: true, tipo, valor };
  } catch (e) {
    return { codigo: cod, valido: false, motivo: 'Não foi possível validar o cupom agora.' };
  }
}

// Aplica descontos na mesma ordem do pedido real: indicação primeiro, depois cupom
export function aplicarDescontos(valorSemDesconto, descontoIndicacao, cupom) {
  let valor = valorSemDesconto;
  let descInd = 0;
  let descCupom = 0;

  if (descontoIndicacao > 0) {
    const novo = Math.max(1.00, arred(valor - descontoIndicacao));
    descInd = arred(valor - novo);
    valor = novo;
  }

  if (cupom?.valido) {
    const bruto = cupom.tipo === 'porcentagem'
      ? arred((valor * cupom.valor) / 100)
      : cupom.valor;
    const novo = Math.max(VALOR_MINIMO_ABSOLUTO, arred(valor - bruto));
    descCupom = arred(valor - novo);
    valor = novo;
  }

  return {
    valorFinal: arred(valor),
    descontoIndicacao: descInd,
    descontoCupom: descCupom,
    descontoTotal: arred(descInd + descCupom)
  };
}

/**
 * Cotação completa (todas as categorias ou só uma).
 * Usada por POST /api/pedidos/cotacao e por POST /api/pedidos (criação).
 */
export async function calcularCotacao({
  origLat, origLng, destLat, destLng,
  distanciaKmApp, duracaoMinApp,
  qtdParadas = 0,
  adicionais = 0,
  cupomCodigo = null,
  clienteId = null,
  categorias = CATEGORIAS_PRECO,
  tarifas = null
}) {
  const tabela = tarifas || await lerTarifasDoBanco();
  const { km, minutos, linhaRetaKm } = normalizarDistanciaTempo({
    origLat, origLng, destLat, destLng, distanciaKmApp, duracaoMinApp
  });

  const paradas = Math.min(10, Math.max(0, parseInt(qtdParadas, 10) || 0));
  const adicionaisOk = Math.min(500, Math.max(0, numeroSeguro(adicionais, 0)));
  const taxaParada = Math.max(0, numeroSeguro(tabela.taxa_parada, 2.5));

  const [dinamica, descontoIndicacao, cupom] = await Promise.all([
    obterMultiplicador(origLat, origLng),
    obterDescontoIndicacao(clienteId),
    cupomCodigo ? consultarCupom(cupomCodigo) : Promise.resolve(null)
  ]);

  const resultado = {};
  const lista = Array.from(new Set((categorias || CATEGORIAS_PRECO).map(chaveCategoriaPreco)));

  for (const chave of lista) {
    const cfgCat = tabela[chave] || tabela.carro;
    const calc = calcularValorCategoria(cfgCat, {
      km,
      minutos,
      multiplicador: dinamica.multiplicador,
      qtdParadas: paradas,
      taxaParada,
      adicionais: adicionaisOk
    });
    const desc = aplicarDescontos(calc.valorSemDesconto, descontoIndicacao, cupom);
    resultado[chave] = { ...calc, ...desc };
  }

  return {
    distanciaKm: km,
    duracaoMin: minutos,
    linhaRetaKm,
    multiplicador: dinamica.multiplicador,
    motivoMultiplicador: dinamica.motivo,
    taxaParada,
    qtdParadas: paradas,
    adicionais: adicionaisOk,
    descontoIndicacaoDisponivel: descontoIndicacao,
    cupom: cupom ? { codigo: cupom.codigo, valido: cupom.valido, tipo: cupom.tipo, valor: cupom.valor, motivo: cupom.motivo } : null,
    cupomId: cupom?.valido ? cupom.id : null,
    categorias: resultado
  };
}