// routes/auth.routes.js - Cadastro, Login e Perfil HUBy
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// Motorista novo fica "pendente" até a administração aprovar (aba de triagem do painel).
// Para testes, defina APROVACAO_AUTOMATICA_MOTORISTA=true no ambiente.
const APROVACAO_AUTOMATICA = process.env.APROVACAO_AUTOMATICA_MOTORISTA === 'true';

const MSG_CREDENCIAIS = 'Credenciais inválidas.';

// ============================================================================
// VALIDAÇÕES
// ============================================================================
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

// Placa antiga (ABC1234) ou Mercosul (ABC1D23)
function validarPlaca(placa) {
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa);
}

function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 150;
}

// Foto em base64 (data:image/...). Rejeita lixo e imagens "de mentira".
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

// Se o motorista ainda não pode trabalhar, devolve a mensagem; senão, null.
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

// ============================================================================
// CADASTRO
// ============================================================================
const processarCadastro = async (req, res) => {
  try {
    const {
      nome, email, telefone, cpf, senha, role,
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      doc_cnh_url, doc_crlv_url
    } = req.body;

    const tipoConta = role === 'motorista' ? 'motorista' : 'cliente';

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, Senha e Contato).' });
    }

    const nomeLimpo = String(nome).trim();
    if (nomeLimpo.length < 2 || nomeLimpo.length > 150) {
      return res.status(400).json({ erro: 'Informe um nome válido.' });
    }

    const senhaTexto = String(senha);
    if (senhaTexto.length < 6 || senhaTexto.length > 72) {
      return res.status(400).json({ erro: 'A palavra-passe deve ter entre 6 e 72 caracteres.' });
    }

    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    if (emailLimpo && !validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'E-mail inválido.' });
    }

    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    if (telLimpo && (telLimpo.length < 10 || telLimpo.length > 13)) {
      return res.status(400).json({ erro: 'Telefone inválido.' });
    }

    // CPF é obrigatório (também é usado para gerar Pix)
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : '';
    if (!cpfLimpo || !validarNumeroCPF(cpfLimpo)) {
      return res.status(400).json({ erro: 'Número de CPF inválido.' });
    }

    if (dataNascimento && calcularIdade(dataNascimento) < 18) {
      return res.status(400).json({ erro: 'Cadastro negado: É obrigatório ser maior de 18 anos.' });
    }

    const dataNascSql = dataNascimento ? String(dataNascimento).slice(0, 10) : null;
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senhaTexto, salt);

    // ------------------------------------------------------------------
    // MOTORISTA
    // ------------------------------------------------------------------
    if (tipoConta === 'motorista') {
      const cnhLimpa = String(cnh || '').replace(/\D/g, '');
      if (!validarNumeroCNH(cnhLimpa)) {
        return res.status(400).json({ erro: 'Informe um número de CNH válido com 11 dígitos.' });
      }

      if (!veiculo_placa || !veiculo_modelo) {
        return res.status(400).json({ erro: 'Preencha o modelo e a placa do veículo.' });
      }

      const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      if (!validarPlaca(placaLimpa)) {
        return res.status(400).json({ erro: 'Placa inválida. Use o formato ABC1D23.' });
      }

      // Documentos reais são obrigatórios (até ~1,5 MB cada)
      if (!validarFoto(doc_cnh_url, 2_000_000) || !validarFoto(doc_crlv_url, 2_000_000)) {
        return res.status(400).json({ erro: 'Envie a fotografia da CNH e do CRLV para continuar.' });
      }

      const modeloLimpo = String(veiculo_modelo).trim().slice(0, 100);
      const corLimpa = veiculo_cor ? String(veiculo_cor).trim().slice(0, 30) : 'Não informada';
      const anoLimpo = veiculo_ano ? String(veiculo_ano).trim().slice(0, 4) : '2022';
      const catFinal = String(categoria || categoria_veiculo || 'carro').slice(0, 30);
      const idMotorista = novoId('mot');
      const statusInicial = APROVACAO_AUTOMATICA ? 'aprovado' : 'pendente';

      // 1) conta unificada de login
      await sql`
        INSERT INTO usuarios (id, nome, email, telefone, cpf, data_nascimento, senha_hash, role)
        VALUES (${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql}, ${senhaHash}, 'motorista');
      `;

      // 2) registro do motorista (se falhar, desfaz a conta para não ficar pela metade)
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
          mensagem: 'Cadastro enviado para análise! Avisaremos quando for aprovado e você poderá entrar com o seu e-mail, CNH, placa e palavra-passe.'
        });
      }

      return res.status(201).json({
        sucesso: true,
        token: emitirTokenMotorista({ ...motoristaCriado, categoria: motoristaCriado.categoria }),
        usuario: { ...motoristaCriado, role: 'motorista' }
      });
    }

    // ------------------------------------------------------------------
    // PASSAGEIRO
    // ------------------------------------------------------------------
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
};

