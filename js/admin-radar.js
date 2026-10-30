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

// ============================================================================
// 1. RESUMO OPERACIONAL E KPIs (PARA CARDS E CHART.JS)
// ============================================================================
router.get('/metricas', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const kpis = await sql`
      SELECT 
        (SELECT COUNT(*)::int FROM motoristas WHERE status_online = true) AS motoristas_online,
        (SELECT COUNT(*)::int FROM pedidos WHERE status IN ('pendente', 'aceito', 'em_viagem')) AS corridas_ativas,
        (SELECT COUNT(*)::int FROM saques WHERE status = 'pendente') AS saques_pendentes,
        (SELECT COUNT(*)::int FROM motoristas WHERE status_aprovacao = 'pendente') AS motoristas_pendentes,
        (SELECT COUNT(*)::int FROM pedidos WHERE status = 'concluido') AS viagens_concluidas,
        (SELECT COALESCE(SUM(valor_total), 0)::float FROM pedidos WHERE status = 'concluido') AS faturamento_bruto,
        (SELECT COALESCE(SUM(valor_total * 0.15), 0)::float FROM pedidos WHERE status = 'concluido' AND concluido_em >= CURRENT_DATE) AS receita_huby_hoje,
        (SELECT COUNT(*)::int FROM incidentes_seguranca WHERE resolvido = false) AS incidentes_ativos;
    `;

    // Distribuição por categoria para o gráfico de barras
    const categorias = await sql`
      SELECT tipo, COUNT(*)::int AS total
      FROM pedidos
      GROUP BY tipo;
    `;

    const distribuicao_categorias = { carro: 0, moto: 0, entrega: 0 };
    categorias.forEach(c => {
      if (c.tipo) distribuicao_categorias[c.tipo.toLowerCase()] = c.total;
    });

    res.json({
      ...(kpis[0] || {}),
      distribuicao_categorias
    });
  } catch (err) {
    console.error('Erro ao buscar métricas:', err);
    res.status(500).json({ erro: 'Falha ao buscar métricas.' });
  }
});

// ============================================================================
// 2. GESTÃO E APROVAÇÃO DE MOTORISTAS
// ============================================================================
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

// ============================================================================
// 3. SAQUES PIX
// ============================================================================
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

// ============================================================================
// 4. CUPONS DE DESCONTO
// ============================================================================
router.get('/cupons', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const cupons = await sql`SELECT * FROM cupons ORDER BY criado_em DESC;`;
    res.json(cupons);
  } catch (err) {
    res.json([]);
  }
});

router.post('/cupons', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { codigo, tipo, valor, limite_usos, expira_em } = req.body;
    await sql`
      INSERT INTO cupons (codigo, tipo, valor, limite_usos, expira_em, ativo)
      VALUES (${codigo.toUpperCase()}, ${tipo}, ${valor}, ${limite_usos || 100}, ${expira_em || null}, true);
    `;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao criar cupom.' });
  }
});

router.put('/cupons/:id/toggle', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`UPDATE cupons SET ativo = NOT ativo WHERE id = ${id};`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao alterar cupom.' });
  }
});

router.delete('/cupons/:id', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM cupons WHERE id = ${id};`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao excluir cupom.' });
  }
});

// ============================================================================
// 5. INCIDENTES DE SEGURANÇA E SOS
// ============================================================================
router.get('/incidentes', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const incidentes = await sql`
      SELECT * FROM incidentes_seguranca 
      ORDER BY criado_em DESC 
      LIMIT 50;
    `;
    res.json(incidentes);
  } catch (err) {
    res.json([]);
  }
});

router.put('/incidentes/:id/resolver', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`
      UPDATE incidentes_seguranca 
      SET resolvido = true, resolvido_em = NOW() 
      WHERE id = ${id};
    `;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao resolver incidente.' });
  }
});

// ============================================================================
// 6. BROADCAST (ALERTA EM MASSA VIA SOCKET.IO)
// ============================================================================
router.post('/broadcast', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { publico, titulo, mensagem } = req.body;
    const io = req.app.get('io');
    if (io) {
      io.emit('alerta_broadcast_geral', { publico, titulo, mensagem });
    }
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao emitir broadcast.' });
  }
});

// ============================================================================
// 7. TARIFAS E PARÂMETROS GLOBAIS
// ============================================================================
router.put('/config', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { taxa_plataforma, km_carro, km_moto, km_entrega } = req.body;
    await sql`
      INSERT INTO configuracoes_plataforma (id, taxa_plataforma, km_carro, km_moto, km_entrega, atualizado_em)
      VALUES (1, ${taxa_plataforma}, ${km_carro}, ${km_moto}, ${km_entrega}, NOW())
      ON CONFLICT (id) DO UPDATE 
      SET taxa_plataforma = EXCLUDED.taxa_plataforma,
          km_carro = EXCLUDED.km_carro,
          km_moto = EXCLUDED.km_moto,
          km_entrega = EXCLUDED.km_entrega,
          atualizado_em = NOW();
    `;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao salvar configurações de tarifas.' });
  }
});

// ============================================================================
// 8. ZONAS DE TARIFA DINÂMICA
// ============================================================================
router.get('/dinamica', async (req, res) => {
  try {
    const zonas = await sql`SELECT * FROM zonas_dinamicas ORDER BY id DESC;`;
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
    await sql`UPDATE zonas_dinamicas SET ativa = NOT ativa WHERE id = ${id};`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao alterar estado da zona.' });
  }
});

router.delete('/dinamica/:id', autenticarToken, autorizarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM zonas_dinamicas WHERE id = ${id};`;
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao remover zona.' });
  }
});

export default router;