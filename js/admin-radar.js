// routes/admin.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Middleware para autorizar apenas nível de acesso 'admin'
const autorizarAdmin = (req, res, next) => {
  const role = String(req.usuario?.role || req.usuario?.tipo || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito ao Painel Master.' });
  }
  next();
};

// 1. Resumo Operacional (KPIs)
router.get('/metricas', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const kpis = await sql`
      SELECT 
        (SELECT COUNT(*)::int FROM motoristas WHERE status_online = true) AS motoristas_online,
        (SELECT COUNT(*)::int FROM pedidos WHERE status IN ('pendente', 'aceito', 'em_viagem')) AS corridas_ativas,
        (SELECT COUNT(*)::int FROM saques WHERE status = 'pendente') AS saques_pendentes,
        (SELECT COUNT(*)::int FROM motoristas WHERE status_aprovacao = 'pendente') AS motoristas_pendentes,
        (SELECT COALESCE(SUM(valor_total * 0.15), 0) FROM pedidos WHERE status = 'concluido' AND concluido_em >= CURRENT_DATE) AS receita_huby_hoje;
    `;
    res.json(kpis[0] || {});
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar métricas.' });
  }
});

// 2. Listagem de Motoristas para Aprovação / Gestão
router.get('/motoristas', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const motoristas = await sql`
      SELECT 
        m.id,
        m.usuario_id,
        u.nome,
        u.email,
        u.telefone,
        m.cnh,
        m.veiculo_modelo,
        m.veiculo_placa,
        m.veiculo_cor,
        m.veiculo_ano,
        m.categoria,
        m.status_aprovacao,
        m.status_online,
        m.saldo_carteira,
        m.avaliacao_media,
        m.foto_perfil_url,
        m.criado_em
      FROM motoristas m
      JOIN usuarios u ON u.id::text = m.usuario_id::text
      ORDER BY m.criado_em DESC;
    `;
    res.json(motoristas);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar motoristas.' });
  }
});

// 3. Atualizar Status de Aprovação do Motorista
router.put('/motoristas/:id/status', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'aprovado' | 'pendente' | 'bloqueado'

    if (!['aprovado', 'pendente', 'bloqueado'].includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    await sql`
      UPDATE motoristas 
      SET status_aprovacao = ${status} 
      WHERE id::text = ${id}::text OR usuario_id::text = ${id}::text;
    `;

    res.json({ sucesso: true, status });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao atualizar status do condutor.' });
  }
});

// 4. Listagem e Moderação de Saques Pix
router.get('/saques', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const saques = await sql`
      SELECT 
        s.id,
        s.motorista_id,
        u.nome AS motorista_nome,
        u.telefone AS motorista_telefone,
        s.valor,
        s.chave_pix,
        s.tipo_chave,
        s.status,
        s.solicitado_em
      FROM saques s
      JOIN motoristas m ON m.id::text = s.motorista_id::text
      JOIN usuarios u ON u.id::text = m.usuario_id::text
      ORDER BY s.solicitado_em DESC;
    `;
    res.json(saques);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao listar saques.' });
  }
});

router.put('/saques/:id', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { acao } = req.body; // 'pago' | 'recusado'

    if (!['pago', 'recusado'].includes(acao)) {
      return res.status(400).json({ erro: 'Ação inválida.' });
    }

    // Se recusado, devolve o saldo para a carteira do motorista
    if (acao === 'recusado') {
      const saque = await sql`SELECT motorista_id, valor, status FROM saques WHERE id = ${id}`;
      if (saque.length > 0 && saque[0].status === 'pendente') {
        await sql`
          UPDATE motoristas 
          SET saldo_carteira = saldo_carteira + ${saque[0].valor} 
          WHERE id::text = ${saque[0].motorista_id}::text;
        `;
      }
    }

    await sql`
      UPDATE saques 
      SET status = ${acao}, processado_em = NOW() 
      WHERE id = ${id};
    `;

    res.json({ sucesso: true, status: acao });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao processar saque.' });
  }
});

// 5. Zonas de Tarifa Dinâmica
router.get('/dinamica', async (req, res) => {
  try {
    const zonas = await sql`SELECT * FROM zonas_dinamicas ORDER BY id DESC`;
    res.json(zonas);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao listar zonas dinâmicas.' });
  }
});

router.post('/dinamica', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { nome, multiplicador, centro_lat, centro_lng, raio_metros } = req.body;
    await sql`
      INSERT INTO zonas_dinamicas (nome, multiplicador, centro_lat, centro_lng, raio_metros, ativa)
      VALUES (${nome}, ${multiplicador}, ${centro_lat}, ${centro_lng}, ${raio_metros}, true);
    `;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao criar zona de demanda.' });
  }
});

router.put('/dinamica/:id/toggle', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`UPDATE zonas_dinamicas SET ativa = NOT ativa WHERE id = ${id}`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao alterar estado da zona.' });
  }
});

router.delete('/dinamica/:id', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM zonas_dinamicas WHERE id = ${id}`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao remover zona.' });
  }
});

export default router;