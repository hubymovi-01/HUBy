// routes/auth.routes.js - Cadastro com Auditoria Automática de Documentos/Datas, OTP, LGPD e Perfil HUBy
import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { registrarIndicacaoNoCadastro } from './indicacoes.routes.js';

const router = express.Router();

const MSG_CREDENCIAIS = 'Credenciais inválidas.';

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
  return corpo.length >= 500 && corpo.length <= maxCaracteres;
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

function bloqueioDeAprovacao(mot) {
  const s = mot?.status_aprovacao;
  if (!s || s === 'aprovado') return null;
  if (s === 'recusado') {
    return `Cadastro recusado${mot.motivo_recusa ? `: ${mot.motivo_recusa}` : '.'}`;
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
    await garantirEstruturaAuthSeguranca();
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

    const codigo = String(crypto.randomInt(100000, 999999));
    const expiraEm = new Date(Date.now() + 5 * 60 * 1000);

    await sql`
      INSERT INTO codigos_verificacao (telefone, codigo, verificado, expira_em)
      VALUES (${telLimpo}, ${codigo}, FALSE, ${expiraEm});
    `;

    const envio = await despacharMensagemWhatsApp(telLimpo, codigo);

    return res.json({
      sucesso: true,
      enviadoViaWhatsApp: envio.enviadoReal,
      codigoTeste: envio.enviadoReal ? undefined : codigo,
      mensagem: envio.enviadoReal
        ? 'Código de 6 dígitos enviado para o seu WhatsApp!'
        : `Código de verificação gerado: ${codigo}`
    });
  } catch (err) {
    console.error('Erro ao gerar OTP:', err);
    res.status(500).json({ erro: 'Falha ao enviar código de verificação.' });
  }
});

router.post('/verificar-codigo', async (req, res) => {
  try {
    await garantirEstruturaAuthSeguranca();
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

    if (reg.codigo !== codigoInformado) {
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
// CADASTRO COM AUDITORIA AUTOMÁTICA DE DOCUMENTOS E APROVAÇÃO IMEDIATA
// ============================================================================
router.post('/cadastro', async (req, res) => {
  try {
    await garantirEstruturaAuthSeguranca();

    const {
      nome, email, telefone, cpf, senha, role,
      aceitouTermos, versaoTermos, codigoIndicacao,
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, cnh_numero, cnh_validade, crlv_validade,
      categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      doc_cnh_url, doc_crlv_url
    } = req.body;

    if (aceitouTermos === false) {
      return res.status(400).json({ erro: 'Você precisa ler e aceitar os Termos de Uso e a Política de Privacidade (LGPD).' });
    }

    const papelDesejado = role === 'motorista' ? 'motorista' : 'cliente';

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, Senha e Contato).' });
    }

    const nomeLimpo = String(nome).trim();
    const senhaTexto = String(senha);
    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : '';
    const versaoFinalTermos = String(versaoTermos || '1.0').slice(0, 20);
    const codigoConviteLimpo = codigoIndicacao ? String(codigoIndicacao).trim().toUpperCase().slice(0, 20) : null;

    if (!cpfLimpo || !validarNumeroCPF(cpfLimpo)) {
      return res.status(400).json({ erro: 'Número de CPF inválido.' });
    }

    let telVerificado = false;
    if (telLimpo) {
      const checkOtp = await sql`
        SELECT id FROM codigos_verificacao
        WHERE telefone = ${telLimpo} AND verificado = TRUE
        ORDER BY id DESC LIMIT 1;
      `;
      if (checkOtp.length) {
        telVerificado = true;
      }
    }

    const dataNascSql = dataNascimento ? String(dataNascimento).slice(0, 10) : null;
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(senhaTexto, salt);

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
            doc_cnh_url, doc_crlv_url, termos_aceitos_em, versao_termos, telefone_verificado, indicado_por_codigo
          ) VALUES (
            ${idMotorista}, ${idMotorista}, ${nomeLimpo}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
            ${dataNascSql}, ${senhaHash},
            ${auditoria.cnhLimpa}, ${auditoria.cnhValSql}, ${auditoria.crlvValSql},
            ${catFinal}, ${auditoria.modeloLimpo}, ${auditoria.placaLimpa}, ${corLimpa}, ${auditoria.anoLimpo},
            0.00, 'aprovado', TRUE, 5.00, 0,
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
          codigoConvite: codigoConviteLimpo
        });
      }

      return res.status(201).json({
        sucesso: true,
        aprovadoAutomaticamente: true,
        mensagem: 'Documentos validados e cadastro aprovado automaticamente! Bem-vindo à HUBy.',
        token: emitirTokenMotorista(motoristaCriado),
        usuario: { ...motoristaCriado, motoristaId: motoristaCriado.id, role: 'motorista', status_aprovacao: 'aprovado' }
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
        ${contatoEmergenciaTelefone ? String(contatoEmergenciaTelefone).trim().slice(0, 25) : null},
        ${senhaHash}, 'cliente', CURRENT_TIMESTAMP, ${versaoFinalTermos}, ${telVerificado}, ${codigoConviteLimpo}
      )
      RETURNING id, nome, email, telefone, role;
    `;

    if (codigoConviteLimpo) {
      await registrarIndicacaoNoCadastro({
        novoUsuarioId: idUsuario,
        novoUsuarioNome: nomeLimpo,
        codigoConvite: codigoConviteLimpo
      });
    }

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

      await sql`UPDATE motoristas SET status_online = TRUE, status_aprovacao = 'aprovado' WHERE id = ${mot.id};`;

      return res.json({
        sucesso: true,
        token: emitirTokenMotorista(mot),
        usuario: {
          id: mot.id, motoristaId: mot.id, nome: mot.nome, email: mot.email, telefone: mot.telefone,
          role: 'motorista', categoria: mot.categoria || 'carro',
          veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`, saldo: mot.saldo_carteira
        }
      });
    }

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
        usuario: {
          id: registro[0].id, motoristaId: registro[0].id, nome: usr.nome,
          email: usr.email, telefone: usr.telefone, role: 'motorista',
          categoria: registro[0].categoria || 'carro'
        }
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
    if (!email || !cnh || !veiculo_placa) {
      return res.status(400).json({ erro: 'Preencha E-mail, CNH e Placa.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const motoristas = await sql`
      SELECT * FROM motoristas
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
        AND regexp_replace(COALESCE(cnh_numero, ''), '\\D', '', 'g') = ${cnhLimpa}
        AND UPPER(REPLACE(TRIM(COALESCE(veiculo_placa, '')), '-', '')) = ${placaLimpa}
      LIMIT 1;
    `;

    if (!motoristas.length) return res.status(401).json({ erro: MSG_CREDENCIAIS });

    const mot = motoristas[0];
    if (senha && mot.senha_hash) {
      if (!(await bcrypt.compare(String(senha), mot.senha_hash))) {
        return res.status(401).json({ erro: MSG_CREDENCIAIS });
      }
    }

    const bloqueio = bloqueioDeAprovacao(mot);
    if (bloqueio) return res.status(403).json({ erro: bloqueio });

    await sql`UPDATE motoristas SET status_online = TRUE, status_aprovacao = 'aprovado' WHERE id = ${mot.id};`;

    res.json({
      sucesso: true,
      token: emitirTokenMotorista(mot),
      usuario: {
        id: mot.id,
        motoristaId: mot.id,
        nome: mot.nome,
        email: mot.email,
        telefone: mot.telefone,
        role: 'motorista',
        categoria: mot.categoria || 'carro',
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