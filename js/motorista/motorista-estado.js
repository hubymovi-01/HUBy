// js/motorista/motorista-estado.js
// Estado compartilhado entre todos os submódulos do condutor

export const estado = {
  hubyMapa: null,
  mapa: null,
  markerVeiculo: null,
  linhaRota: null,
  markerOrigem: null,
  markerDestino: null,
  coords: [-8.3580, -42.2460],

  isOnline: false,
  statusOnline: false,
  modoUltimaViagem: false,
  
  // Dados do parceiro e autenticação
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_motorista_id') || localStorage.getItem('huby_user_id') || null,
  motoristaNome: 'Carol',
  saldoCarteira: 0,
  dadosMotorista: {},
  novaFotoBase64Temp: null,
  categoriaMotorista: 'carro',
  statusAprovacaoAtual: 'aprovado',

  // Preferências de pagamento do condutor
  aceitaDinheiro: true,
  aceitaCartao: true,
  aceitaPix: true,

  // Viagem e atendimento
  pedidoAceitoAtual: null,
  pedidoAtivo: null,
  pedidoEmAnalise: null,
  pedidoEmInspecao: null,
  etapaCorridaAtual: 'a_caminho', // 'a_caminho' | 'em_viagem'
  faseViagem: 'buscar_passageiro',

  // Radar, Socket e conexões
  socket: null,
  socketRadar: null,
  intervalRadar: null,
  intervalChat: null,
  pedidosIgnorados: new Set(),
  chamadasAnterioresIds: new Set(),

  // GPS e telemetria
  intervalTelemetria: null,
  intervalGpsSocket: null,
  direcaoCasaAtiva: false,
  coordsCasaMotorista: null,

  // Ganhos e metas de hoje
  ganhosHoje: 0,
  corridasHoje: 0,
  metaDiaria: Number(localStorage.getItem('huby_meta_diaria') || 200)
};

export function obterHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = estado.token || localStorage.getItem('huby_token');
  if (token && token !== 'null') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}