// routes/auth.routes.js - Cadastro, Login (passageiro e motorista com senha), OTP, LGPD e Perfil HUBy
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { registrarIndicacaoNoCadastro } from './indicacoes.routes.js';
import { enviarEmail, emailConfigurado } from '../services/email.service.js';
const router = express.Router();

const MSG_CREDENCIAIS = 'Credenciais inválidas.';
const SENHA_MIN = 8;
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
// Motorista novo entra como 'pendente'. Para aprovar automaticamente, crie no Render: APROVACAO_AUTOMATICA_MOTORISTA=true
const APROVACAO_AUTOMATICA = String(process.env.APROVACAO_AUTOMATICA_MOTORISTA || '').toLowerCase() === 'true';

async function garantirEstruturaAuthSeguranca() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS termos_aceitos_em TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS versao_termos VARCHAR(20) DEFAULT '1.0';`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone_verificado BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS indicado_por_codigo VARCHAR(20);`;

    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS termos_aceitos_em TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS versao_termos VARCHAR(20) DEFAULT '1.0';`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS telefone_verificado BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS cnh_validade DATE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS crlv_validade DATE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS indicado_por_codigo VARCHAR(20);`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS docs_validados_auto BOOLEAN DEFAULT FALSE;`;

    await sql`
      CREATE TABLE IF NOT EXISTS codigos_verificacao (
        id SERIAL PRIMARY KEY,
        telefone VARCHAR(25) NOT NULL,
        codigo VARCHAR(10) NOT NULL,
        verificado BOOLEAN DEFAULT FALSE,
        tentativas INT DEFAULT 0,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Aviso ao sincronizar colunas LGPD/OTP/Validade:', err.message);
  }
}
garantirEstruturaAuthSeguranca();

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
  const digits = String(cnh).replace(/\D/g, '');
  return digits.length === 11 && !/^(\d)\1+$/.test(digits);
}

function validarPlacaVeiculo(placa) {
  const limpa = String(placa || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(limpa);
}

function validarEmail(email) {
  return /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z]{2,}$/i.test(String(email || ''));
}

