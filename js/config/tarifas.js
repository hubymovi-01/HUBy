/**
 * ============================================================================
 * HUBy - Configuração Central de Categorias, Tarifas, Comissões e Adicionais
 * ============================================================================
 */

export const CATEGORIAS_HUBY = {
  passageiro_carro: {
    id: 'passageiro_carro',
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
  passageiro_moto: {
    id: 'passageiro_moto',
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
  entrega_moto: {
    id: 'entrega_moto',
    grupo: 'flash',
    nome: 'HUBy Flash Moto',
    descricao: 'Encomendas leves, documentos e pacotes (até 20kg)',
    icone: '📦',
    corHex: '#38BDF8',
    taxaSaida: 7.00,
    precoPorKm: 2.00,
    precoPorMinuto: 0.20,
    tarifaMinima: 10.00,
    comissaoPercentual: 14,
    limiteDividaCarteira: 50.00
  },
  entrega_utilitario: {
    id: 'entrega_utilitario',
    grupo: 'flash',
    nome: 'HUBy Util (Fiorino/Picape)',
    descricao: 'Compras de mercado, eletrodomésticos e pacotes maiores',
    icone: '🛻',
    corHex: '#38BDF8',
    taxaSaida: 28.00,
    precoPorKm: 3.80,
    precoPorMinuto: 0.40,
    tarifaMinima: 38.00,
    comissaoPercentual: 14,
    limiteDividaCarteira: 100.00
  },
  frete_caminhao: {
    id: 'frete_caminhao',
    grupo: 'cargo',
    nome: 'HUBy Cargo (VUC / Caminhão)',
    descricao: 'Mudanças residenciais, materiais pesados e cargas',
    icone: '🚚',
    corHex: '#FF6B00',
    taxaSaida: 80.00,
    precoPorKm: 6.50,
    precoPorMinuto: 0.60,
    tarifaMinima: 110.00,
    comissaoPercentual: 8,
    limiteDividaCarteira: 150.00
  }
};

export const TABELA_ADICIONAIS = {
  valorPorAjudante: 50.00,
  taxaEscadaSemElevador: 20.00,
  taxaParadaExtra: 6.00
};

export function calcularOrcamentoViagem(categoriaId, distanciaKm, duracaoMin = 0, opcoesExtras = {}) {
  const cat = CATEGORIAS_HUBY[categoriaId] || CATEGORIAS_HUBY.passageiro_carro;

  let valorBase = cat.taxaSaida + (distanciaKm * cat.precoPorKm) + (duracaoMin * cat.precoPorMinuto);
  if (valorBase < cat.tarifaMinima) {
    valorBase = cat.tarifaMinima;
  }

  const qtdAjudantes = Number(opcoesExtras.qtdAjudantes || 0);
  const temEscada = Boolean(opcoesExtras.temEscada);
  const paradasExtras = Number(opcoesExtras.paradasExtras || 0);

  const custoAjudantes = qtdAjudantes * TABELA_ADICIONAIS.valorPorAjudante;
  const custoEscada = temEscada ? TABELA_ADICIONAIS.taxaEscadaSemElevador : 0;
  const custoParadas = paradasExtras * TABELA_ADICIONAIS.taxaParadaExtra;

  const valorAdicionais = custoAjudantes + custoEscada + custoParadas;

  const valorTotalCliente = valorBase + valorAdicionais;
  const valorComissaoPlataforma = valorBase * (cat.comissaoPercentual / 100);
  const ganhoLiquidoMotorista = (valorBase - valorComissaoPlataforma) + valorAdicionais;

  return {
    categoria: cat.nome,
    corHex: cat.corHex,
    distanciaKm: Number(distanciaKm.toFixed(2)),
    duracaoMin: Math.round(duracaoMin),
    valorBase: Number(valorBase.toFixed(2)),
    valorAdicionais: Number(valorAdicionais.toFixed(2)),
    valorTotalCliente: Number(valorTotalCliente.toFixed(2)),
    comissaoPercentual: cat.comissaoPercentual,
    valorComissaoPlataforma: Number(valorComissaoPlataforma.toFixed(2)),
    ganhoLiquidoMotorista: Number(ganhoLiquidoMotorista.toFixed(2))
  };
}