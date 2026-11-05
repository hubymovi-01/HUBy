// routes/carteira.routes.js - Carteira Digital, Pix Mercado Pago & Saques HUBy
// VERSÃO CORRIGIDA (segurança):
//  - Todas as rotas exigem login; rotas de admin exigem papel admin.
//  - Motorista só acessa/saca a PRÓPRIA carteira.
//  - /pix/simular-pagamento desativada em produção.
//  - Webhook com validação de assinatura (se MP_WEBHOOK_SECRET existir) e conferência de valor.
//  - Crédito de Pix, saques, débitos e gorjetas são operações ATÔMICAS (sem duplicar dinheiro).
//  - Removido CPF "de reserva" fixo e o QR Code gerado por site de terceiros.
import express from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// ============================================================================
// AUXILIARES
// ============================================================================
const papel = (u) => String(u?.role || u?.funcao || '').toLowerCase();
const ehAdmin = (u) => ['admin', 'administrador'].includes(papel(u));

function verificarAdmin(req, res, next) {
  if (!ehAdmin(req.usuario)) {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

// Converte para número com 2 casas; devolve null se inválido
function lerValor(v, max = 100000) {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

const brl = (n) => Number(n).toFixed(2).replace('.', ',');

// Confere se quem chama é o próprio motorista (ou admin) e carrega o cadastro dele
async function carregarMotoristaAutorizado(req, idParam) {
  const alvo = String(idParam);
  if (!ehAdmin(req.usuario)) {
    const meusIds = [req.usuario.id, req.usuario.motoristaId].filter(Boolean).map(String);
    if (papel(req.usuario) !== 'motorista' || !meusIds.includes(alvo)) {
      return { status: 403, erro: 'Você não tem permissão para acessar esta carteira.' };
    }
  }
  const r = await sql`
    SELECT id, nome, saldo_carteira, chave_pix_padrao
    FROM motoristas
    WHERE id::text = ${alvo} OR usuario_id::text = ${alvo}
    LIMIT 1;
  `;
  if (!r.length) return { status: 404, erro: 'Motorista parceiro não localizado.' };
  return { motorista: r[0] };
}

// ============================================================================
// 0. MIGRAÇÃO SEGURA PARA SUPORTE À CARTEIRA DIGITAL E SAQUES
// ============================================================================
async function inicializarTabelasCarteira() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf VARCHAR(20);`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_gorjeta NUMERIC(10,2) DEFAULT 0.00;`;

    await sql`
      CREATE TABLE IF NOT EXISTS transacoes_carteira (
        id SERIAL PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        tipo_usuario VARCHAR(20) NOT NULL DEFAULT 'cliente',
        tipo_transacao VARCHAR(50) NOT NULL,
        valor NUMERIC(10,2) NOT NULL,
        pedido_id TEXT,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS cobrancas_pix (
        id SERIAL PRIMARY KEY,
        transacao_id VARCHAR(64) UNIQUE,
        txid VARCHAR(64) UNIQUE,
        pedido_id TEXT,
        usuario_id TEXT,
        valor NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pendente',
        qr_code TEXT,
        qr_code_base64 TEXT,
        pix_copia_cola TEXT,
        expira_em TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes'),
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS saques_motoristas (
        id SERIAL PRIMARY KEY,
        motorista_id TEXT NOT NULL,
        motorista_nome TEXT,
        chave_pix TEXT NOT NULL,
        tipo_chave TEXT DEFAULT 'cpf',
        valor NUMERIC(10,2) NOT NULL,
        status TEXT DEFAULT 'pendente',
        comprovante_url TEXT,
        motivo_recusa TEXT,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        solicitado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        pago_em TIMESTAMP WITH TIME ZONE
      );
    `;
  } catch (err) {
    console.warn('Tabelas de carteira já sincronizadas:', err.message);
  }
}
inicializarTabelasCarteira();

// Cliente oficial do Mercado Pago (token do .env tem prioridade, depois o banco)
async function obterClienteMercadoPago() {
  try {
    let accessToken = process.env.MP_ACCESS_TOKEN || '';

    if (!accessToken) {
      const config = await sql`
        SELECT valor FROM configuracoes_plataforma
        WHERE chave = 'gateway_mercadopago' LIMIT 1;
      `;
      accessToken = config[0]?.valor?.access_token || '';
    }

    if (!accessToken) {
      console.warn('Access Token do Mercado Pago não configurado.');
      return null;
    }

    const client = new MercadoPagoConfig({ accessToken });
    return { client, payment: new Payment(client) };
  } catch (err) {
    console.warn('Não foi possível inicializar Mercado Pago:', err.message);
    return null;
  }
}

// ----------------------------------------------------------------------------
// Confirma uma cobrança Pix UMA ÚNICA VEZ (mesmo que webhook e polling cheguem juntos)
// ----------------------------------------------------------------------------
async function confirmarCobrancaPix(cobrancaId, req) {
  // Um único comando no banco: só quem marcar como 'pago' primeiro credita o saldo.
  const r = await sql`
    WITH cob AS (
      UPDATE cobrancas_pix
         SET status = 'pago'
       WHERE id = ${cobrancaId} AND status <> 'pago'
      RETURNING usuario_id, valor, pedido_id
    ),
    cred AS (
      UPDATE usuarios
         SET saldo_carteira = COALESCE(saldo_carteira, 0) + cob.valor
        FROM cob
       WHERE cob.pedido_id IS NULL
         AND usuarios.id::text = cob.usuario_id::text
      RETURNING usuarios.id
    ),
    mov AS (
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor)
      SELECT cob.usuario_id, 'cliente', 'deposito_pix_mercadopago', cob.valor
        FROM cob
       WHERE cob.pedido_id IS NULL
    )
    SELECT usuario_id, valor, pedido_id FROM cob;
  `;

  if (!r.length) return { jaProcessada: true };

  const { pedido_id: pedidoId, valor } = r[0];
  const valorPago = Number(valor);

  // Pagamento de corrida via Pix: conclui o pedido e avisa o app em tempo real
  if (pedidoId) {
    await sql`
      UPDATE pedidos
         SET status = 'concluido',
             forma_pagamento = 'pix_mp',
             concluido_em = CURRENT_TIMESTAMP
       WHERE id::text = ${String(pedidoId)}::text;
    `;

    const io = req.io || req.app.get('io');
    if (io) {
      io.emit(`corrida_finalizada_${pedidoId}`, {
        sucesso: true,
        forma_pagamento: 'pix_mp',
        valorFinal: valorPago,
        mensagem: 'Pagamento Pix aprovado!'
      });
      io.emit('corrida_finalizada', {
        pedidoId,
        status: 'concluido',
        forma_pagamento: 'pix_mp',
        valorFinal: valorPago
      });
    }
  }

  return { jaProcessada: false, pedidoId, valorPago };
}

// Valida a assinatura que o Mercado Pago envia no webhook
function validarAssinaturaMP(req) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) {
    // Sem segredo configurado: segue (o pagamento é sempre reconferido na API do MP),
    // mas avisa. Configure MP_WEBHOOK_SECRET no Render para ativar a proteção.
    return true;
  }

  const assinatura = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  const partes = {};
  for (const trecho of assinatura.split(',')) {
    const [k, v] = trecho.trim().split('=');
    if (k && v) partes[k] = v;
  }
  if (!partes.ts || !partes.v1) return false;

  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  const manifesto = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');

  const a = Buffer.from(esperado);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ============================================================================
