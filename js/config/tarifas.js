/**
 * ============================================================================
 * HUBy - Configuração Central de Categorias, Tarifas, Comissões e Adicionais
 * Arquivo: js/config/tarifas.js
 * ============================================================================
 */

export const CATEGORIAS_HUBY = {
  // --- GRUPO: HUBy Viagem (Carro & Moto) ---
  carro: {
    id: 'carro',
    grupo: 'carro',
    nome: 'HUBy Carro',
    descricao: 'Viagens confortáveis para até 4 passageiros',
    icone: '🚗',
    corHex: '#10B981',
    taxaSaida: 6.50,
    precoPorKm: 2.20,
    precoPorMinuto: 0.25,
    tarifaMinima: 10.00,
    comissaoPercentual: 15,
    limiteDividaCarteira: 50.00
  },
  moto: {
    id: 'moto',
    grupo: 'carro',
    nome: 'HUBy Moto',
    descricao: 'Mototáxi rápido e econômico no dia a dia',
    icone: '🏍️',
    corHex: '#10B981',
    taxaSaida: 4.00,
    precoPorKm: 1.50,
    precoPorMinuto: 0.15,
    tarifaMinima: 7.00,
    comissaoPercentual: 15,
    limiteDividaCarteira: 50.00
  },

  // --- GRUPO: HUBy Flash (Entregas e Encomendas) ---
  flash_moto: {
    id: 'flash_moto',
    grupo: 'flash',
    nome: 'Flash Moto',
    descricao: 'Encomendas leves, documentos e pacotes (até 20kg)',
    icone: '📦',
    corHex: '#38BDF8',
    taxaSaida: 5.00,
    precoPorKm: 1.80,
    precoPorMinuto: 0.20,
    tarifaMinima: 8.00,
    comissaoPercentual: 14,
    limiteDividaCarteira: 50.00
  },
  flash_carro: {
    id: 'flash_carro',
    grupo: 'flash',
    nome: 'Flash Utilitário (Fiorino/Picape)',
    descricao: 'Compras de mercado, caixas e eletrodomésticos médios',
    icone: '🛻',
    corHex: '#38BDF8',
    taxaSaida: 15.00,
    precoPorKm: 2.80,
    precoPorMinuto: 0.35,
    tarifaMinima: 25.00,
    comissaoPercentual: 14,
    limiteDividaCarteira: 100.00
  },

  // --- GRUPO: HUBy Cargo (Fretes Pesados, Vans e Caminhões) ---
  cargo_pickup: {
    id: 'cargo_pickup',
    grupo: 'cargo',
    nome: 'Caminhonete / Picape',
    descricao: 'Transporte de móveis e cargas médias abertas',
    icone: '🛻',
    corHex: '#FF6B00',
    taxaSaida: 35.00,
    precoPorKm: 4.50,
    precoPorMinuto: 0.40,
    tarifaMinima: 45.00,
    comissaoPercentual: 10,
    limiteDividaCarteira: 120.00
  },
  cargo_van: {
    id: 'cargo_van',
    grupo: 'cargo',
    nome: 'Van de Carga Baú',
    descricao: 'Mudanças parciais protegidas contra chuva',
    icone: '🚐',
    corHex: '#FF6B00',
    taxaSaida: 50.00,
    precoPorKm: 5.50,
    precoPorMinuto: 0.50,
    tarifaMinima: 70.00,
    comissaoPercentual: 10,
    limiteDividaCarteira: 150.00
  },
  cargo_vuc: {
    id: 'cargo_vuc',
    grupo: 'cargo',
    nome: 'Caminhão VUC / Grande Porte',
    descricao: 'Mudanças residenciais completas e cargas pesadas',
    icone: '🚚',
    corHex: '#FF6B00',
    taxaSaida: 80.00,
    precoPorKm: 6.50,
    precoPorMinuto: 0.60,
    tarifaMinima: 110.00,
    comissaoPercentual: 8,
    limiteDividaCarteira: 180.00
  }
};

// Aliases resolvidos com segurança sem duplicar Object.values
const MAPA_ALIASES = {
  passageiro_carro: 'carro',
  passageiro_moto: 'moto',
  entrega_moto: 'flash_moto',
  entrega_utilitario: 'flash_carro',
  frete_caminhao: 'cargo_vuc'
};

export const TABELA_ADICIONAIS = {
  valorPorAjudante: 50.00,
  taxaEscadaSemElevador: 20.00,
  taxaParadaExtra: 6.00
};

export function formatarMoedaBRL(valorNumerico) {
  return `R$ ${Number(valorNumerico || 0).toFixed(2).replace('.', ',')}`;
}

export function obterCategoriaPorId(categoriaId) {
  const chaveReal = MAPA_ALIASES[categoriaId] || categoriaId;
  return CATEGORIAS_HUBY[chaveReal] || CATEGORIAS_HUBY.carro;
}

export function calcularOrcamentoViagem(categoriaId, distanciaKm, duracaoMin = 0, opcoesExtras = {}) {
  const cat = obterCategoriaPorId(categoriaId);

  const distValida = Math.max(0.5, Number(distanciaKm || 0));
  const durValida = Math.max(1, Number(duracaoMin || 0));

  let valorBase = cat.taxaSaida + (distValida * cat.precoPorKm) + (durValida * cat.precoPorMinuto);
  if (valorBase < cat.tarifaMinima) {
    valorBase = cat.tarifaMinima;
  }

  const qtdAjudantes = Math.max(0, Number(opcoesExtras.qtdAjudantes || 0));
  const temEscada = Boolean(opcoesExtras.temEscada);
  const paradasExtras = Math.max(0, Number(opcoesExtras.paradasExtras || 0));

  const custoAjudantes = qtdAjudantes * TABELA_ADICIONAIS.valorPorAjudante;
  const custoEscada = temEscada ? TABELA_ADICIONAIS.taxaEscadaSemElevador : 0;
  const custoParadas = paradasExtras * TABELA_ADICIONAIS.taxaParadaExtra;

  const valorAdicionais = custoAjudantes + custoEscada + custoParadas;
  const valorTotalCliente = valorBase + valorAdicionais;

  const valorComissaoPlataforma = valorBase * (cat.comissaoPercentual / 100);
  const ganhoLiquidoMotorista = (valorBase - valorComissaoPlataforma) + valorAdicionais;

  return {
    categoriaId: cat.id,
    categoriaNome: cat.nome,
    grupo: cat.grupo,
    icone: cat.icone,
    corHex: cat.corHex,
    distanciaKm: Number(distValida.toFixed(1)),
    duracaoMin: Math.round(durValida),
    valorBase: Number(valorBase.toFixed(2)),
    valorAdicionais: Number(valorAdicionais.toFixed(2)),
    valorTotalCliente: Number(valorTotalCliente.toFixed(2)),
    valorTotalFormatado: formatarMoedaBRL(valorTotalCliente),
    comissaoPercentual: cat.comissaoPercentual,
    valorComissaoPlataforma: Number(valorComissaoPlataforma.toFixed(2)),
    ganhoLiquidoMotorista: Number(ganhoLiquidoMotorista.toFixed(2)),
    ganhoLiquidoFormatado: formatarMoedaBRL(ganhoLiquidoMotorista)
  };
}