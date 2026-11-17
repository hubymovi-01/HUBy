// routes/suporte.routes.js - Sistema de Tickets e Ajuda HUBy
import express from 'express';
import nodemailer from 'nodemailer';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// =========================================================================
// CONFIGURAÇÃO DO DISPARADOR DE E-MAIL (NODEMAILER)
// =========================================================================
// Utilize as mesmas credenciais que já usa no sistema de 2FA do admin
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', // Exemplo com Gmail
  port: 465,
  secure: true,
  auth: {
    user: 'seu-email-da-huby@gmail.com', // Coloque o e-mail oficial da HUBy
    pass: 'sua-senha-de-app-aqui'        // Coloque a Senha de Aplicação (App Password)
  }
});

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

// =========================================================================
// 1. ROTA PARA O APP (Passageiro ou Motorista abrindo um chamado)
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
// 3. ROTA PARA O PAINEL ADMIN (Responder e disparar e-mail)
// =========================================================================
router.put('/admin/chamados/:id/responder', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { resposta } = req.body;

    if (!resposta) return res.status(400).json({ erro: 'A resposta é obrigatória.' });

    // Salva a resposta no banco de dados e muda o status
    const atualizado = await sql`
      UPDATE suporte_tickets
      SET resposta_admin = ${String(resposta).slice(0, 1500)},
          status = 'respondido',
          respondido_em = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *;
    `;

    if (!atualizado.length) return res.status(404).json({ erro: 'Chamado não encontrado.' });
    const ticket = atualizado[0];

    // Busca o E-mail do utilizador no banco (Motorista ou Passageiro)
    let emailDestino = null;
    if (ticket.tipo_usuario === 'motorista') {
      const mot = await sql`SELECT email FROM motoristas WHERE id::text = ${ticket.usuario_id} OR usuario_id::text = ${ticket.usuario_id} LIMIT 1`;
      if (mot.length) emailDestino = mot[0].email;
    } else {
      const cli = await sql`SELECT email FROM usuarios WHERE id::text = ${ticket.usuario_id} LIMIT 1`;
      if (cli.length) emailDestino = cli[0].email;
    }

    // Dispara o e-mail de notificação se o endereço existir
    if (emailDestino) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #E2E8F0; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #0B0F19; padding: 20px; text-align: center;">
            <h2 style="color: #10B981; margin: 0;">Equipa de Suporte HUBy</h2>
          </div>
          <div style="padding: 20px; color: #333;">
            <p>Olá, <strong>${ticket.usuario_nome}</strong>!</p>
            <p>A nossa equipa analisou o seu relato${ticket.pedido_id ? ' referente à viagem <strong>#' + String(ticket.pedido_id).slice(-6) + '</strong>' : ''}.</p>
            
            <div style="background-color: #F8FAFC; border-left: 4px solid #38BDF8; padding: 15px; margin: 20px 0; border-radius: 4px;">
              <h4 style="margin-top: 0; color: #0F172A;">Resposta da Central:</h4>
              <p style="margin-bottom: 0; white-space: pre-wrap; font-size: 15px;">${resposta}</p>
            </div>
            
            <p style="font-size: 13px; color: #64748B;">Se precisar de mais ajuda, pode relatar novamente pelo aplicativo.</p>
          </div>
        </div>
      `;

      // Envio não bloqueante (em background)
      transporter.sendMail({
        from: '"Suporte HUBy" <seu-email-da-huby@gmail.com>',
        to: emailDestino,
        subject: `Retorno do Suporte HUBy (Ticket #${ticket.id})`,
        html: emailHtml
      }).catch(err => console.warn('Aviso: Falha ao enviar e-mail de suporte (verifique as credenciais SMTP):', err));
    }

    res.json({ sucesso: true, ticket });
  } catch (err) {
    console.error('Erro ao responder chamado:', err);
    res.status(500).json({ erro: 'Falha ao responder chamado.' });
  }
});

export default router;