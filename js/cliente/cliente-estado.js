// js/cliente/cliente-estado.js
export const estadoCliente = {
  hubyMapa: null,
  coordsDestino: null,
  rotaAtual: null,
  pedidoAtivoId: null,
  intervalPolling: null,
  categoriaSelecionada: 'carro',
  markerMotoristaAaminho: null,

  corridaParaAvaliarId: null,
  notaSelecionada: 5,
  gorjetaSelecionada: 0,

  cronometroChegada: null,
  tempoEstimado: 5,
  saldoCarteiraCliente: 0
};