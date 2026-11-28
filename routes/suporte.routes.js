// routes/suporte.routes.js - Sistema de Tickets e Ajuda HUBy
// A resposta do admin chega de 2 jeitos:
//   1) na hora, no app (aviso em tempo real "resposta_suporte_admin", só para quem abriu o chamado);
//   2) por e-mail (Brevo), para quem estiver com o app fechado.
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { enviarEmail } from '../services/email.service.js';
import { salaUsuario, salaMotorista } from '../services/salas-socket.js';

const router = express.Router();

const LIMITE_CHAMADOS_POR_HORA = 5;

// =========================================================================
// INICIALIZAÇÃO DA TABELA NO BANCO DE DADOS
// =========================================================================
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

// Middleware de Proteção para o Painel Admin
function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =========================================================================
// 1. ROTA PARA O APP (Passageiro ou Motorista abrindo um chamado)
// =========================================================================
router.post('/chamado', autenticarToken, async (req, res) => {
  try {
    const usuarioId = String(req.usuario.id);
    const tipoUsuario = String(req.usuario.role || 'cliente').toLowerCase().slice(0, 20);
    const { pedido_id, assunto, mensagem } = req.body || {};

    const mensagemLimpa = String(mensagem || '').trim().slice(0, 1000);
    if (!mensagemLimpa) return res.status(400).json({ erro: 'A mensagem não pode estar vazia.' });

    // Evita spam: no máximo 5 chamados por hora para cada conta
    const recentes = await sql`
      SELECT COUNT(*)::int AS qtd FROM suporte_tickets
      WHERE usuario_id = ${usuarioId} AND criado_em >= NOW() - INTERVAL '1 hour';
    `;
    if (Number(recentes[0]?.qtd || 0) >= LIMITE_CHAMADOS_POR_HORA) {
      return res.status(429).json({ erro: 'Você já abriu vários chamados na última hora. Aguarde a resposta da equipe HUBy.' });
    }

    const pedidoLimpo = pedido_id && /^[A-Za-z0-9_-]{4,64}$/.test(String(pedido_id)) ? String(pedido_id) : null;

    const novoTicket = await sql`
      INSERT INTO suporte_tickets (pedido_id, usuario_id, usuario_nome, tipo_usuario, assunto, mensagem)
      VALUES (
        ${pedidoLimpo},
        ${usuarioId},
        ${String(req.usuario.nome || 'Usuário').slice(0, 100)},
        ${tipoUsuario},
        ${String(assunto || 'Problema na Corrida').slice(0, 150)},
        ${mensagemLimpa}
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
// 2. ROTA PARA O PAINEL ADMIN (Listar os chamados)
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

// =========================================================================
// 3. ROTA PARA O PAINEL ADMIN (Responder: aviso no app + e-mail)
// =========================================================================
router.put('/admin/chamados/:id/responder', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'Chamado inválido.' });

    const resposta = String(req.body?.resposta || '').trim().slice(0, 1500);
    if (!resposta) return res.status(400).json({ erro: 'A resposta é obrigatória.' });

    const atualizado = await sql`
      UPDATE suporte_tickets
      SET resposta_admin = ${resposta},
          status = 'respondido',
          respondido_em = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *;
    `;

    if (!atualizado.length) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    const ticket = atualizado[0];
    const ehMotorista = String(ticket.tipo_usuario || '').toLowerCase() === 'motorista';

    // ---------- 1) Aviso na hora, só para quem abriu o chamado ----------
    let avisadoNoApp = false;
    try {
      const io = req.app.get('io') || req.io;
      if (io) {
        const payload = {
          ticketId: ticket.id,
          pedidoId: ticket.pedido_id || null,
          resposta,
          data: Date.now()
        };
        let destino = io.to(salaUsuario(String(ticket.usuario_id)));
        if (ehMotorista) destino = destino.to(salaMotorista(String(ticket.usuario_id)));
        destino.emit('resposta_suporte_admin', payload);
        avisadoNoApp = true;
      }
    } catch (e) {}

    // ---------- 2) E-mail (para quem está com o app fechado) ----------
    let emailDestino = null;
    if (ehMotorista) {
      const mot = await sql`
        SELECT email FROM motoristas
        WHERE id::text = ${String(ticket.usuario_id)} OR usuario_id::text = ${String(ticket.usuario_id)}
        LIMIT 1;
      `;
      if (mot.length) emailDestino = mot[0].email;
    } else {
      const cli = await sql`SELECT email FROM usuarios WHERE id::text = ${String(ticket.usuario_id)} LIMIT 1;`;
      if (cli.length) emailDestino = cli[0].email;
    }

    let enviadoPorEmail = false;
    if (emailDestino) {
      const nome = escaparHTML(String(ticket.usuario_nome || '').split(' ')[0] || 'tudo bem');
      const viagem = ticket.pedido_id ? ` sobre a viagem <strong>#${escaparHTML(String(ticket.pedido_id).slice(-6))}</strong>` : '';
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#0B0F19;padding:24px;">
          <div style="max-width:520px;margin:0 auto;background:#111827;border-radius:16px;padding:26px;color:#E5E7EB;">
            <div style="font-size:24px;font-weight:900;color:#FFFFFF;margin-bottom:14px;">HUB<span style="color:#10B981;">y</span> <span style="font-size:14px;color:#9CA3AF;font-weight:700;">Suporte</span></div>
            <p style="margin:0 0 10px;font-size:15px;">Olá, ${nome}!</p>
            <p style="margin:0 0 14px;font-size:14px;color:#9CA3AF;">A equipe HUBy respondeu ao seu chamado #${Number(ticket.id)}${viagem}:</p>
            <div style="background:#0B0F19;border-left:4px solid #10B981;border-radius:8px;padding:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;color:#E5E7EB;">${escaparHTML(resposta)}</div>
            <p style="margin:16px 0 0;font-size:12px;color:#9CA3AF;">Se precisar de mais ajuda, abra um novo chamado pelo aplicativo.</p>
          </div>
        </div>`;
      const texto = `Olá!\n\nA equipe HUBy respondeu ao seu chamado #${ticket.id}:\n\n${resposta}\n\nSe precisar de mais ajuda, abra um novo chamado pelo aplicativo.`;

      const envio = await enviarEmail({
        para: emailDestino,
        assunto: `Resposta do Suporte HUBy (chamado #${ticket.id})`,
        texto,
        html
      });
      enviadoPorEmail = envio.enviado;
      if (!envio.enviado) {
        console.warn(`[suporte] E-mail do chamado #${ticket.id} não foi enviado:`, envio.motivo);
      }
    }

    res.json({ sucesso: true, ticket, avisadoNoApp, enviadoPorEmail });
  } catch (err) {
    console.error('Erro ao responder chamado:', err);
    res.status(500).json({ erro: 'Falha ao responder chamado.' });
  }
});

export default router;