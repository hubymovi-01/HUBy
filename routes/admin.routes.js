// routes/admin.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

// Middleware flexível: aceita 'admin' e 'administrador'
function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

// Suporte para autenticar via query parameter no download do CSV via navegador
function autenticarCsv(req, res, next) {
  const tokenUrl = req.query.token;
  if (tokenUrl && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenUrl}`;
  }
  return autenticarToken(req, res, next);
}

// Garante criação da tabela de zonas de risco no banco Neon
async function inicializarTabelasAdmin() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS zonas_risco (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        nivel_risco VARCHAR(20) DEFAULT 'alto',
        raio_metros INT DEFAULT 500,
        lat NUMERIC NOT NULL,
        lng NUMERIC NOT NULL,
        horario_inicio TIME DEFAULT '20:00:00',
        horario_fim TIME DEFAULT '05:00:00',
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Aviso ao sincronizar tabela de zonas de risco:', err.message);
  }
}
inicializarTabelasAdmin();

export default function adminRoutes(io) {
  const router = express.Router();

  // =========================================================================
  // 1. MÉTRICAS DA PLATAFORMA COM FILTRO DE PERÍODO (HOJE, 7D, MÊS, TOTAL)
  // =========================================================================
  router.get('/metricas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const periodo = String(req.query.periodo || 'total').toLowerCase();

      // Monta cláusula SQL dinâmica para filtragem temporal
      let filtroPeriodo = sql``;
      if (periodo === 'hoje') {
        filtroPeriodo = sql`AND criado_em >= CURRENT_DATE`;
      } else if (periodo === '7d') {
        filtroPeriodo = sql`AND criado_em >= NOW() - INTERVAL '7 days'`;
      } else if (periodo === 'mes') {
        filtroPeriodo = sql`AND criado_em >= DATE_TRUNC('month', CURRENT_DATE)`;
      }

      // Faturamento e repasses com o filtro aplicado
      const statsFinanceiro = await sql`
        SELECT 
          COUNT(id) AS total_corridas_concluidas,
          COALESCE(SUM(valor_total), 0) AS faturamento_bruto
        FROM pedidos
        WHERE status = 'concluido' ${filtroPeriodo};
      `;

      const faturamentoBruto = Number(statsFinanceiro[0]?.faturamento_bruto || 0);
      const receitaPlataforma = Number((faturamentoBruto * 0.15).toFixed(2));
      const repasseMotoristas = Number((faturamentoBruto * 0.85).toFixed(2));

      // Contadores de corridas e incidentes
      const statsUsuarios = await sql`
        SELECT 
          (SELECT COUNT(*) FROM motoristas WHERE status_aprovacao = 'aprovado') AS motoristas_ativos,
          (SELECT COUNT(*) FROM pedidos WHERE status = 'pendente' ${filtroPeriodo}) AS chamadas_em_aberto,
          (SELECT COUNT(*) FROM pedidos WHERE status = 'concluido' ${filtroPeriodo}) AS chamadas_concluidas,
          (SELECT COUNT(*) FROM pedidos WHERE status = 'cancelado' ${filtroPeriodo}) AS chamadas_canceladas,
          (SELECT COUNT(*) FROM incidentes_seguranca WHERE resolvido = FALSE) AS incidentes_ativos;
      `;

      // Distribuição por categoria (Carro, Moto, Entrega) no período
      const statsCategorias = await sql`
        SELECT 
          COALESCE(sub_tipo_id, tipo, 'carro') AS categoria,
          COUNT(id) AS total
        FROM pedidos
        WHERE 1=1 ${filtroPeriodo}
        GROUP BY COALESCE(sub_tipo_id, tipo, 'carro');
      `;

      const distribuicao_categorias = { carro: 0, moto: 0, entrega: 0 };
      statsCategorias.forEach(c => {
        const cat = String(c.categoria).toLowerCase();
        if (cat.includes('moto')) distribuicao_categorias.moto = Number(c.total);
        else if (cat.includes('entrega') || cat.includes('frete')) distribuicao_categorias.entrega = Number(c.total);
        else distribuicao_categorias.carro = Number(c.total);
      });

      // Últimas chamadas dentro do intervalo selecionado
      const ultimasChamadas = await sql`
        SELECT id, status, tipo, sub_tipo_label, valor_total, distancia_km, criado_em, motorista_nome
        FROM pedidos
        WHERE 1=1 ${filtroPeriodo}
        ORDER BY criado_em DESC
        LIMIT 20;
      `;

      res.json({
        periodoSelecionado: periodo,
        financeiro: {
          faturamento_total: faturamentoBruto,
          lucro_plataforma: receitaPlataforma,
          total_pago_motoristas: repasseMotoristas
        },
        pedidos: {
          pendentes: Number(statsUsuarios[0]?.chamadas_em_aberto || 0),
          concluidos: Number(statsUsuarios[0]?.chamadas_concluidas || 0),
          cancelados: Number(statsUsuarios[0]?.chamadas_canceladas || 0)
        },
        motoristas: {
          total: Number(statsUsuarios[0]?.motoristas_ativos || 0)
        },
        faturamentoBruto,
        receitaPlataforma,
        lucroHuby: receitaPlataforma,
        repasseMotoristas,
        viagensConcluidas: Number(statsUsuarios[0]?.chamadas_concluidas || 0),
        incidentes_ativos: Number(statsUsuarios[0]?.incidentes_ativos || 0),
        distribuicao_categorias,
        ultimasChamadas
      });
    } catch (err) {
      console.error('Erro nas métricas admin filtradas:', err);
      res.status(500).json({ erro: 'Falha ao extrair métricas do sistema.' });
    }
  });

  // =========================================================================
  // 2. GESTÃO DE MOTORISTAS & FROTA (COM FOTO, CNH E CRLV PARA ZOOM)
  // =========================================================================
  router.get('/motoristas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const motoristas = await sql`
        SELECT id, nome, email, telefone, cnh_numero AS cnh, 
               categoria AS categoria_veiculo, veiculo_modelo, veiculo_placa,
               veiculo_cor, veiculo_ano, doc_cnh_url, doc_crlv_url, foto_perfil_url,
               saldo_carteira, status_aprovacao, status_online,
               avaliacao_media, total_corridas, criado_em
        FROM motoristas
        ORDER BY criado_em DESC;
      `;
      res.json(motoristas);
    } catch (err) {
      console.error('Erro ao consultar motoristas:', err);
      res.status(500).json({ erro: 'Falha ao obter lista de parceiros.' });
    }
  });

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

  router.put('/motoristas/:id/status', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status_aprovacao } = req.body;
      await sql`
        UPDATE motoristas
        SET status_aprovacao = ${status_aprovacao}
        WHERE id = ${id};
      `;
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao alterar status.' });
    }
  });

  // =========================================================================
  // 3. GESTÃO DE SAQUES PIX
  // =========================================================================
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

  router.put('/saques/:id/aprovar', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`UPDATE saques_motoristas SET status = 'pago', pago_em = CURRENT_TIMESTAMP WHERE id = ${id};`;
      res.json({ sucesso: true });
    } catch (e) {
      res.status(500).json({ erro: 'Erro ao aprovar saque.' });
    }
  });

  router.put('/saques/:id/rejeitar', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { motivo } = req.body;
      await sql`UPDATE saques_motoristas SET status = 'recusado', motivo_recusa = ${motivo || 'Recusado'} WHERE id = ${id};`;
      res.json({ sucesso: true });
    } catch (e) {
      res.status(500).json({ erro: 'Erro ao rejeitar saque.' });
    }
  });

  // =========================================================================
  // 4. MONITOR DE VIAGENS
  // =========================================================================
  router.get('/pedidos', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const viagens = await sql`
        SELECT id, criado_em, tipo, sub_tipo_label, distancia_km, valor_total, motorista_nome, status
        FROM pedidos
        ORDER BY criado_em DESC
        LIMIT 100;
      `;
      res.json(viagens);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao listar corridas.' });
    }
  });

  // =========================================================================
  // 5. ATUALIZAR TARIFAS E REGRAS DE NEGÓCIO
  // =========================================================================
  router.put('/tarifas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const novasTarifas = req.body;
      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('tarifas', ${JSON.stringify(novasTarifas)}::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE
        SET valor = ${JSON.stringify(novasTarifas)}::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;
      res.json({ sucesso: true, mensagem: 'Tarifas atualizadas com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar tarifas:', err);
      res.status(500).json({ erro: 'Falha ao atualizar tarifas.' });
    }
  });

  // =========================================================================
  // 6. GESTÃO DE CUPONS DE DESCONTO & MARKETING
  // =========================================================================
  router.get('/cupons', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const cupons = await sql`
        SELECT id, codigo, tipo, valor, limite_usos, usos_atuais, expira_em, ativo, criado_em
        FROM cupons_desconto
        ORDER BY criado_em DESC;
      `;
      res.json(cupons);
    } catch (err) {
      console.error('Erro ao listar cupons:', err);
      res.status(500).json({ erro: 'Falha ao listar cupons promocionais.' });
    }
  });

  router.post('/cupons', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { codigo, tipo, valor, limite_usos, expira_em } = req.body;

      if (!codigo || !valor) {
        return res.status(400).json({ erro: 'Código e valor do cupom são obrigatórios.' });
      }

      const codigoLimpo = String(codigo).trim().toUpperCase();
      const tipoCupom = tipo === 'porcentagem' ? 'porcentagem' : 'fixo';
      const valorNum = Number(valor) || 0;
      const limiteNum = Number(limite_usos) || 100;
      const expiraData = expira_em ? new Date(expira_em) : null;

      const novoCupom = await sql`
        INSERT INTO cupons_desconto (codigo, tipo, valor, limite_usos, expira_em, ativo)
        VALUES (${codigoLimpo}, ${tipoCupom}, ${valorNum}, ${limiteNum}, ${expiraData}, TRUE)
        RETURNING *;
      `;

      res.status(201).json({ sucesso: true, cupom: novoCupom[0] });
    } catch (err) {
      console.error('Erro ao criar cupom:', err);
      if (err.message?.includes('duplicate key') || err.code === '23505') {
        return res.status(409).json({ erro: 'Este código de cupom já existe.' });
      }
      res.status(500).json({ erro: 'Erro interno ao registrar cupom.' });
    }
  });

  router.put('/cupons/:id/toggle', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const atualizado = await sql`
        UPDATE cupons_desconto
        SET ativo = NOT ativo
        WHERE id = ${id}
        RETURNING id, codigo, ativo;
      `;
      if (atualizado.length === 0) return res.status(404).json({ erro: 'Cupom não encontrado.' });
      res.json({ sucesso: true, cupom: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao alterar estado do cupom.' });
    }
  });

  router.delete('/cupons/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`DELETE FROM cupons_desconto WHERE id = ${id};`;
      res.json({ sucesso: true, mensagem: 'Cupom excluído com sucesso.' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao remover cupom.' });
    }
  });

  // =========================================================================
  // 7. CENTRAL DE SEGURANÇA, SOS E ZONAS DE RISCO (NOVO)
  // =========================================================================
  router.get('/seguranca/incidentes', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const incidentes = await sql`
        SELECT id, pedido_id, usuario_id, tipo_alerta, descricao, resolvido, criado_em
        FROM incidentes_seguranca
        ORDER BY criado_em DESC
        LIMIT 50;
      `;
      res.json(incidentes);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao consultar incidentes de segurança.' });
    }
  });

  router.put('/seguranca/incidentes/:id/resolver', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`
        UPDATE incidentes_seguranca
        SET resolvido = TRUE
        WHERE id = ${id};
      `;
      res.json({ sucesso: true, mensagem: 'Incidente arquivado como resolvido.' });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao atualizar incidente.' });
    }
  });

  // Zonas de risco / Restrição noturna
  router.get('/seguranca/zonas-risco', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const zonas = await sql`
        SELECT id, nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim, ativo, criado_em
        FROM zonas_risco
        ORDER BY criado_em DESC;
      `;
      res.json(zonas);
    } catch (err) {
      console.error('Erro ao listar zonas de risco:', err);
      res.status(500).json({ erro: 'Falha ao listar áreas de risco.' });
    }
  });

  router.post('/seguranca/zonas-risco', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim } = req.body;

      if (!nome || !lat || !lng) {
        return res.status(400).json({ erro: 'Nome e coordenadas geográficas são obrigatórios.' });
      }

      const novaZona = await sql`
        INSERT INTO zonas_risco (nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim, ativo)
        VALUES (
          ${nome}, 
          ${descricao || 'Área de atenção especial'}, 
          ${nivel_risco || 'alto'}, 
          ${Number(raio_metros) || 500}, 
          ${Number(lat)}, 
          ${Number(lng)}, 
          ${horario_inicio || '20:00:00'}, 
          ${horario_fim || '05:00:00'}, 
          TRUE
        )
        RETURNING *;
      `;

      res.status(201).json({ sucesso: true, zona: novaZona[0] });
    } catch (err) {
      console.error('Erro ao criar zona de risco:', err);
      res.status(500).json({ erro: 'Falha ao cadastrar zona de risco.' });
    }
  });

  router.delete('/seguranca/zonas-risco/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`DELETE FROM zonas_risco WHERE id = ${id};`;
      res.json({ sucesso: true, mensagem: 'Zona de risco removida com sucesso.' });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao excluir zona de risco.' });
    }
  });

  // =========================================================================
  // 8. DISPARO DE NOTIFICAÇÕES GLOBAIS EM MASSA (BROADCAST)
  // =========================================================================
  router.post('/notificacoes/broadcast', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { titulo, mensagem, publico } = req.body;
      if (!titulo || !mensagem) {
        return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
      }

      const publicoDestino = publico || 'todos';

      const novaNotificacao = await sql`
        INSERT INTO notificacoes_globais (titulo, mensagem, publico)
        VALUES (${titulo}, ${mensagem}, ${publicoDestino})
        RETURNING *;
      `;

      const socketInstancia = req.io || io;
      if (socketInstancia) {
        socketInstancia.emit('alerta_broadcast_geral', {
          titulo,
          mensagem,
          publico: publicoDestino,
          horario: new Date().toISOString()
        });
      }

      return res.status(201).json({ sucesso: true, notificacao: novaNotificacao[0] });
    } catch (err) {
      console.error('Erro ao enviar broadcast:', err);
      return res.status(500).json({ erro: 'Falha ao enviar notificação global.' });
    }
  });

  // =========================================================================
  // 9. RELATÓRIO EXECUTIVO CSV (COM SUPORTE A TOKEN VIA URL)
  // =========================================================================
  router.get('/relatorios/corridas.csv', autenticarCsv, verificarAdmin, async (req, res) => {
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

  return router;
}