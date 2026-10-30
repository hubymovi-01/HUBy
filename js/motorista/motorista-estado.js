// js/motorista/motorista-estado.js
// Estado compartilhado entre todos os submódulos do condutor

export const estado = {
  hubyMapa: null,
  isOnline: false,
  modoUltimaViagem: false,
  
  // Dados do parceiro e veículo em memória
  dadosMotorista: {},
  novaFotoBase64Temp: null,
  categoriaMotorista: 'carro',
  statusAprovacaoAtual: 'aprovado',

  // Viagem e atendimento
  pedidoAceitoAtual: null,
  pedidoEmAnalise: null,
  etapaCorridaAtual: 'a_caminho', // 'a_caminho' | 'em_viagem'

  // Radar e conexões
  socketRadar: null,
  intervalRadar: null,
  chamadasAnterioresIds: new Set(),

  // GPS e telemetria
  intervalTelemetria: null,
  direcaoCasaAtiva: false,
  coordsCasaMotorista: null,

  // Ganhos e metas de hoje
  ganhosHoje: 0,
  corridasHoje: 0,
  metaDiaria: Number(localStorage.getItem('huby_meta_diaria') || 200)
};