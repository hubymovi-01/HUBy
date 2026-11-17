// routes/suporte.routes.js - Sistema de Tickets e Ajuda HUBy
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// Cria a tabela automaticamente se ela não existir
async function inicializarTabelaSuporte() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS suporte_tickets (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT,
        usuario_id TEXT NOT NULL,
        usuario_nome VARCHAR(100),
        tipo_usuario VARCHAR(20),
        assunto VARCHAR(150),
        mensagem TEXT NOT NULL,
        resposta_admin TEXT,
        status VARCHAR(30) DEFAULT 'pendente',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        respondido_em TIMESTAMP WITH TIME ZONE
      );
    `;
  } catch (e) {
    console.warn('Aviso tabela de suporte:', e.message);
  }
}
inicializarTabelaSuporte();

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

// =========================================================================
// ROTA PARA O APP (Passageiro ou Motorista abrindo um chamado)
// =========================================================================
router.post('/chamado', autenticarToken, async (req, res) => {
  try {
    const usuarioId = String(req.usuario.id);
    const tipoUsuario = String(req.usuario.role || 'cliente');
    const { pedido_id, assunto, mensagem } = req.body;

    if (!mensagem) return res.status(400).json({ erro: 'A mensagem não pode estar vazia.' });

    const novoTicket = await sql`
      INSERT INTO suporte_tickets (pedido_id, usuario_id, usuario_nome, tipo_usuario, assunto, mensagem)
      VALUES (
        ${pedido_id || null}, 
        ${usuarioId}, 
        ${req.usuario.nome || 'Usuário'}, 
        ${tipoUsuario}, 
        ${String(assunto || 'Problema na Corrida').slice(0, 150)}, 
        ${String(mensagem).slice(0, 1000)}
      )
      RETURNING *;
    `;

    res.status(201).json({ sucesso: true, ticket: novoTicket[0] });
  } catch (err) {
    console.error('Erro ao abrir chamado:', err);
    res.status(500).json({ erro: 'Falha ao registrar seu problema.' });
  }
});

// =========================================================================
// ROTAS PARA O PAINEL ADMIN MASTER
// =========================================================================
router.get('/admin/chamados', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const chamados = await sql`
      SELECT * FROM suporte_tickets
      ORDER BY 
        CASE WHEN status = 'pendente' THEN 1 ELSE 2 END ASC, 
        criado_em DESC
      LIMIT 100;
    `;
    res.json(chamados);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar chamados.' });
  }
});

router.put('/admin/chamados/:id/responder', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { resposta } = req.body;

    if (!resposta) return res.status(400).json({ erro: 'A resposta é obrigatória.' });

    const atualizado = await sql`
      UPDATE suporte_tickets
      SET resposta_admin = ${String(resposta).slice(0, 1500)},
          status = 'respondido',
          respondido_em = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *;
    `;

    if (!atualizado.length) return res.status(404).json({ erro: 'Chamado não encontrado.' });

    res.json({ sucesso: true, ticket: atualizado[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao responder chamado.' });
  }
});

export default router;