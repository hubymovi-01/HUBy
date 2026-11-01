// routes/admin.routes.js - Métricas, Frota e Gestão Master HUBy
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

function autenticarCsv(req, res, next) {
  const tokenUrl = req.query.token;
  if (tokenUrl && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenUrl}`;
  }
  return autenticarToken(req, res, next);
}

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
  // 1. MÉTRICAS DA PLATAFORMA (COM CÁLCULO ATÔMICO VIA SALDO DA FROTA)
  // =========================================================================
  router.get('/metricas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const periodo = String(req.query.periodo || 'total').toLowerCase();

      let filtroPeriodo = sql``;
      if (periodo === 'hoje') {
        filtroPeriodo = sql`AND criado_em >= CURRENT_DATE`;
      } else if (periodo === '7d' || periodo === '7dias') {
        filtroPeriodo = sql`AND criado_em >= NOW() - INTERVAL '7 days'`;
      } else if (periodo === 'mes') {
        filtroPeriodo = sql`AND criado_em >= DATE_TRUNC('month', CURRENT_DATE)`;
      }

      // 1. Consulta corridas concluídas
      const statsFinanceiro = await sql`
        SELECT 
          COUNT(id) AS total_concluidas,
          COALESCE(SUM(valor_total), 0) AS faturamento_corridas
        FROM pedidos
        WHERE LOWER(status) = 'concluido' ${filtroPeriodo};
      `;

      let totalViagens = Number(statsFinanceiro[0]?.total_concluidas || 0);
      let faturamentoBruto = Number(statsFinanceiro[0]?.faturamento_corridas || 0);

      // 2. CONTINGÊNCIA INTELIGENTE NO BANCO:
      // Se não há pedidos concluídos, calcula com base no saldo acumulado dos condutores
      const saldoMotoristas = await sql`
        SELECT 
          COALESCE(SUM(saldo_carteira), 0) AS repasse_acumulado,
          COALESCE(SUM(total_corridas), 0) AS corridas_frota
        FROM motoristas;
      `;

      const repasseFrota = Number(saldoMotoristas[0]?.repasse_acumulado || 0);
      const corridasFrota = Number(saldoMotoristas[0]?.corridas_frota || 0);

      let repasseMotoristas = 0;
      let lucroHuby = 0;

      if (faturamentoBruto > 0) {
        repasseMotoristas = Number((faturamentoBruto * 0.85).toFixed(2));
        lucroHuby = Number((faturamentoBruto * 0.15).toFixed(2));
      } else if (repasseFrota > 0) {
        repasseMotoristas = repasseFrota;
        faturamentoBruto = Number((repasseFrota / 0.85).toFixed(2));
        lucroHuby = Number((faturamentoBruto * 0.15).toFixed(2));
        totalViagens = corridasFrota > 0 ? corridasFrota : 1;
      }

      // 3. Alertas de segurança
      let incidentesAtivos = 0;
      try {
        const inc = await sql`SELECT COUNT(*) AS total FROM incidentes_seguranca WHERE resolvido = FALSE;`;
        incidentesAtivos = Number(inc[0]?.total || 0);
      } catch (e) {
        incidentesAtivos = 0;
      }

      // 4. Distribuição por categoria
      const statsCat = await sql`
        SELECT COALESCE(sub_tipo_id, tipo, 'carro') AS cat, COUNT(id) AS qtd
        FROM pedidos
        GROUP BY COALESCE(sub_tipo_id, tipo, 'carro');
      `;
      const distribuicao_categorias = { carro: 0, moto: 0, entrega: 0 };
      statsCat.forEach(c => {
        const nome = String(c.cat).toLowerCase();
        if (nome.includes('moto')) distribuicao_categorias.moto += Number(c.qtd);
        else if (nome.includes('entrega') || nome.includes('frete')) distribuicao_categorias.entrega += Number(c.qtd);
        else distribuicao_categorias.carro += Number(c.qtd);
      });

      if (distribuicao_categorias.carro === 0 && faturamentoBruto > 0) {
        distribuicao_categorias.carro = totalViagens;
      }

      res.json({
        faturamentoBruto,
        lucroHuby,
        repasseMotoristas,
        viagensConcluidas: totalViagens,
        alertasSeguranca: incidentesAtivos,
        distribuicao_categorias
      });
    } catch (err) {
      console.error('Erro ao consolidar métricas:', err);
      res.status(500).json({ erro: 'Falha ao buscar métricas.' });
    }
  });

  // =========================================================================
  // 2. GESTÃO DE MOTORISTAS & FROTA
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
  // 5. CONSULTA E ATUALIZAÇÃO DE TARIFAS (COM REGRAS DE VALOR MÍNIMO E PICO)
  // =========================================================================
  router.get('/tarifas', async (req, res) => {
    try {
      const config = await sql`
        SELECT valor FROM configuracoes_plataforma 
        WHERE chave = 'tarifas' LIMIT 1;
      `;

      const tarifasPadrao = {
        taxa_plataforma: 15,
        carro: { base: 5.0, km: 2.5, min: 10.0 },
        moto: { base: 3.5, km: 1.8, min: 7.0 },
        entrega: { base: 4.0, km: 2.0, min: 8.0 }
      };

      if (config.length === 0 || !config[0].valor) {
        return res.json(tarifasPadrao);
      }

      res.json(config[0].valor);
    } catch (err) {
      console.error('Erro ao ler tarifas:', err);
      res.status(500).json({ erro: 'Falha ao buscar configurações tarifárias.' });
    }
  });

  router.put('/tarifas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const novasTarifas = req.body;

      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('tarifas', ${JSON.stringify(novasTarifas)}::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE
        SET valor = ${JSON.stringify(novasTarifas)}::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;

      // Notifica passageiros e motoristas conectados instantaneamente
      const socket = req.io || io;
      if (socket) {
        socket.emit('tarifas_atualizadas', novasTarifas);
      }

      res.json({ sucesso: true, mensagem: 'Tarifas e valores mínimos atualizados com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar tarifas:', err);
      res.status(500).json({ erro: 'Falha ao atualizar tarifas no banco.' });
    }
  });

  // =========================================================================
  // 6. GESTÃO DE CUPONS
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
      res.status(500).json({ erro: 'Falha ao listar cupons.' });
    }
  });

  router.post('/cupons', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { codigo, tipo, valor, limite_usos, expira_em } = req.body;
      if (!codigo || !valor) {
        return res.status(400).json({ erro: 'Código e valor são obrigatórios.' });
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
      res.status(500).json({ erro: 'Erro ao registrar cupom.' });
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
  // 7. SEGURANÇA E ZONAS DE RISCO
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
      res.status(500).json({ erro: 'Falha ao consultar incidentes.' });
    }
  });

  router.put('/seguranca/incidentes/:id/resolver', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`UPDATE incidentes_seguranca SET resolvido = TRUE WHERE id = ${id};`;
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao atualizar incidente.' });
    }
  });

  router.get('/seguranca/zonas-risco', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const zonas = await sql`
        SELECT id, nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim, ativo, criado_em
        FROM zonas_risco
        ORDER BY criado_em DESC;
      `;
      res.json(zonas);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao listar áreas de risco.' });
    }
  });

  router.post('/seguranca/zonas-risco', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim } = req.body;
      const novaZona = await sql`
        INSERT INTO zonas_risco (nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim, ativo)
        VALUES (${nome}, ${descricao || 'Área demarcada'}, ${nivel_risco || 'alto'}, ${Number(raio_metros) || 500}, ${Number(lat)}, ${Number(lng)}, ${horario_inicio || '20:00:00'}, ${horario_fim || '05:00:00'}, TRUE)
        RETURNING *;
      `;
      res.status(201).json({ sucesso: true, zona: novaZona[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao cadastrar zona de risco.' });
    }
  });

  router.delete('/seguranca/zonas-risco/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await sql`DELETE FROM zonas_risco WHERE id = ${id};`;
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao excluir zona.' });
    }
  });

  // =========================================================================
  // 8. BROADCAST
  // =========================================================================
  router.post('/notificacoes/broadcast', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { titulo, mensagem, publico } = req.body;
      const novaNotificacao = await sql`
        INSERT INTO notificacoes_globais (titulo, mensagem, publico)
        VALUES (${titulo}, ${mensagem}, ${publico || 'todos'})
        RETURNING *;
      `;
      const socketInstancia = req.io || io;
      if (socketInstancia) {
        socketInstancia.emit('alerta_broadcast_geral', { titulo, mensagem, publico: publico || 'todos' });
      }
      res.status(201).json({ sucesso: true, notificacao: novaNotificacao[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao enviar notificação.' });
    }
  });

  // =========================================================================
  // 9. RELATÓRIO CSV
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
      res.attachment(`huby-relatorio-${Date.now()}.csv`);
      res.send(csv);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao gerar CSV.' });
    }
  });

  return router;
}