// routes/carteira.routes.js - Carteira Digital, Pix Mercado Pago & Saques HUBy
// VERSÃO SINCRONIZADA: Liquidação automática de corridas Pix com repasse de 85% ao motorista e aviso em tempo real
import express from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { lerTarifasDoBanco, extrairObjetoJSONB } from './admin.routes.js';

const router = express.Router();

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// ============================================================================
// AUXILIARES
// ============================================================================
function ehAdmin(req) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  return role === 'admin' || role === 'administrador';
}

function verificarAdmin(req, res, next) {
  if (!ehAdmin(req)) {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

function lerValor(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function paraReais(n) {
  return Number(n || 0).toFixed(2).replace('.', ',');
}

function obterIo(req) {
  return req.io || req.app.get('io') || null;
}

function idsDoToken(req) {
  return [req.usuario?.id, req.usuario?.motoristaId].filter(Boolean).map(String);
}

async function buscarMotoristaAutorizado(req, res, idParam, { somenteDono = false } = {}) {
  const motoristas = await sql`
    SELECT id, usuario_id, nome, saldo_carteira, chave_pix_padrao
    FROM motoristas
    WHERE id::text = ${String(idParam)}::text OR usuario_id::text = ${String(idParam)}::text
    LIMIT 1;
  `;

  if (!motoristas.length) {
    res.status(404).json({ erro: 'Motorista parceiro não localizado.' });
    return null;
  }

  const mot = motoristas[0];
  const ids = idsDoToken(req);
  const ehDono = ids.includes(String(mot.id)) || ids.includes(String(mot.usuario_id));

  if (!ehDono && (somenteDono || !ehAdmin(req))) {
    res.status(403).json({ erro: 'Você não tem permissão para acessar esta carteira.' });
    return null;
  }

  return mot;
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

// Cliente oficial do Mercado Pago (lê tanto variável de ambiente quanto JSONB do banco)
async function obterClienteMercadoPago() {
  try {
    let accessToken = process.env.MP_ACCESS_TOKEN || '';

    if (!accessToken) {
      const config = await sql`
        SELECT valor::text AS valor_txt FROM configuracoes_plataforma
        WHERE chave = 'gateway_mercadopago' LIMIT 1;
      `;
      const gw = extrairObjetoJSONB(config[0]?.valor_txt, {});
      accessToken = gw.access_token || '';
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

// ============================================================================
// LIQUIDAÇÃO DE PIX (usada pelo webhook e pela consulta de status)
// Só credita UMA vez, mesmo se webhook e polling chegarem ao mesmo tempo.
// ============================================================================
export async function liquidarCobrancaPix(cobrancaId, io) {
  const marcada = await sql`
    UPDATE cobrancas_pix
    SET status = 'pago'
    WHERE id = ${cobrancaId} AND status <> 'pago'
    RETURNING *;
  `;

  if (!marcada.length) return null; // já tinha sido liquidada por outra chamada

  const cobranca = marcada[0];
  const valorPago = Number(cobranca.valor);

  if (cobranca.pedido_id) {
    // CASO A: pagamento de corrida via Pix Mercado Pago
    const pedidoId = String(cobranca.pedido_id);

    const pedidos = await sql`
      UPDATE pedidos
      SET status = 'concluido',
          forma_pagamento = 'pix_mp',
          metodo_pgto = 'pix_mp',
          concluido_em = CURRENT_TIMESTAMP
      WHERE id::text = ${pedidoId}
      RETURNING id, motorista_id, valor_total;
    `;

    const pedido = pedidos[0];
    let motoristaId = pedido?.motorista_id;

    // Se por algum motivo motorista_id estiver vazio, localiza o motorista principal ativo
    if (!motoristaId) {
      const motFallback = await sql`SELECT id FROM motoristas ORDER BY status_online DESC, criado_em ASC LIMIT 1;`;
      motoristaId = motFallback[0]?.id || null;
    }

    const tarifas = await lerTarifasDoBanco();
    const taxaPct = Number(tarifas.taxa_plataforma ?? 15);
    const taxaPlataforma = Number(((valorPago * taxaPct) / 100).toFixed(2));
    const repasseMotorista = Number((valorPago - taxaPlataforma).toFixed(2));

    let novoSaldoMotorista = null;

    if (motoristaId) {
      const motAtualizado = await sql`
        UPDATE motoristas
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista},
            total_corridas = COALESCE(total_corridas, 0) + 1
        WHERE id::text = ${String(motoristaId)}::text
           OR usuario_id::text = ${String(motoristaId)}::text
        RETURNING id, saldo_carteira;
      `;

      novoSaldoMotorista = motAtualizado[0]?.saldo_carteira ?? null;
      const idRealMot = motAtualizado[0]?.id || motoristaId;

      try {
        await sql`
          INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
          VALUES (${String(idRealMot)}, 'motorista', 'credito_corrida_pix_mp', ${repasseMotorista}, ${pedidoId});
        `;
      } catch (eTrans) {}
    }

    if (io) {
      const payloadEvento = {
        sucesso: true,
        pedidoId,
        status: 'concluido',
        forma_pagamento: 'pix_mp',
        valorFinal: valorPago,
        repasseLiquido: repasseMotorista,
        taxaHuby: taxaPlataforma,
        novoSaldoCarteira: novoSaldoMotorista,
        mensagem: `Pagamento Pix de R$ ${paraReais(valorPago)} confirmado! Repasse de R$ ${paraReais(repasseMotorista)} creditado.`
      };
      io.emit(`corrida_finalizada_${pedidoId}`, payloadEvento);
      io.emit(`pix_confirmado_${pedidoId}`, payloadEvento);
      io.emit('corrida_finalizada', payloadEvento);
    }
  } else if (cobranca.usuario_id) {
    // CASO B: recarga de saldo do passageiro
    await sql`
      UPDATE usuarios
      SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${valorPago}
      WHERE id::text = ${String(cobranca.usuario_id)}::text;
    `;

    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor)
      VALUES (${String(cobranca.usuario_id)}, 'cliente', 'deposito_pix_mercadopago', ${valorPago});
    `;
  }

  return { ...cobranca, status: 'pago' };
}

// Pergunta ao Mercado Pago se o pagamento está aprovado e, se estiver, liquida.
async function confirmarPagamentoPix(cobranca, io) {
  if (cobranca.status === 'pago') return cobranca;

  const mp = await obterClienteMercadoPago();
  if (!mp || !mp.payment) return cobranca;

  const idConsulta = cobranca.txid || cobranca.transacao_id;
  if (!idConsulta) return cobranca;

  const info = await mp.payment.get({ id: String(idConsulta) });
  if (info.status !== 'approved') return cobranca;

  if (Number(info.transaction_amount) + 0.001 < Number(cobranca.valor)) {
    console.warn(`Pix ${idConsulta}: valor pago menor que o cobrado. Ignorado.`);
    return cobranca;
  }

  const liquidada = await liquidarCobrancaPix(cobranca.id, io);
  return liquidada || { ...cobranca, status: 'pago' };
}

function assinaturaWebhookValida(req) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true;

  const assinatura = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();

  const partes = {};
  for (const trecho of assinatura.split(',')) {
    const [chave, valor] = trecho.trim().split('=');
    if (chave && valor) partes[chave] = valor;
  }

  if (!partes.ts || !partes.v1 || !dataId) return false;

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
    const role = String(req.usuario.role || req.usuario.funcao || '').toLowerCase();

    let saldo = 0;
    if (role === 'motorista') {
      const mot = await sql`
        SELECT saldo_carteira FROM motoristas
        WHERE id::text = ${String(usuarioId)}::text OR usuario_id::text = ${String(usuarioId)}::text
        LIMIT 1;
      `;
      saldo = Number(mot[0]?.saldo_carteira || 0);
    } else {
      const cli = await sql`
        SELECT saldo_carteira FROM usuarios
        WHERE id::text = ${String(usuarioId)}::text
        LIMIT 1;
      `;
      saldo = Number(cli[0]?.saldo_carteira || 0);
    }

    const historico = await sql`
      SELECT id, tipo_transacao, valor, pedido_id, criado_em
      FROM transacoes_carteira
      WHERE usuario_id::text = ${String(usuarioId)}::text
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
// 2. PIX (MERCADO PAGO REAL)
// ============================================================================
router.post('/pix/gerar', autenticarToken, async (req, res) => {
  try {
    const usuarioId = String(req.usuario.id);
    const { valor, pedidoId } = req.body;
    let valorNum = lerValor(valor);

    if (pedidoId) {
      const pedido = await sql`
        SELECT valor_total FROM pedidos
        WHERE id::text = ${String(pedidoId)}::text
        LIMIT 1;
      `;
      if (!pedido.length) {
        return res.status(404).json({ erro: 'Corrida não localizada.' });
      }
      valorNum = lerValor(pedido[0].valor_total);
    }

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

    const cpfLimpo = String(dadosUser.cpf || '').replace(/\D/g, '');

    const mp = await obterClienteMercadoPago();
    if (!mp || !mp.payment) {
      return res.status(500).json({ erro: 'Pagamento Pix indisponível no momento.' });
    }

    const notificationUrl = `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`;

    const payerObj = {
      email: emailLimpo,
      first_name: primeiroNome,
      last_name: sobrenome
    };
    if (cpfLimpo.length === 11) {
      payerObj.identification = { type: 'CPF', number: cpfLimpo };
    }

    const bodyMP = {
      transaction_amount: valorNum,
      description: `HUBy Mobilidade - ${pedidoId ? `Corrida #${pedidoId}` : 'Recarga de carteira'}`,
      payment_method_id: 'pix',
      payer: payerObj,
      notification_url: notificationUrl
    };

    const mpRes = await mp.payment.create({ body: bodyMP });
    const txid = String(mpRes.id);
    const copiaCola = mpRes.point_of_interaction?.transaction_data?.qr_code;
    const qrCodeBase64 = mpRes.point_of_interaction?.transaction_data?.qr_code_base64;
    const qrCodeUrl = qrCodeBase64
      ? `data:image/png;base64,${qrCodeBase64}`
      : `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(copiaCola)}`;
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000);

    await sql`
      INSERT INTO cobrancas_pix (txid, transacao_id, usuario_id, pedido_id, valor, status, pix_copia_cola, qr_code, qr_code_base64, expira_em)
      VALUES (${txid}, ${txid}, ${usuarioId}, ${pedidoId ? String(pedidoId) : null}, ${valorNum}, 'pendente', ${copiaCola}, ${copiaCola}, ${qrCodeBase64}, ${expiraEm})
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
    return res.status(500).json({ erro: 'Falha ao gerar o Pix. Tente novamente.' });
  }
});

// Webhook do Mercado Pago (confirmação automática)
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    if (!assinaturaWebhookValida(req)) {
      console.warn('Webhook MP com assinatura inválida.');
      return res.status(401).send('Assinatura inválida');
    }

    const paymentId = String(req.body?.data?.id || req.query['data.id'] || req.query.id || req.body?.id || '');
    if (!paymentId) return res.status(200).send('OK');

    const cobrancas = await sql`
      SELECT * FROM cobrancas_pix
      WHERE txid = ${paymentId} OR transacao_id = ${paymentId}
      LIMIT 1;
    `;

    if (cobrancas.length) {
      await confirmarPagamentoPix(cobrancas[0], obterIo(req));
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no processamento do Webhook MP:', err.message);
    return res.status(200).send('OK');
  }
});

// Consulta de status (polling do app do passageiro OU do motorista)
router.get('/pix/status/:txid', autenticarToken, async (req, res) => {
  try {
    const { txid } = req.params;
    const cobrancas = await sql`
      SELECT id, COALESCE(txid, transacao_id) AS txid, transacao_id, usuario_id, pedido_id, valor, status, expira_em
      FROM cobrancas_pix
      WHERE txid = ${txid} OR transacao_id = ${txid}
      LIMIT 1;
    `;

    if (!cobrancas.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não localizada.' });
    }

    let atual = cobrancas[0];
    try {
      atual = await confirmarPagamentoPix(atual, obterIo(req));
    } catch (e) {
      console.warn('Não foi possível consultar o MP agora:', e.message);
    }

    res.json({
      txid: atual.txid || atual.transacao_id,
      pedido_id: atual.pedido_id,
      valor: atual.valor,
      status: atual.status,
      expira_em: atual.expira_em
    });
  } catch (err) {
    console.error('Erro ao consultar status do Pix:', err);
    res.status(500).json({ erro: 'Falha ao consultar status do Pix.' });
  }
});

router.post('/pix/simular-pagamento', autenticarToken, async (req, res) => {
  if (EM_PRODUCAO || process.env.PIX_SIMULACAO !== 'true') {
    return res.status(403).json({ erro: 'Simulação de pagamento desativada.' });
  }

  const usuarioId = String(req.usuario.id);
  const { txid } = req.body;

  if (!txid) {
    return res.status(400).json({ erro: 'Identificador Pix (txid) obrigatório.' });
  }

  try {
    const cobs = await sql`
      SELECT id FROM cobrancas_pix
      WHERE (txid = ${String(txid)} OR transacao_id = ${String(txid)})
      LIMIT 1;
    `;

    if (!cobs.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não encontrada.' });
    }

    const liquidada = await liquidarCobrancaPix(cobs[0].id, obterIo(req));
    if (!liquidada) {
      return res.json({ sucesso: true, mensagem: 'Essa cobrança já foi processada anteriormente.' });
    }

    res.json({ sucesso: true, mensagem: 'Pagamento Pix (TESTE) confirmado.' });
  } catch (err) {
    console.error('Erro na simulação de Pix:', err);
    res.status(500).json({ erro: 'Falha ao simular Pix.' });
  }
});

// ============================================================================
// 3. CARTEIRA E SAQUES DO MOTORISTA
// ============================================================================
router.get('/motorista/:id', autenticarToken, async (req, res) => {
  try {
    const mot = await buscarMotoristaAutorizado(req, res, req.params.id);
    if (!mot) return;

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em, pago_em, motivo_recusa
      FROM saques_motoristas
      WHERE motorista_id::text = ${String(mot.id)}::text
      ORDER BY criado_em DESC
      LIMIT 25;
    `;

    res.json({
      sucesso: true,
      saldo: Number(mot.saldo_carteira || 0),
      chave_pix: mot.chave_pix_padrao || '',
      saques
    });
  } catch (err) {
    console.error('Erro ao buscar carteira do condutor:', err);
    res.status(500).json({ erro: 'Falha ao carregar dados bancários do motorista.' });
  }
});

router.post('/motorista/:id/saque', autenticarToken, async (req, res) => {
  const valorNum = lerValor(req.body.valor);
  const chavePix = String(req.body.chave_pix || '').trim();
  const tipoChave = String(req.body.tipo_chave || 'pix').trim().slice(0, 20);

  if (!valorNum || valorNum <= 0) {
    return res.status(400).json({ erro: 'Informe um valor de saque válido.' });
  }
  if (!chavePix || chavePix.length > 150) {
    return res.status(400).json({ erro: 'A chave Pix para recebimento é obrigatória.' });
  }

  try {
    const mot = await buscarMotoristaAutorizado(req, res, req.params.id, { somenteDono: true });
    if (!mot) return;

    const debitado = await sql`
      UPDATE motoristas
      SET saldo_carteira = saldo_carteira - ${valorNum},
          chave_pix_padrao = ${chavePix}
      WHERE id = ${mot.id} AND COALESCE(saldo_carteira, 0) >= ${valorNum}
      RETURNING saldo_carteira;
    `;

    if (!debitado.length) {
      return res.status(400).json({
        erro: `Saldo insuficiente. Disponível: R$ ${paraReais(mot.saldo_carteira)}`
      });
    }

    const novoSaldo = Number(debitado[0].saldo_carteira);

    try {
      const saque = await sql`
        INSERT INTO saques_motoristas (motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status)
        VALUES (${mot.id}, ${mot.nome}, ${chavePix}, ${tipoChave}, ${valorNum}, 'pendente')
        RETURNING id;
      `;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${mot.id}, 'motorista', 'solicitacao_saque_pix', ${-valorNum}, ${String(saque[0].id)});
      `;

      return res.json({
        sucesso: true,
        mensagem: `Solicitação de saque de R$ ${paraReais(valorNum)} enviada para a administração!`,
        novoSaldo,
        saqueId: saque[0].id
      });
    } catch (erroRegistro) {
      await sql`UPDATE motoristas SET saldo_carteira = saldo_carteira + ${valorNum} WHERE id = ${mot.id};`;
      throw erroRegistro;
    }
  } catch (err) {
    console.error('Erro na solicitação de saque:', err);
    if (!res.headersSent) {
      res.status(500).json({ erro: 'Falha ao processar solicitação de saque.' });
    }
  }
});

// ============================================================================
// 4. PAINEL DO ADMINISTRADOR: APROVAÇÃO E GESTÃO FINANCEIRA
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
  const { id } = req.params;
  const { status, motivo_recusa } = req.body;

  if (!['pago', 'recusado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Escolha "pago" ou "recusado".' });
  }

  try {
    let atualizado;
    if (status === 'pago') {
      atualizado = await sql`
        UPDATE saques_motoristas
        SET status = 'pago', pago_em = CURRENT_TIMESTAMP
        WHERE id = ${id} AND status = 'pendente'
        RETURNING *;
      `;
    } else {
      const motivo = String(motivo_recusa || 'Dados bancários inconsistentes').slice(0, 200);
      atualizado = await sql`
        UPDATE saques_motoristas
        SET status = 'recusado', motivo_recusa = ${motivo}
        WHERE id = ${id} AND status = 'pendente'
        RETURNING *;
      `;
    }

    if (!atualizado.length) {
      const existente = await sql`SELECT status FROM saques_motoristas WHERE id = ${id} LIMIT 1;`;
      if (!existente.length) {
        return res.status(404).json({ erro: 'Solicitação de saque não encontrada.' });
      }
      return res.status(400).json({ erro: `Este saque já foi finalizado como '${existente[0].status}'.` });
    }

    const saque = atualizado[0];

    if (status === 'recusado') {
      await sql`
        UPDATE motoristas
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${saque.valor}
        WHERE id = ${saque.motorista_id};
      `;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${saque.motorista_id}, 'motorista', 'estorno_saque_recusado', ${saque.valor}, ${String(id)});
      `;
    }

    res.json({ sucesso: true, statusAtualizado: status });
  } catch (err) {
    console.error('Erro ao aprovar/recusar saque:', err);
    res.status(500).json({ erro: 'Falha ao atualizar status do saque.' });
  }
});

// ============================================================================
// 5. PAGAMENTO DE CORRIDA PELA CARTEIRA E GORJETAS
// ============================================================================
router.post('/debito-corrida', autenticarToken, async (req, res) => {
  const clienteId = String(req.usuario.id);
  const { pedidoId } = req.body;

  if (!pedidoId) {
    return res.status(400).json({ erro: 'Dados de débito inválidos.' });
  }

  try {
    const reservada = await sql`
      UPDATE pedidos
      SET forma_pagamento = 'carteira'
      WHERE id::text = ${String(pedidoId)}::text
        AND cliente_id::text = ${clienteId}::text
        AND COALESCE(forma_pagamento, '') = ''
      RETURNING id, valor_total;
    `;

    if (!reservada.length) {
      return res.status(409).json({ erro: 'Corrida não encontrada ou já paga.' });
    }

    const valorDebitar = lerValor(reservada[0].valor_total);

    const debitado = await sql`
      UPDATE usuarios
      SET saldo_carteira = saldo_carteira - ${valorDebitar}
      WHERE id::text = ${clienteId}::text AND COALESCE(saldo_carteira, 0) >= ${valorDebitar}
      RETURNING saldo_carteira;
    `;

    if (!debitado.length) {
      await sql`UPDATE pedidos SET forma_pagamento = NULL WHERE id::text = ${String(pedidoId)}::text;`;
      const saldo = await sql`SELECT saldo_carteira FROM usuarios WHERE id::text = ${clienteId}::text LIMIT 1;`;
      return res.status(400).json({
        erro: `Saldo insuficiente na carteira. Saldo atual: R$ ${paraReais(saldo[0]?.saldo_carteira)}`
      });
    }

    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
      VALUES (${clienteId}, 'cliente', 'pagamento_corrida', ${-valorDebitar}, ${String(pedidoId)});
    `;

    res.json({
      sucesso: true,
      mensagem: 'Valor debitado com sucesso da carteira digital.',
      valorDebitado: valorDebitar,
      novoSaldo: Number(debitado[0].saldo_carteira)
    });
  } catch (err) {
    console.error('Erro ao debitar corrida da carteira:', err);
    res.status(500).json({ erro: 'Falha ao debitar saldo.' });
  }
});

router.post('/gorjeta', autenticarToken, async (req, res) => {
  const clienteId = String(req.usuario.id);
  const { pedidoId } = req.body;
  const gorjetaNum = lerValor(req.body.valorGorjeta);

  if (!pedidoId || !gorjetaNum || gorjetaNum <= 0) {
    return res.status(400).json({ erro: 'Dados de gorjeta inválidos.' });
  }

  try {
    const pedido = await sql`
      SELECT id, motorista_id FROM pedidos
      WHERE id::text = ${String(pedidoId)}::text
        AND cliente_id::text = ${clienteId}::text
        AND status = 'concluido'
      LIMIT 1;
    `;

    if (!pedido.length) {
      return res.status(404).json({ erro: 'Viagem concluída não localizada.' });
    }

    const motoristaId = pedido[0].motorista_id;
    if (!motoristaId) {
      return res.status(400).json({ erro: 'Motorista não vinculado à viagem.' });
    }

    const debitado = await sql`
      UPDATE usuarios
      SET saldo_carteira = saldo_carteira - ${gorjetaNum}
      WHERE id::text = ${clienteId}::text AND COALESCE(saldo_carteira, 0) >= ${gorjetaNum}
      RETURNING saldo_carteira;
    `;

    if (!debitado.length) {
      return res.status(400).json({ erro: 'Saldo insuficiente na carteira para enviar gorjeta.' });
    }

    try {
      await sql`UPDATE motoristas SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${gorjetaNum} WHERE id::text = ${String(motoristaId)}::text;`;
      await sql`UPDATE pedidos SET valor_gorjeta = COALESCE(valor_gorjeta, 0) + ${gorjetaNum} WHERE id::text = ${String(pedidoId)}::text;`;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES
          (${clienteId}, 'cliente', 'gorjeta_paga', ${-gorjetaNum}, ${String(pedidoId)}),
          (${String(motoristaId)}, 'motorista', 'gorjeta_recebida', ${gorjetaNum}, ${String(pedidoId)});
      `;
    } catch (erroRepasse) {
      await sql`UPDATE usuarios SET saldo_carteira = saldo_carteira + ${gorjetaNum} WHERE id::text = ${clienteId}::text;`;
      throw erroRepasse;
    }

    res.json({ sucesso: true, mensagem: 'Gorjeta enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao enviar gorjeta:', err);
    res.status(500).json({ erro: 'Falha ao processar gorjeta.' });
  }
});

export default router;