// ============================================================================
// LOGIN
// ============================================================================
const processarLogin = async (req, res) => {
  try {
    const identificador = req.body.identificador || req.body.emailOuTelefone || req.body.email;
    const senha = req.body.senha;
    const perfilDesejado = req.body.perfilDesejado || 'cliente';

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Indique os dados de acesso e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

    // --- Login de motorista pelo formulário comum (identificador + senha) ---
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

    // --- Login de passageiro / admin ---
    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
         OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
      LIMIT 1;
    `;

    if (!usuarios.length || !usuarios[0].senha_hash) {
      return res.status(401).json({ erro: MSG_CREDENCIAIS });
    }

    const usr = usuarios[0];
    if (!(await bcrypt.compare(String(senha), usr.senha_hash))) {
      return res.status(401).json({ erro: MSG_CREDENCIAIS });
    }

    // Motorista não pode "furar" a aprovação entrando pelo formulário de passageiro
    if (String(usr.role).toLowerCase() === 'motorista') {
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
      { id: usr.id, nome: usr.nome, email: usr.email, role: usr.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: { id: usr.id, nome: usr.nome, email: usr.email, telefone: usr.telefone, role: usr.role }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
  }
};

router.post('/cadastro', processarCadastro);
router.post('/login', processarLogin);

// LOGIN DO MOTORISTA: e-mail + CNH + placa + palavra-passe
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

    // Contas antigas sem senha (só as criadas por scripts de teste) ainda entram;
    // todo cadastro novo tem senha e ela é obrigatória.
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
        veiculo_modelo: mot.veiculo_modelo,
        veiculo_placa: mot.veiculo_placa,
        veiculo_cor: mot.veiculo_cor,
        veiculo_ano: mot.veiculo_ano,
        saldo: mot.saldo_carteira
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais do veículo.' });
  }
});

// ============================================================================
// PERFIL
// ============================================================================
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
    if (nomeLimpo !== null && (nomeLimpo.length < 2 || nomeLimpo.length > 150)) {
      return res.status(400).json({ erro: 'Informe um nome válido.' });
    }

    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    if (emailLimpo && !validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'E-mail inválido.' });
    }

    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    if (telLimpo && (telLimpo.length < 10 || telLimpo.length > 13)) {
      return res.status(400).json({ erro: 'Telefone inválido.' });
    }

    // Foto de perfil (já reduzida pelo app): até ~700 mil caracteres
    let foto = null;
    if (foto_url) {
      if (!validarFoto(foto_url, 700_000)) {
        return res.status(400).json({ erro: 'Foto inválida ou muito grande.' });
      }
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

      // Mantém a conta de login igual ao cadastro do motorista
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

    res.json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso!', usuario: atualizado[0] });
  } catch (err) {
    console.error('ERRO AO ATUALIZAR PERFIL:', err);
    if (erroDeDuplicidade(err)) {
      return res.status(409).json({ erro: 'Este e-mail ou telefone já está em uso.' });
    }
    res.status(500).json({ erro: 'Erro ao salvar alterações.' });
  }
});

export default router;