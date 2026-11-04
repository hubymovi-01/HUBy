// routes/carteira.routes.js - Carteira Digital Pré-Paga, Pix Real Mercado Pago & Saques Bancários HUBy
import express from 'express';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// ============================================================================
// 0. MIGRAÇÃO SEGURA PARA SUPORTE À CARTEIRA DIGITAL E SAQUES
// ============================================================================
async function inicializarTabelasCarteira() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
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

// Auxiliar: obtém cliente oficial do Mercado Pago via banco ou .env
async function obterClienteMercadoPago() {
  try {
    const config = await sql`
      SELECT valor FROM configuracoes_plataforma 
      WHERE chave = 'gateway_mercadopago' LIMIT 1;
    `;
    const accessToken = config[0]?.valor?.access_token || process.env.MP_ACCESS_TOKEN || '';
    if (!accessToken) return null;

    const client = new MercadoPagoConfig({ accessToken });
    return { client, payment: new Payment(client), taxaPercentual: Number(config[0]?.valor?.taxa_percentual || 0.99) };
  } catch (err) {
    console.warn('Não foi possível inicializar Mercado Pago:', err.message);
    return null;
  }
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
// 2. RECARGAS PIX (PASSAGEIRO COM MERCADO PAGO REAL & FALLBACK)
// ============================================================================
router.post('/pix/gerar', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { valor, pedidoId } = req.body;
    const valorNum = parseFloat(Number(valor).toFixed(2));

    if (!valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'O valor da recarga deve ser maior que zero.' });
    }

    const mp = await obterClienteMercadoPago();

    // 1. Caso o Mercado Pago esteja configurado, cria a cobrança real
    if (mp && mp.payment) {
      try {
        const bodyMP = {
          transaction_amount: valorNum,
          description: `HUBy Mobilidade - Recarga #${pedidoId || 'Avulso'}`,
          payment_method_id: 'pix',
          payer: {
            email: req.usuario.email || 'cliente@huby.app.br',
            first_name: req.usuario.nome ? req.usuario.nome.split(' ')[0] : 'Cliente',
            last_name: req.usuario.nome ? req.usuario.nome.split(' ').slice(1).join(' ') || 'HUBy' : 'HUBy'
          },
          notification_url: `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`
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
          INSERT INTO cobrancas_pix (txid, transacao_id, usuario_id, valor, status, pix_copia_cola, qr_code, qr_code_base64, expira_em)
          VALUES (${txid}, ${txid}, ${usuarioId}, ${valorNum}, 'pendente', ${copiaCola}, ${copiaCola}, ${qrCodeBase64}, ${expiraEm})
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
      } catch (mpErr) {
        console.warn('Falha na API do Mercado Pago, recorrendo ao gerador padrão:', mpErr.message);
      }
    }

    // 2. Fallback de contingência local se o token do Mercado Pago ainda não foi cadastrado
    const txid = `HUBY${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 32);
    const chavePix = 'pix@huby.app.br';
    const copiaCola = `00020101021226580014br.gov.bcb.pix0115${chavePix}520400005303986540${valorNum.toFixed(2).length < 5 ? '0' : ''}${valorNum.toFixed(2)}5802BR5904HUBY6008SAOJOAO62240520${txid}6304${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(copiaCola)}`;
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000);

    await sql`
      INSERT INTO cobrancas_pix (txid, transacao_id, usuario_id, valor, status, pix_copia_cola, expira_em)
      VALUES (${txid}, ${txid}, ${usuarioId}, ${valorNum}, 'pendente', ${copiaCola}, ${expiraEm});
    `;

    res.json({
      sucesso: true,
      gateway: 'local',
      txid,
      valor: valorNum,
      chavePix,
      copiaCola,
      qrCodeUrl,
      expiraEm
    });
  } catch (err) {
    console.error('Erro ao gerar Pix de recarga:', err);
    res.status(500).json({ erro: 'Não foi possível gerar a cobrança Pix.' });
  }
});

// ============================================================================
// WEBHOOK OFICIAL DO MERCADO PAGO (LIQUIDAÇÃO DE RECARGAS E DE CORRIDAS)
// ============================================================================
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    const { action, type, data } = req.body;
    const paymentId = data?.id || req.query['data.id'] || req.query.id || req.body?.id;

    if (type === 'payment' || action === 'payment.updated' || paymentId) {
      const mp = await obterClienteMercadoPago();
      if (mp && mp.payment && paymentId) {
        const info = await mp.payment.get({ id: paymentId });

        if (info.status === 'approved') {
          // Busca tanto por transacao_id quanto por txid
          const cobrancas = await sql`
            SELECT * FROM cobrancas_pix 
            WHERE transacao_id = ${String(paymentId)} 
               OR txid = ${String(paymentId)}
            LIMIT 1;
          `;

          if (cobrancas.length > 0 && cobrancas[0].status !== 'pago') {
            const cobranca = cobrancas[0];
            const valorPago = Number(cobranca.valor);

            // Marca cobrança como paga
            await sql`
              UPDATE cobrancas_pix 
              SET status = 'pago' 
              WHERE id = ${cobranca.id};
            `;

            // CASO A: Liquidando uma Corrida com QR Code Pix na tela
            if (cobranca.pedido_id) {
              const pedidoId = cobranca.pedido_id;

              await sql`
                UPDATE pedidos 
                SET status = 'concluido', 
                    forma_pagamento = 'pix_mp', 
                    concluido_em = CURRENT_TIMESTAMP 
                WHERE id::text = ${String(pedidoId)}::text;
              `;

              const io = req.app.get('io');
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
            // CASO B: Recarga de Saldo do Usuário/Passageiro
            else if (cobranca.usuario_id) {
              await sql`
                UPDATE usuarios 
                SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${valorPago}
                WHERE id::text = ${cobranca.usuario_id}::text;
              `;

              await sql`
                INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor)
                VALUES (${cobranca.usuario_id}, 'cliente', 'deposito_pix_mercadopago', ${valorPago});
              `;
            }
          }
        }
      }
    }
    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no processamento do Webhook MP:', err.message);
    return res.status(200).send('OK');
  }
});

router.get('/pix/status/:txid', autenticarToken, async (req, res) => {
  try {
    const { txid } = req.params;
    const cobranca = await sql`
      SELECT txid, valor, status, expira_em 
      FROM cobrancas_pix 
      WHERE txid = ${txid} OR transacao_id = ${txid}
      LIMIT 1;
    `;

    if (!cobranca.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não localizada.' });
    }

    if (cobranca[0].status === 'pago') {
      return res.json(cobranca[0]);
    }

    const mp = await obterClienteMercadoPago();
    if (mp && mp.payment && !isNaN(Number(txid))) {
      try {
        const info = await mp.payment.get({ id: txid });
        if (info.status === 'approved') {
          await sql`UPDATE cobrancas_pix SET status = 'pago' WHERE txid = ${txid} OR transacao_id = ${txid};`;
          cobranca[0].status = 'pago';
        }
      } catch (e) {}
    }

    res.json(cobranca[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar status do Pix.' });
  }
});

router.post('/pix/simular-pagamento', autenticarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const { txid } = req.body;

  if (!txid) {
    return res.status(400).json({ erro: 'Identificador Pix (txid) obrigatório.' });
  }

  try {
    const cobs = await sql`
      SELECT id, usuario_id, valor, status 
      FROM cobrancas_pix 
      WHERE (txid = ${txid} OR transacao_id = ${txid}) 
        AND usuario_id::text = ${usuarioId}::text
      LIMIT 1;
    `;

    if (!cobs.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não encontrada.' });
    }

    if (cobs[0].status === 'pago') {
      return res.json({ sucesso: true, mensagem: 'Essa recarga já foi processada anteriormente.' });
    }

    const valorCreditar = Number(cobs[0].valor);

    await sql`UPDATE cobrancas_pix SET status = 'pago' WHERE id = ${cobs[0].id};`;

    const userAtualizado = await sql`
      UPDATE usuarios 
      SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${valorCreditar}
      WHERE id::text = ${usuarioId}::text
      RETURNING saldo_carteira;
    `;

    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor)
      VALUES (${usuarioId}, 'cliente', 'deposito_pix', ${valorCreditar});
    `;

    res.json({
      sucesso: true,
      mensagem: 'Recarga confirmada com sucesso!',
      novoSaldo: Number(userAtualizado[0].saldo_carteira)
    });
  } catch (err) {
    console.error('Erro na confirmação da recarga Pix:', err);
    res.status(400).json({ erro: err.message || 'Falha ao confirmar liquidação Pix.' });
  }
});

