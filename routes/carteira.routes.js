// routes/carteira.routes.js - Carteira Digital, Pix Mercado Pago & Saques Automáticos HUBy
// VERSÃO BLINDADA: Consulta direta na API do Mercado Pago + Cash-Out Pix Automático e em Lote
import express from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { lerTarifasDoBanco, extrairObjetoJSONB } from './admin.routes.js';

const router = express.Router();
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

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
// 0. MIGRAÇÃO COMPLETA DE TODAS AS COLUNAS DE CARTEIRA, PIX E SAQUES
// ============================================================================
export async function garantirEstruturaCobrancasPix() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf VARCHAR(20);`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_gorjeta NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_txid TEXT;`;

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
        transacao_id VARCHAR(64),
        txid VARCHAR(64),
        pedido_id TEXT,
        usuario_id TEXT,
        valor NUMERIC(10,2) NOT NULL DEFAULT 0.00,
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

    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS transacao_id VARCHAR(64);`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS txid VARCHAR(64);`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pedido_id TEXT;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS valor NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente';`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS qr_code TEXT;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS qr_code_base64 TEXT;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS expira_em TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '15 minutes');`;
    await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`;

    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS comprovante_url TEXT;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS motivo_recusa TEXT;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS solicitado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS pago_em TIMESTAMP WITH TIME ZONE;`;
  } catch (err) {
    console.warn('Aviso na migração cobrancas_pix / saques:', err.message);
  }
}
garantirEstruturaCobrancasPix();

export async function obterClienteMercadoPago() {
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
      return null;
    }

    const client = new MercadoPagoConfig({ accessToken });
    return { client, payment: new Payment(client), accessToken };
  } catch (err) {
    return null;
  }
}

// ============================================================================
// MOTOR DE TRANSFERÊNCIA PIX AUTOMÁTICA (CASH-OUT API MERCADO PAGO)
// ============================================================================
function normalizarTipoChaveMP(tipo, chave) {
  const t = String(tipo || '').toLowerCase().trim();
  const c = String(chave || '').trim();

  if (t === 'email' || c.includes('@')) return { type: 'EMAIL', value: c };
  if (t === 'aleatoria' || t === 'evp' || (c.includes('-') && c.length >= 32)) return { type: 'EVP', value: c };

  const apenasNumeros = c.replace(/\D/g, '');
  if (t === 'telefone' || t === 'celular') {
    const fone = apenasNumeros.startsWith('55') ? `+${apenasNumeros}` : `+55${apenasNumeros}`;
    return { type: 'PHONE', value: fone };
  }
  if (apenasNumeros.length === 14) {
    return { type: 'CNPJ', value: apenasNumeros };
  }
  return { type: 'CPF', value: apenasNumeros };
}

export async function executarTransferenciaPixMercadoPago({ saqueId, valor, chavePix, tipoChave, motoristaNome }) {
  const mp = await obterClienteMercadoPago();
  if (!mp || !mp.accessToken) {
    return { enviado: false, motivo: 'Access Token do Mercado Pago não configurado.' };
  }

  const destino = normalizarTipoChaveMP(tipoChave, chavePix);
  const idempotencyKey = `huby_saque_${saqueId}_${Date.now()}`;

  try {
    const resp = await fetch('https://api.mercadopago.com/v1/transaction-intents/process', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mp.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        external_reference: `saque_${saqueId}`,
        point_of_interaction: {
          type: 'PIX_TRANSFER'
        },
        transaction: {
          from: { accounts: [{ amount: Number(valor) }] },
          to: {
            accounts: [{
              amount: Number(valor),
              chave_pix: destino.value,
              pix_key_type: destino.type,
              owner: { name: motoristaNome || 'Motorista Parceiro' }
            }]
          },
          total_amount: Number(valor)
        }
      })
    });

    const dados = await resp.json().catch(() => ({}));

    if (resp.ok && (dados.id || dados.status === 'approved' || dados.status === 'processing' || dados.status === 'created')) {
      return {
        enviado: true,
        comprovanteId: String(dados.id || idempotencyKey),
        statusMP: dados.status || 'approved'
      };
    }

    return {
      enviado: false,
      motivo: dados.message || dados.error || `API MP status ${resp.status} (Payouts Pix requer liberação na conta MP).`
    };
  } catch (err) {
    return { enviado: false, motivo: err.message };
  }
}

