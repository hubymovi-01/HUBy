// routes/auth.routes.js - Cadastro, Login e Perfil HUBy (Padronizado)
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

const APROVACAO_AUTOMATICA = process.env.APROVACAO_AUTOMATICA_MOTORISTA === 'true';
const MSG_CREDENCIAIS = 'Credenciais inválidas.';

function validarNumeroCPF(cpf) {
  cpf = String(cpf).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i), 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9), 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i), 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf.charAt(10), 10);
}

function validarNumeroCNH(cnh) {
  return String(cnh).replace(/\D/g, '').length === 11;
}

function validarPlaca(placa) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa);
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 150;
}

function validarFoto(url, maxCaracteres) {
  if (typeof url !== 'string') return false;
  const m = url.match(/^data:image\/(jpeg|png|webp);base64,/);
  if (!m) return false;
  const corpo = url.slice(m[0].length);
  return corpo.length >= 500 && corpo.length <= maxCaracteres && /^[A-Za-z0-9+/=]+$/.test(corpo);
}

function calcularIdade(dataNascStr) {
  if (!dataNascStr) return 0;
  const hoje = new Date();
  const nasc = new Date(dataNascStr);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function novoId(prefixo) {
  return `${prefixo}_${crypto.randomBytes(8).toString('hex')}`;
}

function erroDeDuplicidade(err) {
  return err?.code === '23505' || /unique|duplicate/i.test(err?.message || '');
}

function extrairRoleLimpa(usr) {
  const bruto = String(usr?.role || usr?.['função'] || usr?.funcao || 'cliente').trim().toLowerCase();
  if (bruto === 'administrador') return 'admin';
  return bruto;
}

function bloqueioDeAprovacao(mot) {
  const s = mot?.status_aprovacao;
  if (!s || s === 'aprovado') return null;
  if (s === 'pendente') {
    return 'Seu cadastro está em análise. Você poderá entrar assim que a administração aprovar.';
  }
  if (s === 'recusado') {
    return `Cadastro recusado${mot.motivo_recusa ? `: ${mot.motivo_recusa}` : '.'}`;
  }
  return 'Cadastro indisponível. Fale com a administração.';
}

function emitirTokenMotorista(mot) {
  return jwt.sign(
    { id: mot.id, nome: mot.nome, role: 'motorista', categoria: mot.categoria },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// CADASTRO
router.post('/cadastro', async (req, res) => {
  try {
    const {
      nome, email, telefone, cpf, senha, role,
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      doc_cnh_url, doc_crlv_url
    } = req.body;

    const papelDesejado = role === 'motorista' ? 'motorista' : 'cliente';

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, Senha e Contato).' });
    }

    const nomeLimpo = String(nome).trim();
    const senhaTexto = String(senha);
    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : '';

    if (!cpfLimpo || !validarNumeroCPF(cpfLimpo)) {
      return res.status(400).json({ erro: 'Número de CPF inválido.' });
    }

    const dataNascSql = dataNascimento ? String(dataNascimento).slice(0, 10) : null;
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senhaTexto, salt);

    if (papelDesejado === 'motorista') {
      const cnhLimpa = String(cnh || '').replace(/\D/g, '');
      if (!validarNumeroCNH(cnhLimpa)) {
        return res.status(400).json({ erro: 'Informe um número de CNH válido com 11 dígitos.' });
      }

      const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const modeloLimpo = String(veiculo_modelo).trim().slice(0, 100);
      const corLimpa = veiculo_cor ? String(veiculo_cor).trim().slice(0, 30) : 'Não informada';
      const anoLimpo = veiculo_ano ? String(veiculo_ano).trim().slice(0, 4) : '2022';
      const catFinal = String(categoria || categoria_veiculo || 'carro').slice(0, 30);
      const idMotorista = novoId('mot');
      const statusInicial = APROVACAO_AUTOMATICA ? 'aprovado' : 'pendente';

      await sql`
        INSERT INTO usuarios (id, nome, email, telefone, cpf, data_nascimento, senha_hash, role)
        VALUES (${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql}, ${senhaHash}, 'motorista');
      `;

      let motoristaCriado;
      try {
        const resultado = await sql`
          INSERT INTO motoristas (
            id, usuario_id, nome, email, telefone, cpf, data_nascimento, senha_hash,
            cnh_numero, categoria, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
            saldo_carteira, status_aprovacao, avaliacao_media, total_corridas,
            doc_cnh_url, doc_crlv_url
          ) VALUES (
            ${idMotorista}, ${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
            ${dataNascSql}, ${senhaHash},
            ${cnhLimpa}, ${catFinal}, ${modeloLimpo}, ${placaLimpa}, ${corLimpa}, ${anoLimpo},
            0.00, ${statusInicial}, 5.00, 0,
            ${doc_cnh_url}, ${doc_crlv_url}
          )
          RETURNING id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, categoria;
        `;
        motoristaCriado = resultado[0];
      } catch (erroMotorista) {
        await sql`DELETE FROM usuarios WHERE id = ${idMotorista};`;
        throw erroMotorista;
      }

      if (!APROVACAO_AUTOMATICA) {
        return res.status(201).json({
          sucesso: true,
          pendente: true,
          mensagem: 'Cadastro enviado para análise!'
        });
      }

      return res.status(201).json({
        sucesso: true,
        token: emitirTokenMotorista(motoristaCriado),
        usuario: { ...motoristaCriado, role: 'motorista' }
      });
    }

    const idUsuario = novoId('usr');
    const resultado = await sql`
      INSERT INTO usuarios (
        id, nome, email, telefone, cpf, data_nascimento,
        contato_emergencia_nome, contato_emergencia_tel,
        senha_hash, role
      ) VALUES (
        ${idUsuario}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
        ${dataNascSql},
        ${contatoEmergenciaNome ? String(contatoEmergenciaNome).trim().slice(0, 150) : null},
        ${contatoEmergenciaTelefone ? String(contatoEmergenciaTelefone).trim().slice(0, 25) : null},
        ${senhaHash}, 'cliente'
      )
      RETURNING id, nome, email, telefone, role;
    `;

    const criado = resultado[0];
    const token = jwt.sign(
      { id: criado.id, nome: criado.nome, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ sucesso: true, token, usuario: criado });
  } catch (err) {
    console.error('ERRO NO CADASTRO:', err);
    if (erroDeDuplicidade(err)) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está registrado.' });
    }
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const identificador = req.body.identificador || req.body.emailOuTelefone || req.body.email;
    const senha = req.body.senha;
    const perfilDesejado = req.body.perfilDesejado || 'cliente';

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Indique os dados de acesso e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

    if (perfilDesejado === 'motorista') {
      const motoristas = await sql`
        SELECT * FROM motoristas
        WHERE LOWER(TRIM(email)) = ${idLimpo}
           OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cnh_numero IS NOT NULL AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
        LIMIT 1;
      `;

      if (!motoristas.length || !motoristas[0].senha_hash) {
        return res.status(401).json({ erro: MSG_CREDENCIAIS });
      }

      const mot = motoristas[0];
      if (!(await bcrypt.compare(String(senha), mot.senha_hash))) {
        return res.status(401).json({ erro: MSG_CREDENCIAIS });
      }

      const bloqueio = bloqueioDeAprovacao(mot);
      if (bloqueio) return res.status(403).json({ erro: bloqueio });

      await sql`UPDATE motoristas SET status_online = TRUE WHERE id = ${mot.id};`;

      return res.json({
        sucesso: true,
        token: emitirTokenMotorista(mot),
        usuario: {
          id: mot.id, nome: mot.nome, email: mot.email, telefone: mot.telefone,
          role: 'motorista', veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`, saldo: mot.saldo_carteira
        }
      });
    }

    // Prioriza contas de administrador quando houver múltiplos registros
    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
         OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
      ORDER BY 
        CASE 
          WHEN LOWER(TRIM(COALESCE(role, ''))) IN ('admin', 'administrador') THEN 1
          ELSE 2 
        END ASC
      LIMIT 1;
    `;

    if (!usuarios.length || !usuarios[0].senha_hash) {
      return res.status(401).json({ erro: MSG_CREDENCIAIS });
    }

    const usr = usuarios[0];
    if (!(await bcrypt.compare(String(senha), usr.senha_hash))) {
      return res.status(401).json({ erro: MSG_CREDENCIAIS });
    }

    const roleFinal = extrairRoleLimpa(usr);

    if (roleFinal === 'motorista') {
      const registro = await sql`
        SELECT id, nome, categoria, status_aprovacao, motivo_recusa
        FROM motoristas
        WHERE id::text = ${String(usr.id)}::text OR usuario_id::text = ${String(usr.id)}::text
        LIMIT 1;
      `;
      if (!registro.length) return res.status(401).json({ erro: MSG_CREDENCIAIS });

      const bloqueio = bloqueioDeAprovacao(registro[0]);
      if (bloqueio) return res.status(403).json({ erro: bloqueio });

      return res.json({
        sucesso: true,
        token: emitirTokenMotorista(registro[0]),
        usuario: { id: registro[0].id, nome: usr.nome, email: usr.email, telefone: usr.telefone, role: 'motorista' }
      });
    }

    const token = jwt.sign(
      { id: usr.id, nome: usr.nome, email: usr.email, role: roleFinal },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: usr.id,
        nome: usr.nome,
        email: usr.email,
        telefone: usr.telefone,
        role: roleFinal
      }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
  }
});

// LOGIN DO MOTORISTA
router.post('/login-motorista', async (req, res) => {
  try {
    const { email, cnh, veiculo_placa, senha } = req.body;
    if (!email || !cnh || !veiculo_placa || !senha) {
      return res.status(400).json({ erro: 'Preencha E-mail, CNH, Placa e Palavra-passe.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const motoristas = await sql`
      SELECT * FROM motoristas
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
        AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${cnhLimpa}
        AND UPPER(TRIM(veiculo_placa)) = ${placaLimpa}
      LIMIT 1;
    `;

    if (!motoristas.length) return res.status(401).json({ erro: MSG_CREDENCIAIS });

    const mot = motoristas[0];
    if (mot.senha_hash) {
      if (!(await bcrypt.compare(String(senha), mot.senha_hash))) {
        return res.status(401).json({ erro: MSG_CREDENCIAIS });
      }
    }

    const bloqueio = bloqueioDeAprovacao(mot);
    if (bloqueio) return res.status(403).json({ erro: bloqueio });

    await sql`UPDATE motoristas SET status_online = TRUE WHERE id = ${mot.id};`;

    res.json({
      sucesso: true,
      token: emitirTokenMotorista(mot),
      usuario: {
        id: mot.id,
        nome: mot.nome,
        email: mot.email,
        telefone: mot.telefone,
        role: 'motorista',
        veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`,
        saldo: mot.saldo_carteira
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais do veículo.' });
  }
});

// PERFIL
router.get('/perfil', autenticarToken, async (req, res) => {
  try {
    const idToken = String(req.usuario.id);
    const ehMotorista = String(req.usuario.role || '').toLowerCase() === 'motorista';

    const dados = ehMotorista
      ? await sql`
          SELECT id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
                 foto_perfil_url AS foto_url
          FROM motoristas
          WHERE id::text = ${idToken}::text OR usuario_id::text = ${idToken}::text
          LIMIT 1;
        `
      : await sql`
          SELECT id, nome, email, telefone, foto_perfil_url AS foto_url
          FROM usuarios
          WHERE id::text = ${idToken}::text
          LIMIT 1;
        `;

    if (!dados.length) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json(dados[0]);
  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    res.status(500).json({ erro: 'Falha ao carregar o perfil.' });
  }
});

router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const idToken = String(req.usuario.id);
    const ehMotorista = String(req.usuario.role || '').toLowerCase() === 'motorista';
    const { nome, email, telefone, foto_url } = req.body;

    const nomeLimpo = nome ? String(nome).trim() : null;
    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;

    let foto = null;
    if (foto_url && validarFoto(foto_url, 700_000)) {
      foto = foto_url;
    }

    let atualizado;
    if (ehMotorista) {
      atualizado = await sql`
        UPDATE motoristas
        SET nome = COALESCE(${nomeLimpo}, nome),
            email = COALESCE(${emailLimpo}, email),
            telefone = COALESCE(${telLimpo}, telefone),
            foto_perfil_url = COALESCE(${foto}, foto_perfil_url)
        WHERE id::text = ${idToken}::text OR usuario_id::text = ${idToken}::text
        RETURNING id, nome, email, telefone, veiculo_modelo, veiculo_placa, foto_perfil_url AS foto_url;
      `;

      await sql`
        UPDATE usuarios
        SET nome = COALESCE(${nomeLimpo}, nome),
            email = COALESCE(${emailLimpo}, email),
            telefone = COALESCE(${telLimpo}, telefone),
            foto_perfil_url = COALESCE(${foto}, foto_perfil_url)
        WHERE id::text = ${idToken}::text;
      `;
    } else {
      atualizado = await sql`
        UPDATE usuarios
        SET nome = COALESCE(${nomeLimpo}, nome),
            email = COALESCE(${emailLimpo}, email),
            telefone = COALESCE(${telLimpo}, telefone),
            foto_perfil_url = COALESCE(${foto}, foto_perfil_url)
        WHERE id::text = ${idToken}::text
        RETURNING id, nome, email, telefone, foto_perfil_url AS foto_url;
      `;
    }

    if (!atualizado.length) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json({ sucesso: true, mensagem: 'Perfil atualizado!', usuario: atualizado[0] });
  } catch (err) {
    console.error('ERRO AO ATUALIZAR PERFIL:', err);
    if (erroDeDuplicidade(err)) {
      return res.status(409).json({ erro: 'Este e-mail ou telefone já está em uso.' });
    }
    res.status(500).json({ erro: 'Erro ao salvar alterações.' });
  }
});

export default router;