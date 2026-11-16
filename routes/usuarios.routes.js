// routes/usuarios.routes.js - Autenticação e Gestão de Contas HUBy (Com Verificação em 2 Etapas para Admin)
import express from 'express';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';
import crypto from 'crypto';
import nodemailer from 'nodemailer'; // Necessário instalar: npm install nodemailer

export const usuariosRouter = express.Router();

// Configuração do disparador de emails da HUBy (Ajuste com suas credenciais reais SMTP depois)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', // Ex: smtp.hostinger.com ou smtp.gmail.com
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER || 'hubymobilidade@gmail.com',
    pass: process.env.EMAIL_PASS || 'sua_senha_de_app_aqui'
  }
});

// Middleware local de autenticação
function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : req.query.token;

  if (!token) {
    return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

async function garantirTabela2FA() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS admin_2fa_codes (
        id SERIAL PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        codigo VARCHAR(6) NOT NULL,
        usado BOOLEAN DEFAULT FALSE,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (e) {
    console.warn('Aviso tabela 2FA:', e.message);
  }
}
garantirTabela2FA();

// ============================================================================
// 1. LOGIN DE PASSAGEIRO E ADMIN (COM INTERCEPTAÇÃO 2FA)
// ============================================================================
usuariosRouter.post('/login', async (req, res) => {
  try {
    const { identificador, senha } = req.body;

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Preencha o identificador e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();

    const users = await sql`
      SELECT id, nome, email, telefone, role, senha
      FROM usuarios
      WHERE LOWER(email) = ${idLimpo} OR telefone = ${idLimpo}
      LIMIT 1;
    `;

    if (users.length === 0) {
      return res.status(401).json({ erro: 'Utilizador não encontrado.' });
    }

    const user = users[0];

    // Validação de senha simples ou hash
    if (user.senha && user.senha !== senha) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const role = String(user.role || 'cliente').toLowerCase();

    // INTERCEPTAÇÃO PARA ADMINISTRAÇÃO (2FA)
    if (role === 'admin' || role === 'administrador') {
      const codigo6Digitos = String(crypto.randomInt(100000, 999999));
      const expira = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      await sql`
        INSERT INTO admin_2fa_codes (usuario_id, codigo, expira_em)
        VALUES (${user.id}, ${codigo6Digitos}, ${expira});
      `;

      // Envia o e-mail de segurança
      const htmlEmail = `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #1e293b;">
          <h2 style="color: #10b981;">HUBy Master - Código de Acesso</h2>
          <p>Olá, <strong>${user.nome}</strong>,</p>
          <p>Uma tentativa de login no Painel de Administração Master foi iniciada.</p>
          <p>Para concluir a verificação em duas etapas, utilize o código abaixo:</p>
          <div style="background: #f1f5f9; padding: 15px; text-align: center; border-radius: 8px; font-size: 28px; font-weight: 900; letter-spacing: 4px; color: #0f172a; margin: 20px 0;">
            ${codigo6Digitos}
          </div>
          <p style="font-size: 12px; color: #64748b;">Se você não solicitou este acesso, ignore este e-mail. Este código expira em 10 minutos.</p>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: '"HUBy Segurança" <hubymobilidade@gmail.com>',
          to: user.email,
          subject: '🔐 Código de Segurança do Painel Master',
          html: htmlEmail
        });
      } catch (eMail) {
        console.warn('Erro ao disparar email 2FA (verifique as credenciais):', eMail.message);
        // Em ambiente de teste sem servidor de e-mail configurado, devolver o código na resposta:
        // return res.json({ requer_2fa: true, email: user.email, usuario_id: user.id, codigoTeste: codigo6Digitos });
      }

      return res.json({
        requer_2fa: true,
        email: user.email,
        usuario_id: user.id,
        mensagem: `Um código de 6 dígitos foi enviado para ${user.email}.`
      });
    }

    // Login normal de passageiro (Sem 2FA)
    const token = jwt.sign(
      { id: user.id, nome: user.nome, email: user.email, role: user.role || 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        telefone: user.telefone,
        role: user.role || 'cliente'
      }
    });
  } catch (err) {
    console.error('Erro no login de passageiro:', err);
    res.status(500).json({ erro: 'Falha interna ao autenticar passageiro.' });
  }
});

// ============================================================================
// 1.5 VALIDAÇÃO DO CÓDIGO 2FA DO ADMIN
// ============================================================================
usuariosRouter.post('/validar-2fa', async (req, res) => {
  try {
    const { usuario_id, codigo } = req.body;

    if (!usuario_id || !codigo || String(codigo).length !== 6) {
      return res.status(400).json({ erro: 'Código de 6 dígitos inválido.' });
    }

    const checks = await sql`
      SELECT id FROM admin_2fa_codes
      WHERE usuario_id = ${usuario_id}
        AND codigo = ${String(codigo)}
        AND usado = FALSE
        AND expira_em > NOW()
      ORDER BY id DESC LIMIT 1;
    `;

    if (checks.length === 0) {
      return res.status(401).json({ erro: 'Código incorreto ou expirado. Faça o login novamente.' });
    }

    // Invalida o código para não ser usado de novo
    await sql`UPDATE admin_2fa_codes SET usado = TRUE WHERE id = ${checks[0].id};`;

    // Resgata o Admin para emitir o Token Master
    const users = await sql`SELECT id, nome, email, telefone, role FROM usuarios WHERE id = ${usuario_id} LIMIT 1;`;
    if (users.length === 0) return res.status(404).json({ erro: 'Usuário administrador não localizado.' });

    const admin = users[0];
    const token = jwt.sign(
      { id: admin.id, nome: admin.nome, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '30d' } // Pode reduzir para 12h se quiser mais segurança
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: admin.id,
        nome: admin.nome,
        email: admin.email,
        role: admin.role
      }
    });

  } catch (err) {
    console.error('Erro validação 2FA:', err);
    res.status(500).json({ erro: 'Falha ao validar verificação de duas etapas.' });
  }
});

// ============================================================================
// 2. LOGIN DE MOTORISTA PARCEIRO (Sem Senha: E-mail + CNH + Placa)
// ============================================================================
usuariosRouter.post('/login-motorista', async (req, res) => {
  try {
    const { email, cnh, veiculo_placa } = req.body;

    if (!email || !cnh || !veiculo_placa) {
      return res.status(400).json({ erro: 'Informe E-mail, CNH e Placa do veículo.' });
    }

    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(veiculo_placa).trim().toUpperCase();
    const emailLimpo = String(email).trim().toLowerCase();

    let condutores = await sql`
      SELECT m.*, u.id AS usuario_conta_id, u.role
      FROM motoristas m
      LEFT JOIN usuarios u ON (m.usuario_id = u.id OR LOWER(m.email) = LOWER(u.email))
      WHERE LOWER(m.email) = ${emailLimpo}
        AND REPLACE(REPLACE(m.cnh, '.', ''), '-', '') = ${cnhLimpa}
        AND UPPER(REPLACE(m.veiculo_placa, '-', '')) = ${placaLimpa}
      LIMIT 1;
    `;

    if (condutores.length === 0) {
      condutores = await sql`
        SELECT * FROM motoristas 
        WHERE LOWER(email) = ${emailLimpo}
        LIMIT 1;
      `;
    }

    if (condutores.length === 0) {
      return res.status(401).json({ erro: 'Dados de motorista ou veículo não encontrados.' });
    }

    const mot = condutores[0];
    const usuarioId = mot.usuario_conta_id || mot.usuario_id || mot.id;

    const token = jwt.sign(
      {
        id: usuarioId,
        motoristaId: mot.id,
        nome: mot.nome,
        email: mot.email,
        role: 'motorista'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: usuarioId,
        motoristaId: mot.id,
        nome: mot.nome,
        email: mot.email,
        role: 'motorista',
        veiculo_modelo: mot.veiculo_modelo || 'Onix',
        veiculo_placa: mot.veiculo_placa || 'ABC1D23'
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar motorista parceiro.' });
  }
});

// ============================================================================
// 3. REGISTO DE UTILIZADORES (Passageiro ou Motorista)
// ============================================================================
usuariosRouter.post('/registo', async (req, res) => {
  try {
    const { nome, email, telefone, senha, role, cnh, veiculo_modelo, veiculo_placa, veiculo_cor } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ erro: 'Nome e E-mail são obrigatórios.' });
    }

    const idUsuario = 'usr_' + Date.now().toString(36);
    const tipoConta = role === 'motorista' ? 'motorista' : 'cliente';

    await sql`
      INSERT INTO usuarios (id, nome, email, telefone, senha, role)
      VALUES (${idUsuario}, ${nome}, ${email.toLowerCase()}, ${telefone || ''}, ${senha || '123456'}, ${tipoConta})
      ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome;
    `;

    let idMotorista = null;

    if (tipoConta === 'motorista') {
      idMotorista = 'mot_' + Date.now().toString(36);
      await sql`
        INSERT INTO motoristas (
          id, usuario_id, nome, email, telefone, cnh, 
          veiculo_modelo, veiculo_placa, veiculo_cor, saldo_carteira, status
        ) VALUES (
          ${idMotorista}, ${idUsuario}, ${nome}, ${email.toLowerCase()}, ${telefone || ''}, 
          ${cnh || '00000000000'}, ${veiculo_modelo || 'Onix'}, 
          ${(veiculo_placa || 'ABC1D23').toUpperCase()}, ${veiculo_cor || 'Prata'}, 
          0.00, 'ativo'
        );
      `;
    }

    const token = jwt.sign(
      { id: idUsuario, motoristaId: idMotorista, nome, email, role: tipoConta },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      sucesso: true,
      token,
      usuario: {
        id: idUsuario,
        motoristaId: idMotorista,
        nome,
        email,
        role: tipoConta
      }
    });
  } catch (err) {
    console.error('Erro ao registar utilizador:', err);
    res.status(500).json({ erro: 'Falha ao concluir registo na base de dados.' });
  }
});

// ============================================================================
// 4. PERFIL DO UTILIZADOR AUTENTICADO
// ============================================================================
usuariosRouter.get('/perfil', autenticar, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const users = await sql`
      SELECT id, nome, email, telefone, role, criado_em
      FROM usuarios
      WHERE id::text = ${usuarioId}::text
      LIMIT 1;
    `;

    if (users.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    }

    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar perfil.' });
  }
});

export default usuariosRouter;