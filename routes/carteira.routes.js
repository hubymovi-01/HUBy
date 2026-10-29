// routes/carteira.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// 1. Consultar Saldo da Carteira (Passageiro ou Motorista)
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

// 2. Adicionar Saldo Pré-pago via Pix (Simulação / Webhook Pix)
router.post('/depositar', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { valor } = req.body;
    const valorNum = Number(valor);

    if (!valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'Valor de recarga inválido.' });
    }

    // Atualização atômica do saldo do cliente
    const atualizado = await sql`
      UPDATE usuarios
      SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${valorNum}
      WHERE id = ${usuarioId}
      RETURNING saldo_carteira;
    `;

    // Gravação da transação para auditoria
    await sql`
      INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor)
      VALUES (${usuarioId}, 'cliente', 'deposito_pix', ${valorNum});
    `;

    res.json({ sucesso: true, novoSaldo: Number(atualizado[0].saldo_carteira) });
  } catch (err) {
    console.error('Erro ao depositar na carteira:', err);
    res.status(500).json({ erro: 'Falha ao processar recarga.' });
  }
});

// 3. Enviar Gorjeta Pós-Viagem para o Condutor
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