// 1. CONSULTA DE SALDO E EXTRATO GERAL
// ============================================================================
router.get('/saldo', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const role = papel(req.usuario);

    let saldo = 0;
    if (role === 'motorista') {
      const mot = await sql`
        SELECT saldo_carteira FROM motoristas
        WHERE id::text = ${usuarioId}::text OR usuario_id::text = ${usuarioId}::text
        LIMIT 1;
      `;
      saldo = Number(mot[0]?.saldo_carteira || 0);
    } else {
      const cli = await sql`
        SELECT saldo_carteira FROM usuarios
        WHERE id::text = ${usuarioId}::text
        LIMIT 1;
      `;
      saldo = Number(cli[0]?.saldo_carteira || 0);
    }

    const historico = await sql`
      SELECT id, tipo_transacao, valor, pedido_id, criado_em
      FROM transacoes_carteira
      WHERE usuario_id::text = ${usuarioId}::text
      ORDER BY criado_em DESC
      LIMIT 25;
    `;

    res.json({ saldo, historico });
  } catch (err) {
    console.error('Erro ao consultar saldo da carteira:', err);
    res.status(500).json({ erro: 'Falha ao buscar saldo.' });
  }
});

// ============================================================================
// 2. RECARGAS PIX (MERCADO PAGO)
// ============================================================================
router.post('/pix/gerar', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { pedidoId } = req.body;
    const valorNum = lerValor(req.body.valor, 5000);

    if (!valorNum || valorNum < 0.5) {
      return res.status(400).json({ erro: 'O valor mínimo para geração de Pix é de R$ 0,50.' });
    }

    const userQuery = await sql`
      SELECT nome, email, cpf FROM usuarios WHERE id::text = ${usuarioId}::text LIMIT 1;
    `;
    const dadosUser = userQuery[0] || {};

    const nomeCompleto = String(dadosUser.nome || req.usuario.nome || 'Cliente HUBy').trim();
    const partesNome = nomeCompleto.split(' ');
    const primeiroNome = partesNome[0] || 'Cliente';
    const sobrenome = partesNome.slice(1).join(' ') || 'Passageiro';
    const emailLimpo = String(dadosUser.email || req.usuario.email || 'contato@huby.app.br').trim();

    // O CPF precisa ser o do próprio usuário (antes havia um CPF fixo de reserva)
    const cpfLimpo = String(dadosUser.cpf || '').replace(/\D/g, '');
    if (cpfLimpo.length !== 11) {
      return res.status(400).json({ erro: 'Cadastre o seu CPF no perfil para gerar um Pix.' });
    }

    const mp = await obterClienteMercadoPago();
    if (!mp || !mp.payment) {
      return res.status(500).json({ erro: 'Pagamento Pix indisponível no momento.' });
    }

    const notificationUrl = `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`;

    const bodyMP = {
      transaction_amount: valorNum,
      description: `HUBy Mobilidade - Recarga #${pedidoId || 'Carteira'}`,
      payment_method_id: 'pix',
      payer: {
        email: emailLimpo,
        first_name: primeiroNome,
        last_name: sobrenome,
        identification: { type: 'CPF', number: cpfLimpo }
      },
      notification_url: notificationUrl
    };

    const mpRes = await mp.payment.create({ body: bodyMP });
    const txid = String(mpRes.id);
    const copiaCola = mpRes.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64 = mpRes.point_of_interaction?.transaction_data?.qr_code_base64;

    // QR Code só pela imagem do próprio Mercado Pago (sem enviar o código Pix a sites de terceiros)
    const qrCodeUrl = qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : null;
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000);

    await sql`
      INSERT INTO cobrancas_pix (txid, transacao_id, usuario_id, pedido_id, valor, status, pix_copia_cola, qr_code, qr_code_base64, expira_em)
      VALUES (${txid}, ${txid}, ${usuarioId}, ${pedidoId || null}, ${valorNum}, 'pendente', ${copiaCola}, ${copiaCola}, ${qrCodeBase64}, ${expiraEm})
      ON CONFLICT (txid) DO NOTHING;
    `;

    return res.json({
      sucesso: true,
      gateway: 'mercadopago',
      txid,
      valor: valorNum,
      copiaCola,
      qrCodeUrl,
      expiraEm
    });
  } catch (err) {
    console.error('Erro na geração do Pix Mercado Pago:', err?.cause || err?.message || err);
    return res.status(500).json({ erro: 'Não foi possível gerar o Pix agora. Tente novamente.' });
  }
});