// ============================================================================
// FUNÇÃO CENTRAL E IDEMPOTENTE QUE LIQUIDA O PEDIDO E CREDITA OS 85% DO MOTORISTA
// ============================================================================
export async function liquidarCorridaPixPorPedidoId(pedidoId, valorPagoMP, txid, io) {
  if (!pedidoId) return null;
  const idLimpo = String(pedidoId).trim();

  const pedidosAtualizados = await sql`
    UPDATE pedidos
    SET status = 'concluido',
        forma_pagamento = 'pix_mp',
        metodo_pgto = 'pix_mp',
        concluido_em = CURRENT_TIMESTAMP
    WHERE id::text = ${idLimpo}
      AND LOWER(COALESCE(status, '')) <> 'concluido'
    RETURNING id, motorista_id, valor_total;
  `;

  if (txid) {
    try {
      await sql`
        UPDATE cobrancas_pix
        SET status = 'pago'
        WHERE txid = ${String(txid)} OR transacao_id = ${String(txid)} OR pedido_id = ${idLimpo};
      `;
    } catch (e) {}
  }

  if (!pedidosAtualizados.length) {
    const jaConcluido = await sql`SELECT id, motorista_id, valor_total, status FROM pedidos WHERE id::text = ${idLimpo} LIMIT 1;`;
    if (jaConcluido.length && String(jaConcluido[0].status).toLowerCase() === 'concluido') {
      const vTotal = Number(jaConcluido[0].valor_total || valorPagoMP || 0);
      const tarifas = await lerTarifasDoBanco();
      const taxaPct = Number(tarifas.taxa_plataforma ?? 15);
      const repasse = Number((vTotal * ((100 - taxaPct) / 100)).toFixed(2));
      if (io) {
        const payload = {
          sucesso: true,
          pedidoId: idLimpo,
          status: 'concluido',
          forma_pagamento: 'pix_mp',
          valorFinal: vTotal,
          repasseLiquido: repasse
        };
        io.emit(`corrida_finalizada_${idLimpo}`, payload);
        io.emit(`pix_confirmado_${idLimpo}`, payload);
        io.emit('corrida_finalizada', payload);
      }
      return { jaEstavaConcluido: true, valorFinal: vTotal, repasseLiquido: repasse };
    }
    return null;
  }

  const pedido = pedidosAtualizados[0];
  const valorBase = Number(pedido.valor_total || valorPagoMP || 0);
  let motoristaId = pedido.motorista_id;

  if (!motoristaId) {
    const motFallback = await sql`SELECT id FROM motoristas ORDER BY status_online DESC, criado_em ASC LIMIT 1;`;
    motoristaId = motFallback[0]?.id || null;
  }

  const tarifas = await lerTarifasDoBanco();
  const taxaPct = Number(tarifas.taxa_plataforma ?? 15);
  const taxaPlataforma = Number(((valorBase * taxaPct) / 100).toFixed(2));
  const repasseMotorista = Number((valorBase - taxaPlataforma).toFixed(2));

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
        VALUES (${String(idRealMot)}, 'motorista', 'credito_corrida_pix_mp', ${repasseMotorista}, ${idLimpo});
      `;
    } catch (eTrans) {}
  }

  const payloadEvento = {
    sucesso: true,
    pedidoId: idLimpo,
    status: 'concluido',
    forma_pagamento: 'pix_mp',
    valorFinal: valorBase,
    repasseLiquido: repasseMotorista,
    taxaHuby: taxaPlataforma,
    novoSaldoCarteira: novoSaldoMotorista,
    mensagem: `Pix de R$ ${paraReais(valorBase)} confirmado! +R$ ${paraReais(repasseMotorista)} na carteira.`
  };

  if (io) {
    io.emit(`corrida_finalizada_${idLimpo}`, payloadEvento);
    io.emit(`pix_confirmado_${idLimpo}`, payloadEvento);
    io.emit('corrida_finalizada', payloadEvento);
  }

  return payloadEvento;
}

export async function liquidarCobrancaPix(cobrancaId, io) {
  const cobs = await sql`SELECT * FROM cobrancas_pix WHERE id = ${cobrancaId} LIMIT 1;`;
  if (!cobs.length) return null;
  const cobranca = cobs[0];

  if (cobranca.pedido_id) {
    await liquidarCorridaPixPorPedidoId(cobranca.pedido_id, cobranca.valor, cobranca.txid || cobranca.transacao_id, io);
    await sql`UPDATE cobrancas_pix SET status = 'pago' WHERE id = ${cobrancaId};`;
    return { ...cobranca, status: 'pago' };
  }

  const marcada = await sql`
    UPDATE cobrancas_pix
    SET status = 'pago'
    WHERE id = ${cobrancaId} AND status <> 'pago'
    RETURNING *;
  `;
  if (!marcada.length) return { ...cobranca, status: 'pago' };

  const valorPago = Number(cobranca.valor);
  if (cobranca.usuario_id) {
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
      description: pedidoId ? `HUBy - Corrida #${pedidoId}` : 'HUBy Mobilidade - Recarga de carteira',
      external_reference: pedidoId ? String(pedidoId) : `recarga_${usuarioId}`,
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

    try {
      await garantirEstruturaCobrancasPix();
      await sql`
        INSERT INTO cobrancas_pix (txid, transacao_id, usuario_id, pedido_id, valor, status, pix_copia_cola, qr_code, qr_code_base64, expira_em)
        VALUES (${txid}, ${txid}, ${usuarioId}, ${pedidoId ? String(pedidoId) : null}, ${valorNum}, 'pendente', ${copiaCola}, ${copiaCola}, ${qrCodeBase64}, ${expiraEm});
      `;
    } catch (eDb) {
      console.warn('Aviso ao gravar cobrancas_pix:', eDb.message);
    }

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

// ============================================================================
// WEBHOOK DO MERCADO PAGO
// ============================================================================
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    const paymentId = String(req.body?.data?.id || req.query['data.id'] || req.query.id || req.body?.id || '');
    if (!paymentId) return res.status(200).send('OK');

    const mp = await obterClienteMercadoPago();
    if (!mp || !mp.payment) return res.status(200).send('OK');

    const info = await mp.payment.get({ id: paymentId });
    if (info.status === 'approved') {
      const io = obterIo(req);
      let pedidoIdExtraido = info.external_reference || null;
      if (!pedidoIdExtraido && info.description) {
        const match = String(info.description).match(/#(ped_[A-Za-z0-9_-]+)/i);
        if (match) pedidoIdExtraido = match[1];
      }

      if (pedidoIdExtraido && String(pedidoIdExtraido).startsWith('ped_')) {
        await liquidarCorridaPixPorPedidoId(pedidoIdExtraido, info.transaction_amount, paymentId, io);
      } else {
        const cobrancas = await sql`
          SELECT * FROM cobrancas_pix
          WHERE txid = ${paymentId} OR transacao_id = ${paymentId}
          LIMIT 1;
        `;
        if (cobrancas.length) {
          await liquidarCobrancaPix(cobrancas[0].id, io);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no processamento do Webhook MP:', err.message);
    return res.status(200).send('OK');
  }
});

// ============================================================================
// CONSULTA DE STATUS DO PIX EM TEMPO REAL
// ============================================================================
router.get('/pix/status/:txid', autenticarToken, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const { txid } = req.params;
    const pedidoIdQuery = req.query.pedidoId ? String(req.query.pedidoId).trim() : null;
    const io = obterIo(req);

    let cobranca = null;
    try {
      const cobrancas = await sql`
        SELECT * FROM cobrancas_pix
        WHERE txid = ${String(txid)} OR transacao_id = ${String(txid)}
        LIMIT 1;
      `;
      if (cobrancas.length) cobranca = cobrancas[0];
    } catch (e) {}

    if (cobranca && cobranca.status === 'pago') {
      if (cobranca.pedido_id || pedidoIdQuery) {
        await liquidarCorridaPixPorPedidoId(cobranca.pedido_id || pedidoIdQuery, cobranca.valor, txid, io);
      }
      return res.json({ txid, status: 'pago', valor: cobranca.valor });
    }

    const mp = await obterClienteMercadoPago();
    if (mp && mp.payment && txid && txid !== 'undefined' && txid !== 'null') {
      try {
        const info = await mp.payment.get({ id: String(txid) });
        if (info && info.status === 'approved') {
          let idPedidoAlvo = pedidoIdQuery || cobranca?.pedido_id || info.external_reference || null;
          if (!idPedidoAlvo && info.description) {
            const match = String(info.description).match(/#(ped_[A-Za-z0-9_-]+)/i);
            if (match) idPedidoAlvo = match[1];
          }

          if (idPedidoAlvo && String(idPedidoAlvo).startsWith('ped_')) {
            await liquidarCorridaPixPorPedidoId(idPedidoAlvo, info.transaction_amount, txid, io);
          } else if (cobranca) {
            await liquidarCobrancaPix(cobranca.id, io);
          }

          return res.json({
            txid,
            pedido_id: idPedidoAlvo,
            valor: info.transaction_amount,
            status: 'pago'
          });
        }

        return res.json({
          txid,
          valor: info?.transaction_amount || cobranca?.valor || 0,
          status: 'pendente'
        });
      } catch (errMP) {
        console.warn('Consulta MP por txid:', errMP.message);
      }
    }

    return res.json({
      txid,
      valor: cobranca?.valor || 0,
      status: cobranca?.status || 'pendente'
    });
  } catch (err) {
    console.error('Erro ao consultar status do Pix:', err);
    res.status(500).json({ erro: 'Falha ao consultar status do Pix.' });
  }
});

// ============================================================================
// 3. CARTEIRA E SAQUES DO MOTORISTA (COM TRANSFERÊNCIA PIX AUTOMÁTICA!)
// ============================================================================
router.get('/motorista/:id', autenticarToken, async (req, res) => {
  try {
    const mot = await buscarMotoristaAutorizado(req, res, req.params.id);
    if (!mot) return;

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em, pago_em, motivo_recusa, comprovante_url
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
    res.status(500).json({ erro: 'Falha ao carregar dados bancários do motorista.' });
  }
});

router.post('/motorista/:id/saque', autenticarToken, async (req, res) => {
  const valorNum = lerValor(req.body.valor);
  const chavePix = String(req.body.chave_pix || '').trim();
  const tipoChave = String(req.body.tipo_chave || 'cpf').trim().slice(0, 20);

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

      const saqueId = saque[0].id;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${mot.id}, 'motorista', 'solicitacao_saque_pix', ${-valorNum}, ${String(saqueId)});
      `;

      // Tenta executar o Cash-Out Pix automático na hora pela API do Mercado Pago
      const resultadoAuto = await executarTransferenciaPixMercadoPago({
        saqueId,
        valor: valorNum,
        chavePix,
        tipoChave,
        motoristaNome: mot.nome
      });

      const io = obterIo(req);

      if (resultadoAuto.enviado) {
        await sql`
          UPDATE saques_motoristas
          SET status = 'pago',
              comprovante_url = ${resultadoAuto.comprovanteId},
              pago_em = CURRENT_TIMESTAMP
          WHERE id = ${saqueId};
        `;

        if (io) {
          io.emit('saque_atualizado', { saqueId, status: 'pago', valor: valorNum, motorista: mot.nome });
        }

        return res.json({
          sucesso: true,
          pagoAutomatico: true,
          mensagem: `⚡ Pix de R$ ${paraReais(valorNum)} enviado automaticamente para sua chave ${chavePix}!`,
          novoSaldo,
          saqueId
        });
      }

      if (io) {
        io.emit('novo_saque_solicitado', {
          saqueId,
          motorista_nome: mot.nome,
          valor: valorNum,
          chave_pix: chavePix
        });
      }

      return res.json({
        sucesso: true,
        pagoAutomatico: false,
        mensagem: `Solicitação de saque de R$ ${paraReais(valorNum)} registrada e enviada para a fila de disparo!`,
        novoSaldo,
        saqueId
      });
    } catch (erroRegistro) {
      await sql`UPDATE motoristas SET saldo_carteira = saldo_carteira + ${valorNum} WHERE id = ${mot.id};`;
      throw erroRegistro;
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ erro: 'Falha ao processar solicitação de saque.' });
    }
  }
});

// ============================================================================
// 4. PAINEL DO ADMINISTRADOR: LIQUIDAÇÃO INDIVIDUAL E EM LOTE (50+ MOTORISTAS)
// ============================================================================
router.get('/admin/saques', autenticarToken, verificarAdmin, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const saques = await sql`
      SELECT id, motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status,
             COALESCE(criado_em, solicitado_em) AS criado_em, pago_em, motivo_recusa, comprovante_url
      FROM saques_motoristas
      ORDER BY
        CASE WHEN status = 'pendente' THEN 1 ELSE 2 END,
        COALESCE(criado_em, solicitado_em) DESC
      LIMIT 100;
    `;
    res.json(saques);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar solicitações de saque.' });
  }
});

// ROTA DE PAGAMENTO EM LOTE: Dispara e liquida TODOS os saques pendentes com 1 único clique
router.post('/admin/saques/pagar-lote', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const pendentes = await sql`
      SELECT * FROM saques_motoristas
      WHERE status = 'pendente'
      ORDER BY id ASC
      LIMIT 100;
    `;

    if (!pendentes.length) {
      return res.json({
        sucesso: true,
        processados: 0,
        enviadosViaApiMP: 0,
        mensagem: 'Não há saques pendentes na fila no momento.'
      });
    }

    let enviadosApi = 0;
    let marcadosPagos = 0;
    let ultimoAvisoApi = '';

    for (const s of pendentes) {
      const disp = await executarTransferenciaPixMercadoPago({
        saqueId: s.id,
        valor: s.valor,
        chavePix: s.chave_pix,
        tipoChave: s.tipo_chave,
        motoristaNome: s.motorista_nome
      });

      if (disp.enviado) {
        enviadosApi++;
      } else {
        ultimoAvisoApi = disp.motivo;
      }

      const upd = await sql`
        UPDATE saques_motoristas
        SET status = 'pago',
            comprovante_url = ${disp.comprovanteId || 'lote_admin'},
            pago_em = CURRENT_TIMESTAMP
        WHERE id = ${s.id} AND status = 'pendente'
        RETURNING id;
      `;
      if (upd.length) marcadosPagos++;
    }

    const io = obterIo(req);
    if (io) {
      io.emit('saque_atualizado', { lote: true, total: marcadosPagos });
    }

    return res.json({
      sucesso: true,
      processados: marcadosPagos,
      enviadosViaApiMP: enviadosApi,
      avisoApi: ultimoAvisoApi || null,
      mensagem: enviadosApi > 0
        ? `⚡ ${enviadosApi} transferência(s) Pix disparada(s) via API Mercado Pago e ${marcadosPagos} saque(s) liquidado(s)!`
        : `✅ ${marcadosPagos} saque(s) liquidado(s) em lote com sucesso!`
    });
  } catch (err) {
    console.error('Erro ao processar lote de saques:', err);
    res.status(500).json({ erro: 'Falha ao processar lote de saques.' });
  }
});

// ROTA INDIVIDUAL: Tenta disparo via API do Mercado Pago e atualiza status
router.put('/admin/saques/:id', autenticarToken, verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, motivo_recusa } = req.body;

  if (!['pago', 'recusado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Escolha "pago" ou "recusado".' });
  }

  try {
    const consulta = await sql`SELECT * FROM saques_motoristas WHERE id = ${id} LIMIT 1;`;
    if (!consulta.length) {
      return res.status(404).json({ erro: 'Solicitação de saque não encontrada.' });
    }
    const saqueAtual = consulta[0];
    if (saqueAtual.status !== 'pendente') {
      return res.status(400).json({ erro: `Este saque já foi finalizado como '${saqueAtual.status}'.` });
    }

    let atualizado;
    let infoTransferencia = null;

    if (status === 'pago') {
      infoTransferencia = await executarTransferenciaPixMercadoPago({
        saqueId: saqueAtual.id,
        valor: saqueAtual.valor,
        chavePix: saqueAtual.chave_pix,
        tipoChave: saqueAtual.tipo_chave,
        motoristaNome: saqueAtual.motorista_nome
      });

      atualizado = await sql`
        UPDATE saques_motoristas
        SET status = 'pago',
            comprovante_url = ${infoTransferencia.comprovanteId || 'aprovado_admin'},
            pago_em = CURRENT_TIMESTAMP
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
      return res.status(400).json({ erro: 'Este saque já foi processado.' });
    }

    const saque = atualizado[0];

    if (status === 'recusado') {
      await sql`
        UPDATE motoristas
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${saque.valor}
        WHERE id::text = ${String(saque.motorista_id)}::text;
      `;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${saque.motorista_id}, 'motorista', 'estorno_saque_recusado', ${saque.valor}, ${String(id)});
      `;
    }

    const io = obterIo(req);
    if (io) {
      io.emit('saque_atualizado', { saqueId: id, status });
    }

    res.json({
      sucesso: true,
      statusAtualizado: status,
      enviadoAutomaticoMP: Boolean(infoTransferencia?.enviado),
      mensagem: status === 'pago'
        ? (infoTransferencia?.enviado
            ? `⚡ Pix de R$ ${paraReais(saque.valor)} transferido automaticamente via API Mercado Pago!`
            : `✅ Saque #${id} marcado como PAGO!`)
        : 'Saque recusado e valor estornado para a carteira do motorista.'
    });
  } catch (err) {
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
    res.status(500).json({ erro: 'Falha ao processar gorjeta.' });
  }
});

export default router;