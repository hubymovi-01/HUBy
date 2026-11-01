// routes/carteira.routes.js - Carteira Digital Pré-Paga & Pagamentos Pix HUBy
import express from 'express';
import crypto from 'crypto';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// 0. MIGRAÇÃO SEGURA PARA SUPORTE À CARTEIRA DIGITAL E COBRANÇAS PIX
async function inicializarTabelasCarteira() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_carteira NUMERIC(10,2) DEFAULT 0.00;`;
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
        txid VARCHAR(64) UNIQUE NOT NULL,
        usuario_id TEXT NOT NULL,
        valor NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pendente',
        pix_copia_cola TEXT NOT NULL,
        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Tabelas de carteira já sincronizadas ou erro leve:', err.message);
  }
}
inicializarTabelasCarteira();

// ============================================================================
// 1. CONSULTA DE SALDO E EXTRATO
// ============================================================================
router.get('/saldo', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const role = String(req.usuario.role || req.usuario.funcao || '').toLowerCase();

    let saldo = 0;
    if (role === 'motorista') {
      const mot = await sql`SELECT saldo_carteira FROM motoristas WHERE id = ${usuarioId} LIMIT 1;`;
      saldo = Number(mot[0]?.saldo_carteira || 0);
    } else {
      const cli = await sql`SELECT saldo_carteira FROM usuarios WHERE id = ${usuarioId} LIMIT 1;`;
      saldo = Number(cli[0]?.saldo_carteira || 0);
    }

    const historico = await sql`
      SELECT id, tipo_transacao, valor, pedido_id, criado_em
      FROM transacoes_carteira
      WHERE usuario_id = ${usuarioId}
      ORDER BY criado_em DESC
      LIMIT 20;
    `;

    res.json({ saldo, historico });
  } catch (err) {
    console.error('Erro ao consultar saldo da carteira:', err);
    res.status(500).json({ erro: 'Falha ao buscar saldo.' });
  }
});

// ============================================================================
// 2. GERAÇÃO DE PIX DINÂMICO PARA RECARGA PRÉ-PAGA
// ============================================================================
router.post('/pix/gerar', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { valor } = req.body;
    const valorNum = Number(valor);

    if (!valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'O valor da recarga deve ser maior que zero.' });
    }

    const txid = `HUBY${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 32);
    const chavePix = 'pix@huby.app.br';

    // Gerador de Payload Pix Dinâmico Simulado Padrão EMV
    const copiaCola = `00020101021226580014br.gov.bcb.pix0115${chavePix}520400005303986540${valorNum.toFixed(2).length < 5 ? '0' : ''}${valorNum.toFixed(2)}5802BR5904HUBY6008SAOJOAO62240520${txid}6304${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(copiaCola)}`;
    const expiraEm = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await sql`
      INSERT INTO cobrancas_pix (txid, usuario_id, valor, status, pix_copia_cola, expira_em)
      VALUES (${txid}, ${usuarioId}, ${valorNum}, 'pendente', ${copiaCola}, ${expiraEm});
    `;

    res.json({
      sucesso: true,
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

// Consulta de status da cobrança Pix (para Polling no Frontend)
router.get('/pix/status/:txid', autenticarToken, async (req, res) => {
  try {
    const { txid } = req.params;
    const cobranca = await sql`
      SELECT txid, valor, status, expira_em 
      FROM cobrancas_pix 
      WHERE txid = ${txid} 
      LIMIT 1;
    `;

    if (!cobranca.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não localizada.' });
    }

    res.json(cobranca[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao consultar status do Pix.' });
  }
});

// Simular / Webhook de Confirmação de Pagamento Pix
router.post('/pix/simular-pagamento', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { txid } = req.body;

    const cob = await sql`
      SELECT id, usuario_id, valor, status 
      FROM cobrancas_pix 
      WHERE txid = ${txid} AND usuario_id = ${usuarioId}
      LIMIT 1;
    `;

    if (!cob.length) {
      return res.status(404).json({ erro: 'Cobrança Pix não encontrada.' });
    }

    if (cob[0].status === 'pago') {
      return res.json({ sucesso: true, mensagem: 'Essa recarga já foi processada anteriormente.' });
    }

    const valorCreditar = Number(cob[0].valor);

    // 1. Atualiza cobrança como paga
    await sql`UPDATE cobrancas_pix SET status = 'pago' WHERE txid = ${txid};`;

    // 2. Credita saldo do cliente de forma atômica
    const userAtualizado = await sql`
      UPDATE usuarios 
      SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${valorCreditar}
      WHERE id = ${usuarioId}
      RETURNING saldo_carteira;
    `;

    // 3. Registra transação no extrato
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
    res.status(500).json({ erro: 'Falha ao confirmar liquidação Pix.' });
  }
});

// ============================================================================
// 3. ABATE DE VIAGEM DIRETO DO SALDO PRÉ-PAGO (CARTEIRA)
// ============================================================================
router.post('/debito-corrida', autenticarToken, async (req, res) => {
  try {
    const clienteId = req.usuario.id;
    const { pedidoId, valor } = req.body;
    const valorDebitar = Number(valor);

    if (!pedidoId || !valorDebitar || valorDebitar <= 0) {
      return res.status(400).json({ erro: 'Dados de débito inválidos.' });
    }

    const cliente = await sql`SELECT saldo_carteira FROM usuarios WHERE id = ${clienteId} LIMIT 1;`;
    const saldoAtual = Number(cliente[0]?.saldo_carteira || 0);

    if (saldoAtual < valorDebitar) {
      return res.status(400).json({ 
        erro: 'Saldo insuficiente na carteira.', 
        saldoAtual, 
        falta: Number((valorDebitar - saldoAtual).toFixed(2)) 
      });
    }

    // Debita da conta do cliente
    await sql`
      UPDATE usuarios 
      SET saldo_carteira = saldo_carteira - ${valorDebitar} 
      WHERE id = ${clienteId};
    `;

    // Registra transação
    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
      VALUES (${clienteId}, 'cliente', 'pagamento_corrida', ${-valorDebitar}, ${pedidoId});
    `;

    res.json({ sucesso: true, mensagem: 'Valor debitado com sucesso da carteira digital.' });
  } catch (err) {
    console.error('Erro ao debitar corrida da carteira:', err);
    res.status(500).json({ erro: 'Falha ao debitar saldo.' });
  }
});

// ============================================================================
// 4. GORJETA PÓS-VIAGEM PARA O CONDUTOR
// ============================================================================
router.post('/gorjeta', autenticarToken, async (req, res) => {
  try {
    const clienteId = req.usuario.id;
    const { pedidoId, valorGorjeta } = req.body;
    const gorjetaNum = Number(valorGorjeta);

    if (!pedidoId || !gorjetaNum || gorjetaNum <= 0) {
      return res.status(400).json({ erro: 'Dados de gorjeta inválidos.' });
    }

    const pedido = await sql`
      SELECT id, motorista_id, status 
      FROM pedidos 
      WHERE id = ${pedidoId} AND cliente_id = ${clienteId} AND status = 'concluido'
      LIMIT 1;
    `;

    if (pedido.length === 0) {
      return res.status(404).json({ erro: 'Viagem concluída não localizada.' });
    }

    const motoristaId = pedido[0].motorista_id;
    if (!motoristaId) {
      return res.status(400).json({ erro: 'Motorista não vinculado à viagem.' });
    }

    // Abate da carteira do cliente
    const cliente = await sql`SELECT saldo_carteira FROM usuarios WHERE id = ${clienteId} LIMIT 1;`;
    if (Number(cliente[0]?.saldo_carteira || 0) < gorjetaNum) {
      return res.status(400).json({ erro: 'Saldo insuficiente na carteira para enviar gorjeta.' });
    }

    await sql`UPDATE usuarios SET saldo_carteira = saldo_carteira - ${gorjetaNum} WHERE id = ${clienteId};`;
    // Repasse integral (100%) da gorjeta para o motorista sem taxa de intermediação
    await sql`UPDATE motoristas SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${gorjetaNum} WHERE id = ${motoristaId};`;
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
    res.status(500).json({ erro: 'Falha ao processar gorjeta.' });
  }
});

export default router;