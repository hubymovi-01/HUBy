// routes/admin.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// Middleware exclusivo para verificar se é Admin
function verificarAdmin(req, res, next) {
  if (!req.usuario || req.usuario.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

// 1. Métricas da Plataforma
router.get('/metricas', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const statsFinanceiro = await sql`
      SELECT 
        COUNT(id) AS total_corridas_concluidas,
        COALESCE(SUM(valor_total), 0) AS faturamento_bruto
      FROM pedidos
      WHERE status = 'concluido';
    `;

    const faturamentoBruto = Number(statsFinanceiro[0].faturamento_bruto || 0);
    const receitaPlataforma = Number((faturamentoBruto * 0.15).toFixed(2));
    const repasseMotoristas = Number((faturamentoBruto * 0.85).toFixed(2));

    const statsUsuarios = await sql`
      SELECT 
        (SELECT COUNT(*) FROM motoristas WHERE status_aprovacao = 'aprovado') AS motoristas_ativos,
        (SELECT COUNT(*) FROM usuarios WHERE role = 'cliente') AS total_clientes,
        (SELECT COUNT(*) FROM pedidos WHERE status = 'pendente') AS chamadas_em_aberto;
    `;

    const ultimasChamadas = await sql`
      SELECT id, status, tipo, sub_tipo_label, valor_total, distancia_km, criado_em, motorista_nome
      FROM pedidos
      ORDER BY criado_em DESC
      LIMIT 20;
    `;

    res.json({
      faturamentoBruto,
      receitaPlataforma,
      repasseMotoristas,
      totalCorridas: Number(statsFinanceiro[0].total_corridas_concluidas || 0),
      motoristasAtivos: Number(statsUsuarios[0].motoristas_ativos || 0),
      totalClientes: Number(statsUsuarios[0].total_clientes || 0),
      chamadasEmAberto: Number(statsUsuarios[0].chamadas_em_aberto || 0),
      ultimasChamadas
    });
  } catch (err) {
    console.error('Erro nas métricas admin:', err);
    res.status(500).json({ erro: 'Falha ao extrair métricas do sistema.' });
  }
});

// 2. Listar Motoristas para Gestão
router.get('/motoristas', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const motoristas = await sql`
      SELECT id, nome, email, telefone, cnh_numero AS cnh, 
             categoria AS categoria_veiculo, veiculo_modelo, veiculo_placa,
             doc_crlv_url, saldo_carteira, status_aprovacao, avaliacao_media, criado_em
      FROM motoristas
      ORDER BY criado_em DESC;
    `;
    res.json(motoristas);
  } catch (err) {
    console.error('Erro ao consultar motoristas:', err);
    res.status(500).json({ erro: 'Falha ao obter lista de parceiros.' });
  }
});

// 3. Triagem de Motoristas (Aprovar/Recusar)
router.put('/motoristas/:id/triagem', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { acao, motivo } = req.body;

    if (!['aprovar', 'recusar'].includes(acao)) {
      return res.status(400).json({ erro: 'Ação inválida. Utilize aprovar ou recusar.' });
    }

    const novoStatus = acao === 'aprovar' ? 'aprovado' : 'recusado';
    const motivoRecusa = acao === 'recusar' ? (motivo || 'Documentação ou perfil em desacordo.') : null;

    const mot = await sql`
      UPDATE motoristas
      SET status_aprovacao = ${novoStatus},
          motivo_recusa = ${motivoRecusa}
      WHERE id = ${id}
      RETURNING id, nome, status_aprovacao, motivo_recusa;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });

    res.json({ sucesso: true, motorista: mot[0] });
  } catch (err) {
    console.error('Erro na triagem:', err);
    res.status(500).json({ erro: 'Falha ao processar triagem.' });
  }
});

// 4. Listar Saques Pix
router.get('/saques', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const saques = await sql`
      SELECT id, motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status, solicitado_em, pago_em
      FROM saques_motoristas
      ORDER BY solicitado_em DESC
      LIMIT 50;
    `;
    res.json(saques);
  } catch (err) {
    console.error('Erro ao listar saques:', err);
    res.status(500).json({ erro: 'Falha ao listar saques.' });
  }
});

// 5. Processar Saque Pix
router.put('/saques/:id/processar', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, motivo } = req.body;

    const saqueReg = await sql`SELECT * FROM saques_motoristas WHERE id = ${id} LIMIT 1;`;
    if (saqueReg.length === 0) return res.status(404).json({ erro: 'Saque não localizado.' });

    const saque = saqueReg[0];
    if (saque.status !== 'pendente') {
      return res.status(400).json({ erro: 'Este pedido já foi finalizado anteriormente.' });
    }

    if (status === 'pago') {
      await sql`
        UPDATE saques_motoristas
        SET status = 'pago', pago_em = CURRENT_TIMESTAMP
        WHERE id = ${id};
      `;
    } else if (status === 'recusado') {
      await sql`UPDATE motoristas SET saldo_carteira = saldo_carteira + ${saque.valor} WHERE id = ${saque.motorista_id};`;
      await sql`
        UPDATE saques_motoristas
        SET status = 'recusado', motivo_recusa = ${motivo || 'Dados bancários inconsistentes'}
        WHERE id = ${id};
      `;
    }

    res.json({ sucesso: true, mensagem: `Saque marcado como ${status}.` });
  } catch (err) {
    console.error('Erro ao processar saque:', err);
    res.status(500).json({ erro: 'Falha ao processar saque.' });
  }
});

// 6. Atualizar Tarifas Dinâmicas
router.put('/tarifas', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const novasTarifas = req.body;
    await sql`
      UPDATE configuracoes_plataforma
      SET valor = ${JSON.stringify(novasTarifas)}::jsonb,
          atualizado_em = CURRENT_TIMESTAMP
      WHERE chave = 'tarifas';
    `;
    res.json({ sucesso: true, mensagem: 'Tarifas atualizadas com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tarifas:', err);
    res.status(500).json({ erro: 'Falha ao atualizar tarifas.' });
  }
});

// 7. Relatório CSV de Corridas
router.get('/relatorios/corridas.csv', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const registros = await sql`
      SELECT id, criado_em, sub_tipo_label, distancia_km, valor_total,
             ROUND(valor_total * 0.85, 2) AS repasse_motorista,
             ROUND(valor_total * 0.15, 2) AS taxa_huby,
             motorista_nome, status
      FROM pedidos
      ORDER BY criado_em DESC;
    `;

    let csv = 'ID;Data;Categoria;Distancia_KM;Valor_Bruto;Repasse_85;Taxa_15;Motorista;Status\n';
    registros.forEach(r => {
      csv += `"${r.id}";"${new Date(r.criado_em).toISOString()}";"${r.sub_tipo_label || ''}";"${r.distancia_km || 0}";"${r.valor_total || 0}";"${r.repasse_motorista || 0}";"${r.taxa_huby || 0}";"${r.motorista_nome || ''}";"${r.status || ''}"\n`;
    });

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment(`huby-relatorio-corridas-${Date.now()}.csv`);
    return res.send(csv);
  } catch (err) {
    console.error('Erro ao gerar CSV:', err);
    res.status(500).json({ erro: 'Falha ao gerar relatório.' });
  }
});

export default router;