// ============================================================================
// 3. CONTAS BANCÁRIAS E SAQUES DO MOTORISTA (SEQUENCIAL ATÔMICO NEON)
// ============================================================================
router.get('/motorista/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const motorista = await sql`
      SELECT id, nome, saldo_carteira, chave_pix_padrao 
      FROM motoristas 
      WHERE id::text = ${id}::text OR usuario_id::text = ${id}::text 
      LIMIT 1;
    `;

    if (!motorista.length) {
      return res.status(404).json({ erro: 'Motorista parceiro não localizado.' });
    }

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em, pago_em, motivo_recusa
      FROM saques_motoristas 
      WHERE motorista_id::text = ${motorista[0].id}::text 
      ORDER BY criado_em DESC 
      LIMIT 25;
    `;

    res.json({
      sucesso: true,
      saldo: Number(motorista[0].saldo_carteira || 0),
      chave_pix: motorista[0].chave_pix_padrao || '',
      saques
    });
  } catch (err) {
    console.error('Erro ao buscar carteira do condutor:', err);
    res.status(500).json({ erro: 'Falha ao carregar dados bancários do motorista.' });
  }
});

router.post('/motorista/:id/saque', async (req, res) => {
  const { id } = req.params;
  const { valor, chave_pix, tipo_chave } = req.body;
  const valorNum = parseFloat(Number(valor).toFixed(2));

  if (!valorNum || valorNum <= 0) {
    return res.status(400).json({ erro: 'Informe um valor de saque válido.' });
  }

  if (!chave_pix || !chave_pix.trim()) {
    return res.status(400).json({ erro: 'A chave Pix para recebimento é obrigatória.' });
  }

  try {
    const condutores = await sql`
      SELECT id, nome, saldo_carteira 
      FROM motoristas 
      WHERE id::text = ${id}::text OR usuario_id::text = ${id}::text 
      LIMIT 1;
    `;

    if (!condutores.length) {
      return res.status(404).json({ erro: 'Motorista não encontrado no sistema.' });
    }

    const condutor = condutores[0];
    const saldoDisponivel = Number(condutor.saldo_carteira || 0);

    if (saldoDisponivel < valorNum) {
      return res.status(400).json({ erro: `Saldo insuficiente. Disponível: R$ ${saldoDisponivel.toFixed(2).replace('.', ',')}` });
    }

    const novoSaldo = Number((saldoDisponivel - valorNum).toFixed(2));

    await sql`
      UPDATE motoristas 
      SET saldo_carteira = ${novoSaldo}, chave_pix_padrao = ${chave_pix.trim()} 
      WHERE id = ${condutor.id};
    `;

    const saqueCriado = await sql`
      INSERT INTO saques_motoristas (
        motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status
      ) VALUES (
        ${condutor.id}, ${condutor.nome}, ${chave_pix.trim()}, ${tipo_chave || 'pix'}, ${valorNum}, 'pendente'
      ) RETURNING id;
    `;

    await sql`
      INSERT INTO transacoes_carteira (
        usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id
      ) VALUES (
        ${condutor.id}, 'motorista', 'solicitacao_saque_pix', ${-valorNum}, ${saqueCriado[0].id}
      );
    `;

    res.json({
      sucesso: true,
      mensagem: `Solicitação de saque de R$ ${valorNum.toFixed(2).replace('.', ',')} enviada para a administração!`,
      novoSaldo,
      saqueId: saqueCriado[0].id
    });
  } catch (err) {
    console.error('Erro na solicitação de saque:', err);
    res.status(400).json({ erro: err.message || 'Falha ao processar solicitação de saque.' });
  }
});