function validarSenha(senha) {
  const s = String(senha || '');
  if (s.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (s.length > 72) return 'A senha pode ter no máximo 72 caracteres.';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return 'A senha precisa ter letras e números.';
  return null;
}

function validarDataFuturaDocumento(dataStr, nomeDoc) {
  if (!dataStr || !/^\d{4}-\d{2}-\d{2}$/.test(String(dataStr).slice(0, 10))) {
    return { valida: false, erro: `Informe a data de validade do(a) ${nomeDoc}.` };
  }
  const [ano, mes, dia] = String(dataStr).slice(0, 10).split('-').map(Number);
  const dt = new Date(ano, mes - 1, dia, 23, 59, 59);
  if (Number.isNaN(dt.getTime())) {
    return { valida: false, erro: `Data de validade inválida para ${nomeDoc}.` };
  }
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (dt.getTime() < hoje.getTime()) {
    return { valida: false, erro: `${nomeDoc} está vencido(a). Renove o documento antes de cadastrar.` };
  }
  if (ano > hoje.getFullYear() + 15) {
    return { valida: false, erro: `Ano de validade inválido para ${nomeDoc}.` };
  }
  return { valida: true, dataSql: `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}` };
}

function validarFoto(url, maxCaracteres = 1_500_000) {
  if (typeof url !== 'string') return false;
  const m = url.match(/^data:image\/(jpeg|jpg|png|webp);base64,/i);
  if (!m) return false;
  const corpo = url.slice(m[0].length);
  return corpo.length >= 500 && corpo.length <= maxCaracteres && /^[A-Za-z0-9+/=]+$/.test(corpo);
}

function auditarDocumentacaoMotorista({
  cnh,
  cnh_validade,
  crlv_validade,
  veiculo_modelo,
  veiculo_placa,
  veiculo_ano,
  doc_cnh_url,
  doc_crlv_url
}) {
  const cnhLimpa = String(cnh || '').replace(/\D/g, '');
  if (!validarNumeroCNH(cnhLimpa)) {
    return { aprovado: false, erro: 'Número da CNH inválido. Informe os 11 dígitos corretamente.' };
  }

  const valCnh = validarDataFuturaDocumento(cnh_validade, 'CNH');
  if (!valCnh.valida) {
    return { aprovado: false, erro: valCnh.erro };
  }

  const valCrlv = validarDataFuturaDocumento(crlv_validade, 'CRLV (Licenciamento)');
  if (!valCrlv.valida) {
    return { aprovado: false, erro: valCrlv.erro };
  }

  const modeloLimpo = String(veiculo_modelo || '').trim();
  if (modeloLimpo.length < 2) {
    return { aprovado: false, erro: 'Informe o modelo completo do veículo.' };
  }

  const placaLimpa = String(veiculo_placa || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!validarPlacaVeiculo(placaLimpa)) {
    return { aprovado: false, erro: 'Placa do veículo inválida. Utilize o padrão Mercosul (ABC1D23) ou antigo (ABC1234).' };
  }

  const anoNum = parseInt(String(veiculo_ano || ''), 10);
  const anoAtual = new Date().getFullYear();
  if (veiculo_ano && (!Number.isFinite(anoNum) || anoNum < 1995 || anoNum > anoAtual + 1)) {
    return { aprovado: false, erro: `Ano do veículo inválido (deve ser entre 1995 e ${anoAtual + 1}).` };
  }

  if (!validarFoto(doc_cnh_url)) {
    return { aprovado: false, erro: 'Fotografia da CNH ausente ou ilegível. Envie uma foto nítida da CNH.' };
  }

  if (!validarFoto(doc_crlv_url)) {
    return { aprovado: false, erro: 'Fotografia do CRLV ausente ou ilegível. Envie uma foto nítida do documento do veículo.' };
  }

  return {
    aprovado: true,
    cnhLimpa,
    cnhValSql: valCnh.dataSql,
    crlvValSql: valCrlv.dataSql,
    modeloLimpo: modeloLimpo.slice(0, 100),
    placaLimpa,
    anoLimpo: Number.isFinite(anoNum) ? String(anoNum) : String(anoAtual)
  };
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

// Só "recusado" impede o login. "pendente" entra, mas não recebe corridas até ser aprovado.
function bloqueioDeAprovacao(mot) {
  const s = String(mot?.status_aprovacao || '').toLowerCase();
  if (s === 'recusado') {
    return `Cadastro recusado${mot.motivo_recusa ? `: ${mot.motivo_recusa}` : '.'}`;
  }
  if (s === 'bloqueado' || s === 'suspenso') {
    return 'Sua conta de motorista está suspensa. Fale com o suporte HUBy.';
  }
  return null;
}

function emitirTokenMotorista(mot) {
  return jwt.sign(
    { id: mot.id, motoristaId: mot.id, nome: mot.nome, role: 'motorista', categoria: mot.categoria || 'carro' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function respostaLoginMotorista(mot, nomeAlternativo) {
  const status = String(mot.status_aprovacao || 'pendente').toLowerCase();
  return {
    sucesso: true,
    token: emitirTokenMotorista(mot),
    usuario: {
      id: mot.id,
      motoristaId: mot.id,
      nome: mot.nome || nomeAlternativo,
      email: mot.email,
      telefone: mot.telefone,
      role: 'motorista',
      categoria: mot.categoria || 'carro',
      status_aprovacao: status
    },
    aviso: status === 'aprovado'
      ? undefined
      : 'Seu cadastro está em análise. Você poderá ficar online assim que for aprovado.'
  };
}

// Busca motorista por e-mail, telefone, CPF ou CNH e confere a senha (obrigatória)
async function autenticarMotorista(identificador, senha) {
  const idLimpo = String(identificador || '').trim().toLowerCase();
  const idNumeros = String(identificador || '').replace(/\D/g, '');

  if (!idLimpo || !senha) {
    return { erro: 'Informe seu e-mail (ou telefone/CPF) e a senha.', status: 400 };
  }

  const motoristas = await sql`
    SELECT * FROM motoristas
    WHERE LOWER(TRIM(email)) = ${idLimpo}
       OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
       OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
       OR (cnh_numero IS NOT NULL AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
    LIMIT 1;
  `;

  if (!motoristas.length) {
    return { erro: MSG_CREDENCIAIS, status: 401 };
  }

  const mot = motoristas[0];

  if (!mot.senha_hash) {
    return {
      erro: 'Sua conta de motorista ainda não tem senha. Fale com o suporte HUBy para criar uma.',
      status: 403
    };
  }

  if (!(await bcrypt.compare(String(senha), mot.senha_hash))) {
    return { erro: MSG_CREDENCIAIS, status: 401 };
  }

  const bloqueio = bloqueioDeAprovacao(mot);
  if (bloqueio) return { erro: bloqueio, status: 403 };

  return { mot };
}

// ============================================================================
// VERIFICAÇÃO DE TELEFONE POR CÓDIGO OTP (WHATSAPP / SMS)
// ============================================================================
async function despacharMensagemWhatsApp(telefoneNumeros, codigo) {
  const apiUrl = process.env.WHATSAPP_API_URL || '';
  const apiToken = process.env.WHATSAPP_API_TOKEN || '';
  const numeroComDDI = telefoneNumeros.startsWith('55') ? telefoneNumeros : `55${telefoneNumeros}`;

  if (!apiUrl || !apiToken) {
    return { enviadoReal: false };
  }

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`,
        'apikey': apiToken
      },
      body: JSON.stringify({
        number: numeroComDDI,
        phone: numeroComDDI,
        text: `🔐 *HUBy Mobilidade*\n\nSeu código de verificação é: *${codigo}*\n\nVálido por 5 minutos. Não compartilhe este código com ninguém.`
      })
    });
    return { enviadoReal: resp.ok };
  } catch (err) {
    console.warn('Falha ao enviar OTP via WhatsApp API:', err.message);
    return { enviadoReal: false };
  }
}

router.post('/enviar-codigo', async (req, res) => {
  try {
    const telLimpo = String(req.body?.telefone || '').replace(/\D/g, '');

    if (telLimpo.length < 10 || telLimpo.length > 13) {
      return res.status(400).json({ erro: 'Informe um número de WhatsApp/Telefone válido com DDD.' });
    }

    const recentes = await sql`
      SELECT COUNT(*)::int AS qtd FROM codigos_verificacao
      WHERE telefone = ${telLimpo}
        AND criado_em >= NOW() - INTERVAL '10 minutes';
    `;
    if (Number(recentes[0]?.qtd || 0) >= 4) {
      return res.status(429).json({ erro: 'Muitos códigos solicitados. Aguarde alguns minutos.' });
    }

    const codigo = String(crypto.randomInt(100000, 1000000));
    const expiraEm = new Date(Date.now() + 5 * 60 * 1000);

    await sql`
      INSERT INTO codigos_verificacao (telefone, codigo, verificado, expira_em)
      VALUES (${telLimpo}, ${codigo}, FALSE, ${expiraEm});
    `;

    const envio = await despacharMensagemWhatsApp(telLimpo, codigo);

    if (!envio.enviadoReal && EM_PRODUCAO) {
      // Em produção o código NUNCA volta na resposta (senão a verificação não vale nada)
      return res.status(503).json({ erro: 'Não foi possível enviar o código agora. Tente novamente em instantes.' });
    }

    return res.json({
      sucesso: true,
      enviadoViaWhatsApp: envio.enviadoReal,
      // Só em ambiente de teste (NODE_ENV diferente de production)
      codigoTeste: envio.enviadoReal ? undefined : codigo,
      mensagem: envio.enviadoReal
        ? 'Código de 6 dígitos enviado para o seu WhatsApp!'
        : `Modo de teste: seu código é ${codigo}`
    });
  } catch (err) {
    console.error('Erro ao gerar OTP:', err);
    res.status(500).json({ erro: 'Falha ao enviar código de verificação.' });
  }
});

router.post('/verificar-codigo', async (req, res) => {
  try {
    const telLimpo = String(req.body?.telefone || '').replace(/\D/g, '');
    const codigoInformado = String(req.body?.codigo || '').replace(/\D/g, '');

    if (!telLimpo || codigoInformado.length !== 6) {
      return res.status(400).json({ erro: 'Informe o código de 6 dígitos.' });
    }

    const registros = await sql`
      SELECT * FROM codigos_verificacao
      WHERE telefone = ${telLimpo}
        AND expira_em > NOW()
      ORDER BY id DESC
      LIMIT 1;
    `;

    if (!registros.length) {
      return res.status(400).json({ erro: 'Código expirado ou não solicitado. Peça um novo código.' });
    }

    const reg = registros[0];
    if (Number(reg.tentativas || 0) >= 5) {
      return res.status(429).json({ erro: 'Limite de tentativas excedido. Solicite um novo código.' });
    }

    const codigoOk = reg.codigo.length === codigoInformado.length
      && crypto.timingSafeEqual(Buffer.from(reg.codigo), Buffer.from(codigoInformado));

    if (!codigoOk) {
      await sql`UPDATE codigos_verificacao SET tentativas = tentativas + 1 WHERE id = ${reg.id};`;
      return res.status(400).json({ erro: 'Código incorreto. Verifique os 6 dígitos e tente novamente.' });
    }

    await sql`UPDATE codigos_verificacao SET verificado = TRUE WHERE id = ${reg.id};`;

    return res.json({
      sucesso: true,
      verificado: true,
      mensagem: 'Telefone verificado com sucesso!'
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao validar código de verificação.' });
  }
});

// ============================================================================
// CADASTRO (PASSAGEIRO OU MOTORISTA)
// Motorista: documentos conferidos automaticamente; aprovação final pelo admin
// (ou automática se APROVACAO_AUTOMATICA_MOTORISTA=true no Render).
// ============================================================================
async function handlerCadastro(req, res) {
  try {
    const {
      nome, email, telefone, cpf, senha, role,
      aceitouTermos, versaoTermos, codigoIndicacao,
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, cnh_numero, cnh_validade, crlv_validade,
      categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      doc_cnh_url, doc_crlv_url
    } = req.body || {};

    if (aceitouTermos !== true) {
      return res.status(400).json({ erro: 'Você precisa ler e aceitar os Termos de Uso e a Política de Privacidade.' });
    }

    const papelDesejado = role === 'motorista' ? 'motorista' : 'cliente';

    const nomeLimpo = String(nome || '').trim().slice(0, 120);
    const emailLimpo = email ? String(email).trim().toLowerCase().slice(0, 254) : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : '';
    const versaoFinalTermos = String(versaoTermos || '1.0').slice(0, 20);
    const codigoConviteLimpo = codigoIndicacao ? String(codigoIndicacao).trim().toUpperCase().slice(0, 20) : null;

    if (nomeLimpo.length < 3) {
      return res.status(400).json({ erro: 'Informe seu nome completo.' });
    }
    if (!emailLimpo || !validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (!telLimpo || telLimpo.length < 10 || telLimpo.length > 13) {
      return res.status(400).json({ erro: 'Informe um telefone válido com DDD.' });
    }
    if (!cpfLimpo || !validarNumeroCPF(cpfLimpo)) {
      return res.status(400).json({ erro: 'Número de CPF inválido.' });
    }

    const erroSenha = validarSenha(senha);
    if (erroSenha) {
      return res.status(400).json({ erro: erroSenha });
    }

    // Telefone verificado nos últimos 30 minutos (se o app usou a verificação)
    let telVerificado = false;
    const checkOtp = await sql`
      SELECT id FROM codigos_verificacao
      WHERE telefone = ${telLimpo} AND verificado = TRUE
        AND criado_em >= NOW() - INTERVAL '30 minutes'
      ORDER BY id DESC LIMIT 1;
    `;
    if (checkOtp.length) telVerificado = true;

    const dataNascSql = dataNascimento && /^\d{4}-\d{2}-\d{2}/.test(String(dataNascimento))
      ? String(dataNascimento).slice(0, 10)
      : null;

    const senhaHash = await bcrypt.hash(String(senha), 10);

    if (papelDesejado === 'motorista') {
      const auditoria = auditarDocumentacaoMotorista({
        cnh: cnh || cnh_numero,
        cnh_validade,
        crlv_validade,
        veiculo_modelo,
        veiculo_placa,
        veiculo_ano,
        doc_cnh_url,
        doc_crlv_url
      });

      if (!auditoria.aprovado) {
        return res.status(400).json({ erro: auditoria.erro });
      }

      const corLimpa = veiculo_cor ? String(veiculo_cor).trim().slice(0, 30) : 'Não informada';
      const catFinal = String(categoria || categoria_veiculo || 'carro').slice(0, 30);
      const idMotorista = novoId('mot');
      const statusInicial = APROVACAO_AUTOMATICA ? 'aprovado' : 'pendente';

      await sql`
        INSERT INTO usuarios (
          id, nome, email, telefone, cpf, data_nascimento, senha_hash, role,
          termos_aceitos_em, versao_termos, telefone_verificado, indicado_por_codigo
        ) VALUES (
          ${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
          ${dataNascSql}, ${senhaHash}, 'motorista',
          CURRENT_TIMESTAMP, ${versaoFinalTermos}, ${telVerificado}, ${codigoConviteLimpo}
        );
      `;

      let motoristaCriado;
      try {
        const resultado = await sql`
          INSERT INTO motoristas (
            id, usuario_id, nome, email, telefone, cpf, data_nascimento, senha_hash,
            cnh_numero, cnh_validade, crlv_validade,
            categoria, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
            saldo_carteira, status_aprovacao, docs_validados_auto, avaliacao_media, total_corridas,
            status_online,
            doc_cnh_url, doc_crlv_url, termos_aceitos_em, versao_termos, telefone_verificado, indicado_por_codigo
          ) VALUES (
            ${idMotorista}, ${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
            ${dataNascSql}, ${senhaHash},
            ${auditoria.cnhLimpa}, ${auditoria.cnhValSql}, ${auditoria.crlvValSql},
            ${catFinal}, ${auditoria.modeloLimpo}, ${auditoria.placaLimpa}, ${corLimpa}, ${auditoria.anoLimpo},
            0.00, ${statusInicial}, TRUE, 5.00, 0,
            FALSE,
            ${doc_cnh_url}, ${doc_crlv_url}, CURRENT_TIMESTAMP, ${versaoFinalTermos}, ${telVerificado}, ${codigoConviteLimpo}
          )
          RETURNING id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, categoria, status_aprovacao;
        `;
        motoristaCriado = resultado[0];
      } catch (erroMotorista) {
        await sql`DELETE FROM usuarios WHERE id = ${idMotorista};`;
        throw erroMotorista;
      }

      if (codigoConviteLimpo) {
        await registrarIndicacaoNoCadastro({
          novoUsuarioId: idMotorista,
          novoUsuarioNome: nomeLimpo,
          novoUsuarioRole: 'motorista',
          codigoConvite: codigoConviteLimpo
        });
      }

      const resposta = respostaLoginMotorista(motoristaCriado, nomeLimpo);
      return res.status(201).json({
        ...resposta,
        aprovadoAutomaticamente: statusInicial === 'aprovado',
        mensagem: statusInicial === 'aprovado'
          ? 'Cadastro aprovado! Bem-vindo à HUBy.'
          : 'Cadastro recebido! Seus documentos estão em análise. Você será avisado quando for aprovado.'
      });
    }

    const idUsuario = novoId('usr');
    const resultado = await sql`
      INSERT INTO usuarios (
        id, nome, email, telefone, cpf, data_nascimento,
        contato_emergencia_nome, contato_emergencia_tel,
        senha_hash, role, termos_aceitos_em, versao_termos, telefone_verificado, indicado_por_codigo
      ) VALUES (
        ${idUsuario}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
        ${dataNascSql},
        ${contatoEmergenciaNome ? String(contatoEmergenciaNome).trim().slice(0, 150) : null},
        ${contatoEmergenciaTelefone ? String(contatoEmergenciaTelefone).replace(/\D/g, '').slice(0, 25) : null},
        ${senhaHash}, 'cliente', CURRENT_TIMESTAMP, ${versaoFinalTermos}, ${telVerificado}, ${codigoConviteLimpo}
      )
      RETURNING id, nome, email, telefone, role;
    `;

    if (codigoConviteLimpo) {
      await registrarIndicacaoNoCadastro({
        novoUsuarioId: idUsuario,
        novoUsuarioNome: nomeLimpo,
        novoUsuarioRole: 'cliente',
        codigoConvite: codigoConviteLimpo
      });
    }

    const criado = resultado[0];
    const token = jwt.sign(
      { id: criado.id, nome: criado.nome, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ sucesso: true, token, usuario: { ...criado, role: 'cliente' } });
  } catch (err) {
    console.error('ERRO NO CADASTRO:', err);
    if (erroDeDuplicidade(err)) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está registrado.' });
    }
    res.status(500).json({ erro: 'Não foi possível concluir o cadastro. Tente novamente.' });
  }
}

router.post('/cadastro', handlerCadastro);
// Nome antigo usado por versões anteriores do app
router.post('/registo', handlerCadastro);

// ============================================================================
// LOGIN (PASSAGEIRO E ADMIN; MOTORISTA TAMBÉM PODE ENTRAR POR AQUI COM SENHA)
// ============================================================================
router.post('/login', async (req, res) => {
  try {
    const identificador = req.body?.identificador || req.body?.emailOuTelefone || req.body?.email;
    const senha = req.body?.senha;
    const perfilDesejado = req.body?.perfilDesejado || 'cliente';

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Informe seus dados de acesso e a senha.' });
    }

    if (perfilDesejado === 'motorista') {
      const r = await autenticarMotorista(identificador, senha);
      if (r.erro) return res.status(r.status).json({ erro: r.erro });
      return res.json(respostaLoginMotorista(r.mot));
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

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
        SELECT *
        FROM motoristas
        WHERE id::text = ${String(usr.id)}::text OR usuario_id::text = ${String(usr.id)}::text
        LIMIT 1;
      `;
      if (!registro.length) return res.status(401).json({ erro: MSG_CREDENCIAIS });

      const bloqueio = bloqueioDeAprovacao(registro[0]);
      if (bloqueio) return res.status(403).json({ erro: bloqueio });

      return res.json(respostaLoginMotorista(registro[0], usr.nome));
    }

    const token = jwt.sign(
      { id: usr.id, nome: usr.nome, email: usr.email, role: roleFinal },
      JWT_SECRET,
      { expiresIn: roleFinal === 'admin' ? '12h' : '30d' }
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

// ============================================================================
// LOGIN DO MOTORISTA (SENHA OBRIGATÓRIA)
// Aceita: { identificador, senha } ou o formato antigo { email, senha }
// ============================================================================
router.post('/login-motorista', async (req, res) => {
  try {
    const identificador = req.body?.identificador || req.body?.email || req.body?.telefone || req.body?.cpf;
    const senha = req.body?.senha;

    const r = await autenticarMotorista(identificador, senha);
    if (r.erro) return res.status(r.status).json({ erro: r.erro });

    return res.json(respostaLoginMotorista(r.mot));
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
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
                 foto_perfil_url AS foto_url, status_aprovacao
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
    const { nome, email, telefone, foto_url } = req.body || {};

    const nomeLimpo = nome ? String(nome).trim().slice(0, 120) : null;
    const emailLimpo = email ? String(email).trim().toLowerCase().slice(0, 254) : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;

    if (nomeLimpo !== null && nomeLimpo.length < 2) {
      return res.status(400).json({ erro: 'Nome muito curto.' });
    }
    if (emailLimpo && !validarEmail(emailLimpo)) {
      return res.status(400).json({ erro: 'E-mail inválido.' });
    }
    if (telLimpo && (telLimpo.length < 10 || telLimpo.length > 13)) {
      return res.status(400).json({ erro: 'Telefone inválido.' });
    }

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
        RETURNING id, usuario_id, nome, email, telefone, veiculo_modelo, veiculo_placa, foto_perfil_url AS foto_url;
      `;

      const idUsuarioVinculado = atualizado[0]?.usuario_id || idToken;
      await sql`
        UPDATE usuarios
        SET nome = COALESCE(${nomeLimpo}, nome),
            email = COALESCE(${emailLimpo}, email),
            telefone = COALESCE(${telLimpo}, telefone),
            foto_perfil_url = COALESCE(${foto}, foto_perfil_url)
        WHERE id::text = ${String(idUsuarioVinculado)}::text;
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
    const { usuario_id, ...usuarioSemVinculo } = atualizado[0];
    res.json({ sucesso: true, mensagem: 'Perfil atualizado!', usuario: usuarioSemVinculo });
  } catch (err) {
    console.error('ERRO AO ATUALIZAR PERFIL:', err);
    if (erroDeDuplicidade(err)) {
      return res.status(409).json({ erro: 'Este e-mail ou telefone já está em uso.' });
    }
    res.status(500).json({ erro: 'Erro ao salvar alterações.' });
  }
});
// ============================================================================
// ESQUECI MINHA SENHA (código de 6 dígitos por e-mail, válido por 15 minutos)
// A resposta é sempre a mesma, exista ou não a conta (ninguém descobre quais e-mails têm cadastro).
// ============================================================================
const MSG_RECUPERACAO = 'Se este e-mail estiver cadastrado, você vai receber um código em instantes. Confira também a caixa de spam.';
const MSG_CODIGO_INVALIDO = 'Código expirado ou inválido. Peça um novo código.';

async function garantirTabelaRecuperacao() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS codigos_recuperacao_senha (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        codigo_hash TEXT NOT NULL,
        tentativas INT DEFAULT 0,
        usado BOOLEAN DEFAULT FALSE,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Aviso ao criar tabela de recuperação de senha:', err.message);
  }
}
garantirTabelaRecuperacao();

// O código nunca fica salvo puro no banco, só o "resumo" dele
function hashCodigoRecuperacao(email, codigo) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`${email}:${codigo}`).digest('hex');
}

function escaparTextoEmail(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function montarEmailRecuperacao(nome, codigo) {
  const primeiroNome = escaparTextoEmail(String(nome || '').trim().split(' ')[0] || 'tudo bem');
  const texto = `Olá, ${primeiroNome}!\n\nSeu código para criar uma nova senha no HUBy é: ${codigo}\n\nEle vale por 15 minutos.\nSe não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#0B0F19;padding:24px;">
      <div style="max-width:440px;margin:0 auto;background:#111827;border-radius:16px;padding:28px;color:#E5E7EB;">
        <div style="font-size:26px;font-weight:900;color:#FFFFFF;margin-bottom:18px;">HUB<span style="color:#10B981;">y</span></div>
        <p style="margin:0 0 10px;font-size:15px;">Olá, ${primeiroNome}!</p>
        <p style="margin:0 0 18px;font-size:14px;color:#9CA3AF;">Use o código abaixo para criar uma nova senha:</p>
        <div style="font-size:34px;font-weight:900;letter-spacing:8px;text-align:center;background:#0B0F19;border:1px solid #10B981;border-radius:12px;padding:16px;color:#10B981;">${codigo}</div>
        <p style="margin:18px 0 0;font-size:13px;color:#9CA3AF;">O código vale por <strong>15 minutos</strong>.</p>
        <p style="margin:8px 0 0;font-size:13px;color:#9CA3AF;">Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.</p>
      </div>
    </div>`;
  return { texto, html };
}

router.post('/esqueci-senha', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
    if (!validarEmail(email)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }

    if (!emailConfigurado()) {
      return res.status(503).json({ erro: 'Recuperação de senha indisponível no momento. Fale com o suporte HUBy.' });
    }

    // No máximo 3 pedidos por e-mail a cada 15 minutos (vale para qualquer e-mail, com ou sem conta)
    const recentes = await sql`
      SELECT COUNT(*)::int AS qtd FROM codigos_recuperacao_senha
      WHERE email = ${email} AND criado_em >= NOW() - INTERVAL '15 minutes';
    `;
    if (Number(recentes[0]?.qtd || 0) >= 3) {
      return res.status(429).json({ erro: 'Muitos pedidos para este e-mail. Aguarde 15 minutos e tente de novo.' });
    }

    const contas = await sql`
      SELECT nome FROM usuarios WHERE LOWER(TRIM(email)) = ${email}
      UNION ALL
      SELECT nome FROM motoristas WHERE LOWER(TRIM(email)) = ${email}
      LIMIT 1;
    `;

    const codigo = String(crypto.randomInt(100000, 1000000));

    // Só o código mais novo vale
    await sql`UPDATE codigos_recuperacao_senha SET usado = TRUE WHERE email = ${email} AND usado = FALSE;`;
    await sql`
      INSERT INTO codigos_recuperacao_senha (email, codigo_hash, expira_em)
      VALUES (${email}, ${hashCodigoRecuperacao(email, codigo)}, ${new Date(Date.now() + 15 * 60 * 1000)});
    `;

    if (contas.length) {
      const { texto, html } = montarEmailRecuperacao(contas[0].nome, codigo);
      const envio = await enviarEmail({
        para: email,
        nomePara: contas[0].nome || undefined,
        assunto: `${codigo} é o seu código para criar uma nova senha • HUBy`,
        texto,
        html
      });
      if (!envio.enviado) {
        console.warn('[recuperacao] E-mail de recuperação não foi enviado:', envio.motivo);
      }
    }

    return res.json({ sucesso: true, mensagem: MSG_RECUPERACAO });
  } catch (err) {
    console.error('Erro em esqueci-senha:', err);
    return res.status(500).json({ erro: 'Não foi possível processar o pedido agora. Tente novamente.' });
  }
});

router.post('/redefinir-senha', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
    const codigo = String(req.body?.codigo || '').replace(/\D/g, '');
    const novaSenha = req.body?.novaSenha;

    if (!validarEmail(email) || codigo.length !== 6) {
      return res.status(400).json({ erro: 'Informe o e-mail e o código de 6 dígitos.' });
    }

    const erroSenha = validarSenha(novaSenha);
    if (erroSenha) {
      return res.status(400).json({ erro: erroSenha });
    }

    const [reg] = await sql`
      SELECT id, codigo_hash, tentativas FROM codigos_recuperacao_senha
      WHERE email = ${email} AND usado = FALSE AND expira_em > NOW()
      ORDER BY id DESC
      LIMIT 1;
    `;
    if (!reg) {
      return res.status(400).json({ erro: MSG_CODIGO_INVALIDO });
    }

    if (Number(reg.tentativas || 0) >= 5) {
      await sql`UPDATE codigos_recuperacao_senha SET usado = TRUE WHERE id = ${reg.id};`;
      return res.status(429).json({ erro: 'Muitas tentativas erradas. Peça um novo código.' });
    }

    const esperado = Buffer.from(String(reg.codigo_hash), 'hex');
    const recebido = Buffer.from(hashCodigoRecuperacao(email, codigo), 'hex');
    const codigoOk = esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);

    if (!codigoOk) {
      await sql`UPDATE codigos_recuperacao_senha SET tentativas = tentativas + 1 WHERE id = ${reg.id};`;
      return res.status(400).json({ erro: 'Código incorreto. Confira os 6 dígitos do e-mail.' });
    }

    // Marca como usado ANTES de trocar a senha (o mesmo código não funciona duas vezes)
    const marcado = await sql`
      UPDATE codigos_recuperacao_senha SET usado = TRUE
      WHERE id = ${reg.id} AND usado = FALSE
      RETURNING id;
    `;
    if (!marcado.length) {
      return res.status(400).json({ erro: MSG_CODIGO_INVALIDO });
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);

    // A senha fica igual nas duas tabelas (o motorista também tem cadastro em "usuarios")
    const usuariosAtualizados = await sql`
      UPDATE usuarios SET senha_hash = ${senhaHash}
      WHERE LOWER(TRIM(email)) = ${email}
      RETURNING id;
    `;
    const motoristasAtualizados = await sql`
      UPDATE motoristas SET senha_hash = ${senhaHash}
      WHERE LOWER(TRIM(email)) = ${email}
      RETURNING id;
    `;

    if (!usuariosAtualizados.length && !motoristasAtualizados.length) {
      return res.status(400).json({ erro: MSG_CODIGO_INVALIDO });
    }

    return res.json({ sucesso: true, mensagem: 'Senha alterada! Agora é só entrar com a senha nova.' });
  } catch (err) {
    console.error('Erro em redefinir-senha:', err);
    return res.status(500).json({ erro: 'Não foi possível alterar a senha agora. Tente novamente.' });
  }
});

// ============================================================================
// EXCLUIR MINHA CONTA (LGPD + exigência da Google Play)
// Apaga os dados pessoais e mantém o histórico de corridas e pagamentos SEM nome,
// pelo prazo exigido por lei (fiscal / consumidor).
// ============================================================================
const STATUS_CORRIDA_EM_ABERTO = [
  'pendente', 'aguardando', 'buscando', 'criado', 'agendado',
  'aceito', 'a_caminho', 'chegou_local', 'aguardando_passageiro', 'no_local', 'motorista_no_local',
  'em_andamento', 'em_viagem'
];
const NOME_CONTA_EXCLUIDA = 'Conta excluída';

async function garantirColunasExclusao() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS excluido_em TIMESTAMP WITH TIME ZONE;`;
  } catch (err) {
    console.warn('Aviso ao preparar colunas de exclusão de conta:', err.message);
  }
}
garantirColunasExclusao();

router.post('/excluir-conta', autenticarToken, async (req, res) => {
  try {
    const senha = String(req.body?.senha || '');
    if (!senha) {
      return res.status(400).json({ erro: 'Digite sua senha para confirmar.' });
    }

    const role = extrairRoleLimpa(req.usuario);
    if (role === 'admin') {
      return res.status(403).json({ erro: 'Conta de administrador não pode ser excluída pelo aplicativo.' });
    }

    const ids = [req.usuario?.id, req.usuario?.motoristaId]
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(String);
    if (!ids.length) {
      return res.status(400).json({ erro: 'Conta não identificada.' });
    }

    const [usuario] = await sql`
      SELECT id, email, telefone, senha_hash, COALESCE(saldo_carteira, 0) AS saldo_carteira
      FROM usuarios
      WHERE id::text = ANY(${ids}) AND excluido_em IS NULL
      LIMIT 1;
    `;
    const [mot] = await sql`
      SELECT id, usuario_id, email, telefone, senha_hash, COALESCE(saldo_carteira, 0) AS saldo_carteira
      FROM motoristas
      WHERE (id::text = ANY(${ids}) OR usuario_id::text = ANY(${ids})) AND excluido_em IS NULL
      LIMIT 1;
    `;

    if (!usuario && !mot) {
      return res.status(404).json({ erro: 'Conta não encontrada ou já excluída.' });
    }

    // Confirma a senha (403, e não 401, para o app não confundir com "sessão vencida")
    const hashes = [usuario?.senha_hash, mot?.senha_hash].filter(Boolean);
    let senhaOk = false;
    for (const h of hashes) {
      try {
        if (await bcrypt.compare(senha, String(h))) { senhaOk = true; break; }
      } catch (e) {}
    }
    if (!senhaOk) {
      return res.status(403).json({ erro: 'Senha incorreta.' });
    }

    // Nada de corrida em aberto (passageiro ou motorista)
    const idUsuario = usuario ? String(usuario.id) : '';
    const idMot = mot ? String(mot.id) : '';
    const emAberto = await sql`
      SELECT id FROM pedidos
      WHERE LOWER(COALESCE(status, '')) = ANY(${STATUS_CORRIDA_EM_ABERTO})
        AND (
          (${idUsuario} <> '' AND cliente_id::text = ${idUsuario})
          OR (${idMot} <> '' AND motorista_id::text = ${idMot})
        )
      LIMIT 1;
    `;
    if (emAberto.length) {
      return res.status(409).json({ erro: 'Você tem uma corrida em andamento ou agendada. Finalize ou cancele antes de excluir a conta.' });
    }

    // Dinheiro: ninguém perde saldo e ninguém sai devendo
    if (mot) {
      const saldoMot = Number(mot.saldo_carteira || 0);
      if (saldoMot > 0.009) {
        return res.status(409).json({ erro: `Você ainda tem R$ ${saldoMot.toFixed(2).replace('.', ',')} na carteira. Faça o saque antes de excluir a conta.` });
      }
      if (saldoMot < -0.009) {
        return res.status(409).json({ erro: `Há taxas pendentes de R$ ${Math.abs(saldoMot).toFixed(2).replace('.', ',')}. Regularize com o suporte HUBy antes de excluir a conta.` });
      }
      const saquesPendentes = await sql`
        SELECT id FROM saques_motoristas
        WHERE motorista_id::text = ${idMot} AND status = 'pendente'
        LIMIT 1;
      `;
      if (saquesPendentes.length) {
        return res.status(409).json({ erro: 'Você tem um saque aguardando pagamento. Espere ele ser pago antes de excluir a conta.' });
      }
    }
    if (usuario && Number(usuario.saldo_carteira || 0) > 0.009) {
      return res.status(409).json({ erro: 'Você ainda tem saldo na carteira HUBy. Fale com o suporte para receber o reembolso antes de excluir a conta.' });
    }

    const emailsAntigos = [usuario?.email, mot?.email].filter(Boolean).map((e) => String(e).trim().toLowerCase());
    const telefonesAntigos = [usuario?.telefone, mot?.telefone].filter(Boolean).map((t) => String(t).replace(/\D/g, ''));

    // ---------- MOTORISTA ----------
    if (mot) {
      await sql`
        UPDATE motoristas
        SET nome = ${NOME_CONTA_EXCLUIDA},
            email = NULL, telefone = NULL, cpf = NULL, data_nascimento = NULL,
            senha_hash = NULL, cnh_numero = NULL,
            doc_cnh_url = NULL, doc_crlv_url = NULL, foto_perfil_url = NULL,
            ultima_selfie_url = NULL, chave_pix_padrao = NULL, veiculo_placa = NULL,
            destino_casa_lat = NULL, destino_casa_lng = NULL, destino_casa_ativo = FALSE,
            status_online = FALSE, status_aprovacao = 'excluido',
            excluido_em = CURRENT_TIMESTAMP
        WHERE id::text = ${idMot};
      `;
      await sql`DELETE FROM verificacoes_selfie_motorista WHERE motorista_id::text = ${idMot};`;
      await sql`
        UPDATE pedidos
        SET motorista_nome = 'Motorista (conta excluída)', motorista_telefone = NULL, motorista_placa = NULL
        WHERE motorista_id::text = ${idMot};
      `;
    }

    // ---------- CADASTRO GERAL (passageiro, e também o do motorista) ----------
    const idsUsuarioApagar = [idUsuario, mot?.usuario_id ? String(mot.usuario_id) : ''].filter(Boolean);
    if (idsUsuarioApagar.length) {
      await sql`
        UPDATE usuarios
        SET nome = ${NOME_CONTA_EXCLUIDA},
            email = NULL, telefone = NULL, cpf = NULL, data_nascimento = NULL,
            contato_emergencia_nome = NULL, contato_emergencia_tel = NULL,
            foto_perfil_url = NULL, indicado_por_codigo = NULL,
            senha_hash = 'conta_excluida',
            excluido_em = CURRENT_TIMESTAMP
        WHERE id::text = ANY(${idsUsuarioApagar});
      `;
      // Observações das corridas podem ter dados pessoais (ex.: "portão azul, casa da Maria")
      await sql`UPDATE pedidos SET observacao = NULL WHERE cliente_id::text = ANY(${idsUsuarioApagar});`;
    }

    // Mensagens enviadas por esta conta no chat das corridas
    const remetentes = [...idsUsuarioApagar, idMot].filter(Boolean);
    if (remetentes.length) {
      await sql`DELETE FROM mensagens_chat WHERE remetente_id::text = ANY(${remetentes});`;
    }

    // Códigos de recuperação de senha e de verificação de telefone
    if (emailsAntigos.length) {
      try { await sql`DELETE FROM codigos_recuperacao_senha WHERE email = ANY(${emailsAntigos});`; } catch (e) {}
    }
    if (telefonesAntigos.length) {
      try { await sql`DELETE FROM codigos_verificacao WHERE telefone = ANY(${telefonesAntigos});`; } catch (e) {}
    }

    return res.json({
      sucesso: true,
      mensagem: 'Sua conta foi excluída e seus dados pessoais foram apagados. Obrigado por ter usado o HUBy.'
    });
  } catch (err) {
    console.error('Erro ao excluir conta:', err);
    return res.status(500).json({ erro: 'Não foi possível excluir a conta agora. Tente novamente.' });
  }
});

export default router;