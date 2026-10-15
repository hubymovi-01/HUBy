/**
 * ============================================================================
 * HUBy - Servidor Backend em Node.js & Express (backend/server.js)
 * ============================================================================
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Memória temporária de alta performance para demonstração em tempo real
// (Pode ser substituída por tabelas PostgreSQL / PostGIS em produção)
let corridasAtivas = [];

// Rota HTTP para solicitar viagem ou frete
app.post('/api/solicitar-viagem', (req, res) => {
  const dadosPedido = req.body;
  
  const novaCorrida = {
    id: 'huby-' + Date.now(),
    status: 'buscando_motorista',
    criadoEm: new Date().toISOString(),
    ...dadosPedido
  };

  corridasAtivas.push(novaCorrida);

  // Emite o evento em tempo real via WebSocket para todos os motoristas online conectados
  io.emit('nova-chamada-disponivel', novaCorrida);

  console.log(`[HUBy API] Nova corrida criada: ${novaCorrida.id} (${novaCorrida.orcamento?.categoria})`);
  
  return res.status(200).json({
    sucesso: true,
    mensagem: 'Pedido registado com sucesso na nuvem HUBy!',
    id: novaCorrida.id,
    corrida: novaCorrida
  });
});

// Rota para atualizar o status da corrida (motorista aceitou ou cancelou)
app.post('/api/atualizar-corrida', (req, res) => {
  const { id, status, motoristaId } = req.body;
  const corrida = corridasAtivas.find(c => c.id === id);

  if (!corrida) {
    return res.status(404).json({ sucesso: false, erro: 'Corrida não encontrada' });
  }

  corrida.status = status;
  corrida.motoristaId = motoristaId;

  // Notifica o cliente em tempo real que o motorista aceitou
  io.emit(`status-atualizado-${id}`, corrida);

  return res.status(200).json({ sucesso: true, corrida });
});

// Gestão de conexões via WebSocket
io.on('connection', (socket) => {
  console.log(`[HUBy WebSocket] Parceiro conectado: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`[HUBy WebSocket] Parceiro desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor Backend HUBy a correr na porta ${PORT}`);
});