// ============================================================================
// 4. PAINEL DO ADMINISTRADOR: APROVAÇÃO E GESTÃO FINANCEIRA
// ============================================================================
router.get('/admin/saques', async (req, res) => {
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

router.put('/admin/saques/:id', async (req, res) => {
  const { id } = req.params;
  const { status, motivo_recusa } = req.body;

  if (!['pago', 'recusado'].includes(status)) {
    return res.status(400).json({ erro: 'Status inválido. Escolha "pago" ou "recusado".' });
  }

  try {
    const saqueExistente = await sql`
      SELECT * FROM saques_motoristas 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (!saqueExistente.length) {
      return res.status(404).json({ erro: 'Solicitação de saque não encontrada.' });
    }

    const saque = saqueExistente[0];

    if (saque.status !== 'pendente') {
      return res.status(400).json({ erro: `Este saque já foi finalizado como '${saque.status}'.` });
    }

    if (status === 'recusado') {
      await sql`
        UPDATE motoristas 
        SET saldo_carteira = saldo_carteira + ${saque.valor} 
        WHERE id = ${saque.motorista_id};
      `;

      await sql`
        UPDATE saques_motoristas 
        SET status = 'recusado', motivo_recusa = ${motivo_recusa || 'Dados bancários inconsistentes'} 
        WHERE id = ${id};
      `;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${saque.motorista_id}, 'motorista', 'estorno_saque_recusado', ${saque.valor}, ${id});
      `;
    } else {
      await sql`
        UPDATE saques_motoristas 
        SET status = 'pago', pago_em = CURRENT_TIMESTAMP 
        WHERE id = ${id};
      `;
    }

    res.json({ sucesso: true, statusAtualizado: status });
  } catch (err) {
    console.error('Erro ao aprovar/recusar saque:', err);
    res.status(400).json({ erro: err.message || 'Falha ao atualizar status do saque.' });
  }
});

// ============================================================================
// 5. ABATE DE CORRIDA E GORJETAS (SEQUENCIAL ATÔMICO NEON)
// ============================================================================
router.post('/debito-corrida', autenticarToken, async (req, res) => {
  const clienteId = req.usuario.id;
  const { pedidoId, valor } = req.body;
  const valorDebitar = parseFloat(Number(valor).toFixed(2));

  if (!pedidoId || !valorDebitar || valorDebitar <= 0) {
    return res.status(400).json({ erro: 'Dados de débito inválidos.' });
  }

  try {
    const cliente = await sql`
      SELECT saldo_carteira FROM usuarios 
      WHERE id::text = ${clienteId}::text 
      LIMIT 1;
    `;

    const saldoAtual = Number(cliente[0]?.saldo_carteira || 0);

    if (saldoAtual < valorDebitar) {
      return res.status(400).json({ erro: `Saldo insuficiente na carteira. Saldo atual: R$ ${saldoAtual.toFixed(2).replace('.', ',')}` });
    }

    await sql`
      UPDATE usuarios 
      SET saldo_carteira = saldo_carteira - ${valorDebitar} 
      WHERE id::text = ${clienteId}::text;
    `;

    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
      VALUES (${clienteId}, 'cliente', 'pagamento_corrida', ${-valorDebitar}, ${pedidoId});
    `;

    res.json({ sucesso: true, mensagem: 'Valor debitado com sucesso da carteira digital.' });
  } catch (err) {
    console.error('Erro ao debitar corrida da carteira:', err);
    res.status(400).json({ erro: err.message || 'Falha ao debitar saldo.' });
  }
});

router.post('/gorjeta', autenticarToken, async (req, res) => {
  const clienteId = req.usuario.id;
  const { pedidoId, valorGorjeta } = req.body;
  const gorjetaNum = parseFloat(Number(valorGorjeta).toFixed(2));

  if (!pedidoId || !gorjetaNum || gorjetaNum <= 0) {
    return res.status(400).json({ erro: 'Dados de gorjeta inválidos.' });
  }

  try {
    const pedido = await sql`
      SELECT id, motorista_id, status 
      FROM pedidos 
      WHERE id = ${pedidoId} AND cliente_id::text = ${clienteId}::text AND status = 'concluido'
      LIMIT 1;
    `;

    if (pedido.length === 0) {
      return res.status(404).json({ erro: 'Viagem concluída não localizada.' });
    }

    const motoristaId = pedido[0].motorista_id;
    if (!motoristaId) {
      return res.status(400).json({ erro: 'Motorista não vinculado à viagem.' });
    }

    const cliente = await sql`
      SELECT saldo_carteira FROM usuarios 
      WHERE id::text = ${clienteId}::text 
      LIMIT 1;
    `;

    const saldoCliente = Number(cliente[0]?.saldo_carteira || 0);
    if (saldoCliente < gorjetaNum) {
      return res.status(400).json({ erro: 'Saldo insuficiente na carteira para enviar gorjeta.' });
    }

    await sql`UPDATE usuarios SET saldo_carteira = saldo_carteira - ${gorjetaNum} WHERE id::text = ${clienteId}::text;`;
    await sql`UPDATE motoristas SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${gorjetaNum} WHERE id::text = ${motoristaId}::text;`;
    await sql`UPDATE pedidos SET valor_gorjeta = COALESCE(valor_gorjeta, 0) + ${gorjetaNum} WHERE id = ${pedidoId};`;

    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
      VALUES 
        (${clienteId}, 'cliente', 'gorjeta_paga', ${-gorjetaNum}, ${pedidoId}),
        (${motoristaId}, 'motorista', 'gorjeta_recebida', ${gorjetaNum}, ${pedidoId});
    `;

    res.json({ sucesso: true, mensagem: 'Gorjeta enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao enviar gorjeta:', err);
    res.status(400).json({ erro: err.message || 'Falha ao processar gorjeta.' });
  }
});

export default router;