// ============================================================================
// WEBHOOK DO MERCADO PAGO (CONFIRMAÇÃO AUTOMÁTICA)
// ============================================================================
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    if (!validarAssinaturaMP(req)) {
      console.warn('Webhook MP rejeitado: assinatura inválida.');
      return res.status(401).send('Assinatura inválida');
    }

    const { action, type } = req.body || {};
    const ehEventoDePagamento = !type || type === 'payment' || String(action || '').startsWith('payment');
    const paymentId = String(req.query['data.id'] || req.body?.data?.id || req.query.id || req.body?.id || '');

    if (!ehEventoDePagamento || !/^\d+$/.test(paymentId)) {
      return res.status(200).send('OK');
    }

    const mp = await obterClienteMercadoPago();
    if (!mp || !mp.payment) return res.status(200).send('OK');

    // Nunca confia no corpo da requisição: reconsulta o pagamento direto no Mercado Pago
    const info = await mp.payment.get({ id: paymentId });
    if (info.status !== 'approved') return res.status(200).send('OK');

    const cobrancas = await sql`
      SELECT id, valor FROM cobrancas_pix
      WHERE transacao_id = ${paymentId} OR txid = ${paymentId}
      LIMIT 1;
    `;
    if (!cobrancas.length) return res.status(200).send('OK');

    // O valor pago precisa ser igual ao valor da cobrança
    if (Math.abs(Number(cobrancas[0].valor) - Number(info.transaction_amount)) > 0.009) {
      console.warn(`Webhook MP: valor divergente na cobrança ${paymentId}.`);
      return res.status(200).send('OK');
    }

    await confirmarCobrancaPix(cobrancas[0].id, req);
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no processamento do Webhook MP:', err.message);
    // 500 faz o Mercado Pago tentar de novo mais tarde
    return res.status(500).send('Erro');
  }
});

