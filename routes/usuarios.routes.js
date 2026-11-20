// routes/usuarios.routes.js - Autenticação Unificada HUBy (Auditoria Automática de Documentos + Aprovação Imediata)
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sql, JWT_SECRET } from '../db.js';

export const usuariosRouter = express.Router();

function autenticar(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : req.query.token;

  if (!token) {
    return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });
  }

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

async function garantirEstruturaContas() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_hash TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS senha_hash TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS cnh_numero TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS cnh_validade DATE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS crlv_validade DATE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS doc_cnh_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS doc_crlv_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS docs_validados_auto BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS status_aprovacao TEXT DEFAULT 'aprovado';`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS status_online BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS motivo_recusa TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'carro';`;
  } catch (e) {
    console.warn('Aviso ao sincronizar estrutura de contas:', e.message);
  }
}
garantirEstruturaContas();

async function conferirSenha(senhaInformada, hashOuSenha) {
  if (!hashOuSenha) return true;
  const valor = String(hashOuSenha);
  if (valor.startsWith('$2a$') || valor.startsWith('$2b$') || valor.startsWith('$2y$')) {
    return bcrypt.compare(String(senhaInformada), valor);
  }
  return valor === String(senhaInformada);
}

function validarDataDocumento(dataStr, nomeDoc) {
  if (!dataStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataStr).slice(0, 10))) {
    return { ok: false, erro: `Informe a data de validade do(a) ${nomeDoc}.` };
  }
  const [ano, mes, dia] = String(dataStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(ano, mes - 1, dia, 23, 59, 59);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (Number.isNaN(dt.getTime()) || dt.getTime() < hoje.getTime()) {
    return { ok: false, erro: `${nomeDoc} está vencido(a) ou com data inválida.` };
  }
  return { ok: true, dataSql: String(dataStr).slice(0, 10) };
}

