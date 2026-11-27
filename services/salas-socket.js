// services/salas-socket.js - Para quem vai cada aviso em tempo real
// Regra: dados de uma corrida só vão para o passageiro, o motorista dela e os admins.
// Os outros motoristas recebem só o necessário para tirar a chamada do radar (sem dados pessoais).

export const SALA_ADMINS = 'admins';
export const SALA_MOTORISTAS = 'motoristas';
export const salaCorrida = (pedidoId) => `corrida:${pedidoId}`;
export const salaUsuario = (usuarioId) => `usuario:${usuarioId}`;
export const salaMotorista = (motoristaId) => `motorista:${motoristaId}`;

function valido(io) {
  return io && typeof io.to === 'function';
}

// Passageiro + motorista da corrida (+ admins, se pedir)
export function avisarCorrida(io, pedidoId, evento, dados, { admins = true } = {}) {
  if (!valido(io) || !pedidoId) return;
  let destino = io.to(salaCorrida(String(pedidoId)));
  if (admins) destino = destino.to(SALA_ADMINS);
  destino.emit(evento, dados);
}

export function avisarAdmins(io, evento, dados) {
  if (!valido(io)) return;
  io.to(SALA_ADMINS).emit(evento, dados);
}

// Todos os motoristas logados (e admins). Use só com dados que qualquer motorista pode ver.
export function avisarMotoristas(io, evento, dados, { admins = true } = {}) {
  if (!valido(io)) return;
  let destino = io.to(SALA_MOTORISTAS);
  if (admins) destino = destino.to(SALA_ADMINS);
  destino.emit(evento, dados);
}

// Um motorista específico (todas as abas/aparelhos dele)
export function avisarMotorista(io, motoristaId, evento, dados) {
  if (!valido(io) || !motoristaId) return;
  io.to(salaMotorista(String(motoristaId))).emit(evento, dados);
}

// Coloca as conexões abertas do passageiro na sala da corrida (ex.: logo após pedir)
export function colocarPassageiroNaCorrida(io, clienteId, pedidoId) {
  if (!valido(io) || !clienteId || !pedidoId) return;
  try {
    io.in(salaUsuario(String(clienteId))).socketsJoin(salaCorrida(String(pedidoId)));
  } catch (e) {}
}

// Coloca as conexões abertas do motorista na sala da corrida (ex.: logo após aceitar)
export function colocarMotoristaNaCorrida(io, motoristaId, pedidoId) {
  if (!valido(io) || !motoristaId || !pedidoId) return;
  try {
    io.in(salaMotorista(String(motoristaId))).socketsJoin(salaCorrida(String(pedidoId)));
  } catch (e) {}
}