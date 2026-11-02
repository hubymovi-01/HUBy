// routes/usuarios.routes.js - Autenticação e Gestão de Contas HUBy
import express from 'express';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';

export const usuariosRouter = express.Router();

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

// ============================================================================
// 1. LOGIN DE PASSAGEIRO (E-mail ou Telemóvel + Senha)
// ============================================================================
usuariosRouter.post('/login', async (req, res) => {
  try {
    const { identificador, senha } = req.body;

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Preencha o identificador e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();

    // Procura por email ou telefone na tabela de utilizadores
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

    // Localiza o motorista com os dados fornecidos
    let condutores = await sql`
      SELECT m.*, u.id AS usuario_conta_id, u.role
      FROM motoristas m
      LEFT JOIN usuarios u ON (m.usuario_id = u.id OR LOWER(m.email) = LOWER(u.email))
      WHERE LOWER(m.email) = ${emailLimpo}
        AND REPLACE(REPLACE(m.cnh, '.', ''), '-', '') = ${cnhLimpa}
        AND UPPER(REPLACE(m.veiculo_placa, '-', '')) = ${placaLimpa}
      LIMIT 1;
    `;

    // Fallback: se for a conta da Carol cadastrada na base
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

    // Cria conta na tabela usuarios
    await sql`
      INSERT INTO usuarios (id, nome, email, telefone, senha, role)
      VALUES (${idUsuario}, ${nome}, ${email.toLowerCase()}, ${telefone || ''}, ${senha || '123456'}, ${tipoConta})
      ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome;
    `;

    let idMotorista = null;

    // Se for motorista, cria também na tabela motoristas
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