// ============================================================================
// STATUS DA COBRANÇA PIX (POLLING) - só o dono da cobrança (ou admin)
// ============================================================================
router.get('/pix/status/:txid', autenticarToken, async (req, res) => {
  try {
    const { txid } = req.params;
    const usuarioId = String(req.usuario.id);

    const cobranca = await sql`
      SELECT id, txid, valor, status, expira_em, usuario_id
      FROM cobrancas_pix
      WHERE (txid = ${txid} OR transacao_id = ${txid})
      LIMIT 1;
    `;

    if (!cobranca.length || (!ehAdmin(req.usuario) && String(cobranca[0].usuario_id) !== usuarioId)) {
      return res.status(404).json({ erro: 'Cobrança Pix não localizada.' });
    }

    const cob = cobranca[0];
    const resposta = { txid: cob.txid, valor: cob.valor, status: cob.status, expira_em: cob.expira_em };

    if (cob.status === 'pago') return res.json(resposta);

    const mp = await obterClienteMercadoPago();
    if (mp && mp.payment && /^\d+$/.test(String(txid))) {
      try {
        const info = await mp.payment.get({ id: txid });
        if (
          info.status === 'approved' &&
          Math.abs(Number(cob.valor) - Number(info.transaction_amount)) <= 0.009
        ) {
          await confirmarCobrancaPix(cob.id, req);
          resposta.status = 'pago';
        }
      } catch (e) {
        console.warn('Falha ao consultar pagamento no Mercado Pago:', e?.message || e);
      }
    }

    res.json(resposta);
  } catch (err) {
    console.error('Erro ao consultar status do Pix:', err);
    res.status(500).json({ erro: 'Falha ao consultar status do Pix.' });
  }
});

// ----------------------------------------------------------------------------
// SIMULAÇÃO DE PIX: só existe em ambiente de teste e com a variável ligada.
// Em produção responde 404 (antes dava saldo grátis a qualquer usuário).
// Para testar localmente: PERMITIR_SIMULACAO_PIX=true (e NODE_ENV diferente de production)
// ----------------------------------------------------------------------------
router.post('/pix/simular-pagamento', autenticarToken, async (req, res) => {
  if (EM_PRODUCAO || process.env.PERMITIR_SIMULACAO_PIX !== 'true') {
    return res.status(404).json({ erro: 'Rota não encontrada.' });
  }

  const usuarioId = String(req.usuario.id);
  const { txid } = req.body;
  if (!txid) {
    return res.status(400).json({ erro: 'Identificador Pix (txid) obrigatório.' });
  }

  try {
    const cobs = await sql`
      SELECT id FROM cobrancas_pix
      WHERE (txid = ${txid} OR transacao_id = ${txid})
        AND usuario_id::text = ${usuarioId}::text
      LIMIT 1;
    `;
    if (!cobs.length) return res.status(404).json({ erro: 'Cobrança Pix não encontrada.' });

    const r = await confirmarCobrancaPix(cobs[0].id, req);
    res.json({
      sucesso: true,
      mensagem: r.jaProcessada ? 'Essa recarga já foi processada anteriormente.' : 'Recarga simulada com sucesso (modo teste).'
    });
  } catch (err) {
    console.error('Erro na simulação de Pix:', err);
    res.status(500).json({ erro: 'Falha ao simular pagamento.' });
  }
});