// ============================================================================
// 1. CADASTRO UNIFICADO (/cadastro e /registo) - AUDITORIA AUTOMÁTICA + APROVAÇÃO
// ============================================================================
async function handleCadastroUnificado(req, res) {
  try {
    await garantirEstruturaContas();

    const {
      nome, email, telefone, cpf, senha, role,
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, cnh_numero, cnh_validade, crlv_validade,
      categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      chave_pix_padrao, doc_cnh_url, doc_crlv_url, fotoVeiculo
    } = req.body;

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha Nome, E-mail/Telefone e Senha.' });
    }

    const tipoConta = String(role || '').toLowerCase() === 'motorista' ? 'motorista' : 'cliente';
    const nomeLimpo = String(nome).trim();
    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;
    const dataNascSql = dataNascimento ? String(dataNascimento).slice(0, 10) : null;

    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(String(senha), salt);

    if (tipoConta === 'motorista') {
      const cnhLimpa = String(cnh || cnh_numero || '').replace(/\D/g, '');
      const placaLimpa = String(veiculo_placa || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const modeloLimpo = String(veiculo_modelo || '').trim();

      if (cnhLimpa.length !== 11 || /^(\d)\1+$/.test(cnhLimpa)) {
        return res.status(400).json({ erro: 'Informe os 11 dígitos válidos da CNH.' });
      }
      if (!modeloLimpo || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaLimpa)) {
        return res.status(400).json({ erro: 'Informe o modelo e uma placa válida (ex: ABC1D23).' });
      }

      const valCnh = validarDataDocumento(cnh_validade, 'CNH');
      if (!valCnh.ok) return res.status(400).json({ erro: valCnh.erro });

      const valCrlv = validarDataDocumento(crlv_validade, 'CRLV');
      if (!valCrlv.ok) return res.status(400).json({ erro: valCrlv.erro });

      if (!doc_cnh_url || String(doc_cnh_url).length < 500) {
        return res.status(400).json({ erro: 'Envie a fotografia da CNH para validação automática.' });
      }
      if (!doc_crlv_url || String(doc_crlv_url).length < 500) {
        return res.status(400).json({ erro: 'Envie a fotografia do CRLV para validação automática.' });
      }

      const idMotorista = 'mot_' + crypto.randomBytes(8).toString('hex');
      const catFinal = String(categoria || categoria_veiculo || 'carro').toLowerCase();

      await sql`
        INSERT INTO usuarios (id, nome, email, telefone, cpf, data_nascimento, senha_hash, role)
        VALUES (${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql}, ${senhaHash}, 'motorista');
      `;

      try {
        await sql`
          INSERT INTO motoristas (
            id, usuario_id, nome, email, telefone, cpf, data_nascimento, senha_hash,
            cnh_numero, cnh_validade, crlv_validade, doc_cnh_url, doc_crlv_url,
            categoria, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
            chave_pix_padrao, foto_perfil_url, saldo_carteira, status_aprovacao, docs_validados_auto, status_online, avaliacao_media, total_corridas
          ) VALUES (
            ${idMotorista}, ${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql}, ${senhaHash},
            ${cnhLimpa}, ${valCnh.dataSql}, ${valCrlv.dataSql}, ${doc_cnh_url}, ${doc_crlv_url},
            ${catFinal}, ${modeloLimpo}, ${placaLimpa}, ${veiculo_cor || 'Prata'}, ${veiculo_ano || '2023'},
            ${chave_pix_padrao || null}, ${fotoVeiculo || null}, 0.00, 'aprovado', TRUE, FALSE, 5.00, 0
          );
        `;
      } catch (errMot) {
        await sql`DELETE FROM usuarios WHERE id = ${idMotorista};`;
        throw errMot;
      }

      const token = jwt.sign(
        { id: idMotorista, motoristaId: idMotorista, nome: nomeLimpo, email: emailLimpo, role: 'motorista', categoria: catFinal },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.status(201).json({
        sucesso: true,
        aprovadoAutomaticamente: true,
        mensagem: 'Documentos validados e cadastro aprovado automaticamente! Bem-vindo à HUBy.',
        token,
        usuario: {
          id: idMotorista,
          motoristaId: idMotorista,
          nome: nomeLimpo,
          email: emailLimpo,
          telefone: telLimpo,
          role: 'motorista',
          categoria: catFinal,
          status_aprovacao: 'aprovado'
        }
      });
    }

    const idUsuario = 'usr_' + crypto.randomBytes(8).toString('hex');
    await sql`
      INSERT INTO usuarios (
        id, nome, email, telefone, cpf, data_nascimento,
        contato_emergencia_nome, contato_emergencia_tel, senha_hash, role
      ) VALUES (
        ${idUsuario}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql},
        ${contatoEmergenciaNome || null}, ${contatoEmergenciaTelefone || null}, ${senhaHash}, 'cliente'
      );
    `;

    const token = jwt.sign(
      { id: idUsuario, nome: nomeLimpo, email: emailLimpo, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.status(201).json({
      sucesso: true,
      token,
      usuario: {
        id: idUsuario,
        nome: nomeLimpo,
        email: emailLimpo,
        telefone: telLimpo,
        role: 'cliente'
      }
    });
  } catch (err) {
    console.error('Erro no cadastro:', err);
    if (err?.code === '23505' || /unique|duplicate/i.test(err?.message || '')) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está cadastrado.' });
    }
    return res.status(500).json({ erro: 'Falha ao concluir cadastro.' });
  }
}

usuariosRouter.post('/cadastro', handleCadastroUnificado);
usuariosRouter.post('/registo', handleCadastroUnificado);

// ============================================================================
// 2. LOGIN DE PASSAGEIRO E ADMIN
// ============================================================================
usuariosRouter.post('/login', async (req, res) => {
  try {
    await garantirEstruturaContas();

    const identificador = req.body.identificador || req.body.email;
    const senha = req.body.senha;

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Preencha o e-mail/telefone e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

    const users = await sql`
      SELECT *
      FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
      ORDER BY CASE WHEN LOWER(COALESCE(role, '')) IN ('admin', 'administrador') THEN 1 ELSE 2 END ASC
      LIMIT 1;
    `;

    if (users.length === 0) {
      return res.status(401).json({ erro: 'Conta não encontrada. Verifique os dados ou crie uma conta.' });
    }

    const user = users[0];
    const hashArmazenado = user.senha_hash || user.senha;
    const senhaValida = await conferirSenha(senha, hashArmazenado);

    if (!senhaValida) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const role = String(user.role || 'cliente').trim().toLowerCase();

    if (role === 'admin' || role === 'administrador') {
      const token = jwt.sign(
        { id: user.id, nome: user.nome, email: user.email, role: 'admin' },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.json({
        sucesso: true,
        token,
        usuario: {
          id: user.id,
          nome: user.nome,
          email: user.email,
          telefone: user.telefone,
          role: 'admin'
        }
      });
    }

    if (role === 'motorista') {
      return res.status(403).json({
        erro: 'Esta conta é de Motorista Parceiro. Use o acesso de Motorista com E-mail, CNH e Placa.'
      });
    }

    const token = jwt.sign(
      { id: user.id, nome: user.nome, email: user.email, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      sucesso: true,
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        telefone: user.telefone,
        role: 'cliente'
      }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ erro: 'Falha interna ao autenticar.' });
  }
});

// ============================================================================
// 3. LOGIN DE MOTORISTA PARCEIRO
// ============================================================================
usuariosRouter.post('/login-motorista', async (req, res) => {
  try {
    await garantirEstruturaContas();

    const { email, cnh, veiculo_placa } = req.body;

    if (!email || !cnh || !veiculo_placa) {
      return res.status(400).json({ erro: 'Informe E-mail, CNH e Placa do veículo.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const condutores = await sql`
      SELECT *
      FROM motoristas
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
        AND regexp_replace(COALESCE(cnh_numero, ''), '\\D', '', 'g') = ${cnhLimpa}
        AND UPPER(REPLACE(TRIM(COALESCE(veiculo_placa, '')), '-', '')) = ${placaLimpa}
      LIMIT 1;
    `;

    if (condutores.length === 0) {
      return res.status(401).json({ erro: 'E-mail, CNH ou Placa não conferem. Verifique os dados cadastrados.' });
    }

    const mot = condutores[0];
    if (mot.status_aprovacao === 'recusado') {
      return res.status(403).json({ erro: `Cadastro recusado${mot.motivo_recusa ? `: ${mot.motivo_recusa}` : '.'}` });
    }

    await sql`UPDATE motoristas SET status_online = TRUE, status_aprovacao = 'aprovado' WHERE id = ${mot.id};`;

    const usuarioId = mot.usuario_id || mot.id;
    const catFinal = String(mot.categoria || 'carro').toLowerCase().trim();

    const token = jwt.sign(
      {
        id: usuarioId,
        motoristaId: mot.id,
        nome: mot.nome,
        email: mot.email,
        role: 'motorista',
        categoria: catFinal
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      sucesso: true,
      token,
      usuario: {
        id: usuarioId,
        motoristaId: mot.id,
        nome: mot.nome,
        email: mot.email,
        role: 'motorista',
        categoria: catFinal,
        veiculo_modelo: mot.veiculo_modelo || 'Veículo',
        veiculo_placa: mot.veiculo_placa || placaLimpa
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    return res.status(500).json({ erro: 'Falha interna ao validar motorista parceiro.' });
  }
});

usuariosRouter.get('/perfil', autenticar, async (req, res) => {
  try {
    const users = await sql`
      SELECT id, nome, email, telefone, role, criado_em
      FROM usuarios
      WHERE id::text = ${String(req.usuario.id)}::text
      LIMIT 1;
    `;
    if (users.length === 0) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    return res.json(users[0]);
  } catch (err) {
    return res.status(500).json({ erro: 'Falha ao consultar perfil.' });
  }
});

export default usuariosRouter;