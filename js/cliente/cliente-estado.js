// js/cliente/cliente-estado.js - Estado Central da Interface do Passageiro
export const estadoCliente = {
  // Instância do mapa e navegação
  hubyMapa: null,
  coordsDestino: null,
  rotaAtual: null,

  // Gestão de Múltiplas Paradas
  paradas: [],
  distanciaTotalComParadas: null,
  duracaoTotalComParadas: null,

  // Ciclo de vida do pedido
  pedidoAtivoId: null,
  intervalPolling: null,
  categoriaSelecionada: 'carro',
  markerMotoristaAaminho: null,
  motoristaAceitouTocado: false,

  // Pós-corrida e Avaliação
  corridaParaAvaliarId: null,
  notaSelecionada: 5,
  gorjetaSelecionada: 0,

  // Estimativas e Carteira
  cronometroChegada: null,
  tempoEstimado: 5,
  saldoCarteiraCliente: 0
};