// ============================================================================
// 3. CARTEIRA E SAQUES DO MOTORISTA (só o próprio motorista ou admin)
// ============================================================================
router.get('/motorista/:id', autenticarToken, async (req, res) => {
  try {
    const aut = await carregarMotoristaAutorizado(req, req.params.id);
    if (aut.erro) return res.status(aut.status).json({ erro: aut.erro });
    const { motorista } = aut;

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em, pago_em, motivo_recusa
      FROM saques_motoristas
      WHERE motorista_id::text = ${motorista.id}::text
      ORDER BY criado_em DESC
      LIMIT 25;
    `;

    res.json({
      sucesso: true,
      saldo: Number(motorista.saldo_carteira || 0),
      chave_pix: motorista.chave_pix_padrao || '',
      saques
    });
  } catch (err) {
    console.error('Erro ao buscar carteira do condutor:', err);
    res.status(500).json({ erro: 'Falha ao carregar dados bancários do motorista.' });
  }
});

router.post('/motorista/:id/saque', autenticarToken, async (req, res) => {
  // Só o próprio motorista pede saque (admin não saca em nome de motorista)
  if (papel(req.usuario) !== 'motorista') {
    return res.status(403).json({ erro: 'Apenas motoristas parceiros podem solicitar saque.' });
  }

  const valorNum = lerValor(req.body.valor, 20000);
  const chave = String(req.body.chave_pix || '').trim();
  const tipoChave = String(req.body.tipo_chave || 'pix').trim().slice(0, 20);

  if (!valorNum) {
    return res.status(400).json({ erro: 'Informe um valor de saque válido.' });
  }
  if (!chave || chave.length > 140) {
    return res.status(400).json({ erro: 'A chave Pix para recebimento é obrigatória.' });
  }

  try {
    const aut = await carregarMotoristaAutorizado(req, req.params.id);
    if (aut.erro) return res.status(aut.status).json({ erro: aut.erro });
    const { motorista } = aut;

    // Débito + pedido de saque + extrato num único comando (ou tudo, ou nada)
    const r = await sql`
      WITH debito AS (
        UPDATE motoristas
           SET saldo_carteira = COALESCE(saldo_carteira, 0) - ${valorNum}::numeric,
               chave_pix_padrao = ${chave}::text
         WHERE id::text = ${String(motorista.id)}::text
           AND COALESCE(saldo_carteira, 0) >= ${valorNum}::numeric
        RETURNING id, nome, saldo_carteira
      ),
      saque AS (
        INSERT INTO saques_motoristas (motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status)
        SELECT id, nome, ${chave}::text, ${tipoChave}::text, ${valorNum}::numeric, 'pendente' FROM debito
        RETURNING id
      ),
      mov AS (
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        SELECT debito.id, 'motorista', 'solicitacao_saque_pix', ${-valorNum}::numeric, saque.id::text
          FROM debito, saque
      )
      SELECT debito.saldo_carteira AS novo_saldo, saque.id AS saque_id FROM debito, saque;
    `;

    if (!r.length) {
      const atual = await sql`SELECT saldo_carteira FROM motoristas WHERE id::text = ${String(motorista.id)}::text LIMIT 1;`;
      const disponivel = Number(atual[0]?.saldo_carteira || 0);
      return res.status(400).json({ erro: `Saldo insuficiente. Disponível: R$ ${brl(disponivel)}` });
    }

    res.json({
      sucesso: true,
      mensagem: `Solicitação de saque de R$ ${brl(valorNum)} enviada para a administração!`,
      novoSaldo: Number(r[0].novo_saldo),
      saqueId: r[0].saque_id
    });
  } catch (err) {
    console.error('Erro na solicitação de saque:', err);
    res.status(500).json({ erro: 'Falha ao processar solicitação de saque.' });
  }
});

// ============================================================================
// 4. PAINEL DO ADMINISTRADOR: APROVAÇÃO DE SAQUES (login + admin obrigatórios)
// ============================================================================
router.get('/admin/saques', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const saques = await sql`
      SELECT id, motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status,
             COALESCE(criado_em, solicitado_em) AS criado_em, pago_em, motivo_recusa
      FROM saques_motoristas
      ORDER BY
        CASE WHEN status = 'pendente' THEN 1 ELSE 2 END,
        COALESCE(criado_em, solicitado_em) DESC
      LIMIT 50;
    `;
    res.json(saques);
  } catch (err) {
    console.error('Erro ao listar saques no admin:', err);
    res.status(500).json({ erro: 'Falha ao consultar solicitações de saque.' });
  }
});

router.put('/admin/saques/:id', autenticarToken, verificarAdmin, async (req, res) => {
  const saqueId = Number(req.params.id);
  const { status } = req.body;
  const motivo = String(req.body.motivo_recusa || 'Dados bancários inconsistentes').slice(0, 200);

  if (!Number.isInteger(saqueId) || saqueId <= 0) {
    return res.status(400).json({ erro: 'Identificador de saque inválido.' });
  }
  if (!['pago', 'recusado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Escolha "pago" ou "recusado".' });
  }

  try {
    let alterado;

    if (status === 'recusado') {
      // Recusa + devolução do dinheiro ao motorista + extrato, num único comando
      alterado = await sql`
        WITH s AS (
          UPDATE saques_motoristas
             SET status = 'recusado', motivo_recusa = ${motivo}::text
           WHERE id = ${saqueId} AND status = 'pendente'
          RETURNING motorista_id, valor
        ),
        m AS (
          UPDATE motoristas
             SET saldo_carteira = COALESCE(saldo_carteira, 0) + s.valor
            FROM s
           WHERE motoristas.id::text = s.motorista_id::text
          RETURNING motoristas.id
        ),
        t AS (
          INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
          SELECT s.motorista_id, 'motorista', 'estorno_saque_recusado', s.valor, ${String(saqueId)}::text FROM s
        )
        SELECT valor FROM s;
      `;
    } else {
      alterado = await sql`
        UPDATE saques_motoristas
           SET status = 'pago', pago_em = CURRENT_TIMESTAMP
         WHERE id = ${saqueId} AND status = 'pendente'
        RETURNING id;
      `;
    }

    if (!alterado.length) {
      return res.status(400).json({ erro: 'Saque não encontrado ou já finalizado.' });
    }

    res.json({ sucesso: true, statusAtualizado: status });
  } catch (err) {
    console.error('Erro ao aprovar/recusar saque:', err);
    res.status(500).json({ erro: 'Falha ao atualizar status do saque.' });
  }
});

// ============================================================================
// 5. ABATE DE CORRIDA E GORJETAS
// ============================================================================
router.post('/debito-corrida', autenticarToken, async (req, res) => {
  const clienteId = String(req.usuario.id);
  const pedidoId = String(req.body.pedidoId || '');
  const valorDebitar = lerValor(req.body.valor);

  if (!pedidoId || !valorDebitar) {
    return res.status(400).json({ erro: 'Dados de débito inválidos.' });
  }

  try {
    // A corrida precisa ser do próprio cliente e o valor precisa bater com o da corrida
    const pedido = await sql`
      SELECT id, valor_total FROM pedidos
      WHERE id::text = ${pedidoId}::text AND cliente_id::text = ${clienteId}::text
      LIMIT 1;
    `;
    if (!pedido.length) {
      return res.status(404).json({ erro: 'Corrida não localizada.' });
    }
    if (Math.abs(Number(pedido[0].valor_total) - valorDebitar) > 0.01) {
      return res.status(400).json({ erro: 'O valor informado não confere com o valor da corrida.' });
    }

    // Débito + extrato num único comando; não debita duas vezes a mesma corrida
    const r = await sql`
      WITH d AS (
        UPDATE usuarios
           SET saldo_carteira = COALESCE(saldo_carteira, 0) - ${valorDebitar}::numeric
         WHERE id::text = ${clienteId}::text
           AND COALESCE(saldo_carteira, 0) >= ${valorDebitar}::numeric
           AND NOT EXISTS (
             SELECT 1 FROM transacoes_carteira
              WHERE pedido_id = ${pedidoId}::text
                AND tipo_transacao = 'pagamento_corrida'
                AND usuario_id::text = ${clienteId}::text
           )
        RETURNING saldo_carteira
      ),
      t AS (
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        SELECT ${clienteId}::text, 'cliente', 'pagamento_corrida', ${-valorDebitar}::numeric, ${pedidoId}::text FROM d
      )
      SELECT saldo_carteira FROM d;
    `;

    if (!r.length) {
      const ja = await sql`
        SELECT 1 FROM transacoes_carteira
        WHERE pedido_id = ${pedidoId}::text AND tipo_transacao = 'pagamento_corrida'
          AND usuario_id::text = ${clienteId}::text
        LIMIT 1;
      `;
      if (ja.length) return res.status(409).json({ erro: 'Esta corrida já foi paga com a carteira.' });

      const cli = await sql`SELECT saldo_carteira FROM usuarios WHERE id::text = ${clienteId}::text LIMIT 1;`;
      return res.status(400).json({
        erro: `Saldo insuficiente na carteira. Saldo atual: R$ ${brl(cli[0]?.saldo_carteira || 0)}`
      });
    }

    res.json({
      sucesso: true,
      mensagem: 'Valor debitado com sucesso da carteira digital.',
      novoSaldo: Number(r[0].saldo_carteira)
    });
  } catch (err) {
    console.error('Erro ao debitar corrida da carteira:', err);
    res.status(500).json({ erro: 'Falha ao debitar saldo.' });
  }
});

router.post('/gorjeta', autenticarToken, async (req, res) => {
  const clienteId = String(req.usuario.id);
  const pedidoId = String(req.body.pedidoId || '');
  const gorjetaNum = lerValor(req.body.valorGorjeta, 500);

  if (!pedidoId || !gorjetaNum) {
    return res.status(400).json({ erro: 'Dados de gorjeta inválidos.' });
  }

  try {
    const pedido = await sql`
      SELECT id, motorista_id FROM pedidos
      WHERE id::text = ${pedidoId}::text AND cliente_id::text = ${clienteId}::text AND status = 'concluido'
      LIMIT 1;
    `;
    if (!pedido.length) {
      return res.status(404).json({ erro: 'Viagem concluída não localizada.' });
    }

    const motoristaId = pedido[0].motorista_id ? String(pedido[0].motorista_id) : null;
    if (!motoristaId) {
      return res.status(400).json({ erro: 'Motorista não vinculado à viagem.' });
    }

    // Débito do cliente + crédito do motorista + extrato: tudo num único comando
    const r = await sql`
      WITH d AS (
        UPDATE usuarios
           SET saldo_carteira = COALESCE(saldo_carteira, 0) - ${gorjetaNum}::numeric
         WHERE id::text = ${clienteId}::text
           AND COALESCE(saldo_carteira, 0) >= ${gorjetaNum}::numeric
        RETURNING id
      ),
      m AS (
        UPDATE motoristas
           SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${gorjetaNum}::numeric
         WHERE id::text = ${motoristaId}::text AND EXISTS (SELECT 1 FROM d)
        RETURNING id
      ),
      p AS (
        UPDATE pedidos
           SET valor_gorjeta = COALESCE(valor_gorjeta, 0) + ${gorjetaNum}::numeric
         WHERE id::text = ${pedidoId}::text AND EXISTS (SELECT 1 FROM d)
        RETURNING id
      ),
      t1 AS (
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        SELECT ${clienteId}::text, 'cliente', 'gorjeta_paga', ${-gorjetaNum}::numeric, ${pedidoId}::text
         WHERE EXISTS (SELECT 1 FROM d)
      ),
      t2 AS (
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        SELECT ${motoristaId}::text, 'motorista', 'gorjeta_recebida', ${gorjetaNum}::numeric, ${pedidoId}::text
         WHERE EXISTS (SELECT 1 FROM d)
      )
      SELECT id FROM d;
    `;

    if (!r.length) {
      return res.status(400).json({ erro: 'Saldo insuficiente na carteira para enviar gorjeta.' });
    }

    res.json({ sucesso: true, mensagem: 'Gorjeta enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao enviar gorjeta:', err);
    res.status(500).json({ erro: 'Falha ao processar gorjeta.' });
  }
});

export default router;