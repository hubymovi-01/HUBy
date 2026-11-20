// routes/admin.routes.js - Métricas Corporativas, Despesas, Agendamentos, Frota, Validades CNH/CRLV e Gestão Master HUBy
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { executarTransferenciaPixMercadoPago } from './carteira.routes.js';

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase().trim();
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

export function extrairObjetoJSONB(raw, fallback = {}) {
  if (!raw) return fallback;
  let atual = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof atual === 'string') {
      try {
        atual = JSON.parse(atual);
      } catch (e) {
        return fallback;
      }
    } else {
      break;
    }
  }
  return (atual && typeof atual === 'object') ? atual : fallback;
}

export const TARIFAS_PADRAO_SISTEMA = {
  taxa_plataforma: 15,
  carro: { base: 6.0, km: 2.2, min: 0.30 },
  moto: { base: 4.0, km: 1.4, min: 0.20 },
  entrega: { base: 5.0, km: 1.8, min: 0.25 }
};

export const CONFIG_INDICACAO_PADRAO = {
  ativo: true,
  desconto_indicado: 5.00,
  bonus_indicador: 5.00,
  bonus_motorista: 25.00,
  meta_corridas_motorista: 15
};

export const CONFIG_DINAMICA_PADRAO = {
  ativa: true,
  gatilho_chamadas: 3,
  multiplicador_maximo: 1.8,
  multiplicador_manual: 1.0
};

export async function lerTarifasDoBanco() {
  try {
    const config = await sql`
      SELECT valor::text AS valor_txt FROM configuracoes_plataforma 
      WHERE chave = 'tarifas' LIMIT 1;
    `;
    if (!config.length || !config[0].valor_txt) {
      return TARIFAS_PADRAO_SISTEMA;
    }
    const obj = extrairObjetoJSONB(config[0].valor_txt, TARIFAS_PADRAO_SISTEMA);
    return {
      taxa_plataforma: Number(obj.taxa_plataforma ?? 15),
      carro: {
        base: Number(obj.carro?.base ?? 6.0),
        km: Number(obj.carro?.km ?? 2.2),
        min: Number(obj.carro?.min ?? 0.30)
      },
      moto: {
        base: Number(obj.moto?.base ?? 4.0),
        km: Number(obj.moto?.km ?? 1.4),
        min: Number(obj.moto?.min ?? 0.20)
      },
      entrega: {
        base: Number(obj.entrega?.base ?? 5.0),
        km: Number(obj.entrega?.km ?? 1.8),
        min: Number(obj.entrega?.min ?? 0.25)
      }
    };
  } catch (err) {
    console.warn('Erro ao ler tarifas do banco:', err.message);
    return TARIFAS_PADRAO_SISTEMA;
  }
}

export async function lerConfigIndicacaoDoBanco() {
  try {
    const config = await sql`
      SELECT valor::text AS valor_txt FROM configuracoes_plataforma
      WHERE chave = 'programa_indicacao' LIMIT 1;
    `;
    if (!config.length || !config[0].valor_txt) {
      return CONFIG_INDICACAO_PADRAO;
    }
    const obj = extrairObjetoJSONB(config[0].valor_txt, CONFIG_INDICACAO_PADRAO);
    return {
      ativo: obj.ativo !== false,
      desconto_indicado: Number(obj.desconto_indicado ?? 5.00),
      bonus_indicador: Number(obj.bonus_indicador ?? 5.00),
      bonus_motorista: Number(obj.bonus_motorista ?? 25.00),
      meta_corridas_motorista: Number(obj.meta_corridas_motorista ?? 15)
    };
  } catch (err) {
    return CONFIG_INDICACAO_PADRAO;
  }
}

export async function lerConfigDinamicaDoBanco() {
  try {
    const config = await sql`
      SELECT valor::text AS valor_txt FROM configuracoes_plataforma
      WHERE chave = 'tarifa_dinamica' LIMIT 1;
    `;
    if (!config.length || !config[0].valor_txt) {
      return CONFIG_DINAMICA_PADRAO;
    }
    const obj = extrairObjetoJSONB(config[0].valor_txt, CONFIG_DINAMICA_PADRAO);
    return {
      ativa: obj.ativa !== false,
      gatilho_chamadas: Number(obj.gatilho_chamadas ?? 3),
      multiplicador_maximo: Number(obj.multiplicador_maximo ?? 1.8),
      multiplicador_manual: Number(obj.multiplicador_manual ?? 1.0)
    };
  } catch (err) {
    return CONFIG_DINAMICA_PADRAO;
  }
}

export async function calcularResumoFinanceiroReal(periodo = 'total') {
  const tarifasAtuais = await lerTarifasDoBanco();
  const taxaPct = Number(tarifasAtuais.taxa_plataforma ?? 15);
  const pctTaxa = taxaPct / 100;
  const pctMotorista = 1 - pctTaxa;

  try {
    await sql`
      UPDATE pedidos p
      SET status = 'concluido',
          forma_pagamento = COALESCE(p.forma_pagamento, 'pix_mp'),
          metodo_pgto = COALESCE(p.metodo_pgto, 'pix_mp'),
          concluido_em = COALESCE(p.concluido_em, CURRENT_TIMESTAMP)
      FROM cobrancas_pix c
      WHERE c.pedido_id = p.id
        AND LOWER(COALESCE(c.status, '')) = 'pago'
        AND LOWER(COALESCE(p.status, '')) <> 'concluido';
    `;
  } catch (e) {}

  const per = String(periodo || 'total').toLowerCase().trim();
  let statsConcluidas;

  if (per === 'hoje') {
    statsConcluidas = await sql`
      SELECT COUNT(id)::int AS total_concluidas, COALESCE(SUM(valor_total), 0) AS faturamento_corridas
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado')
        AND (COALESCE(concluido_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
    `;
  } else if (per === '7d' || per === '7dias') {
    statsConcluidas = await sql`
      SELECT COUNT(id)::int AS total_concluidas, COALESCE(SUM(valor_total), 0) AS faturamento_corridas
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado')
        AND COALESCE(concluido_em, criado_em) >= NOW() - INTERVAL '7 days';
    `;
  } else if (per === 'mes') {
    statsConcluidas = await sql`
      SELECT COUNT(id)::int AS total_concluidas, COALESCE(SUM(valor_total), 0) AS faturamento_corridas
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado')
        AND COALESCE(concluido_em, criado_em) >= DATE_TRUNC('month', NOW());
    `;
  } else {
    statsConcluidas = await sql`
      SELECT COUNT(id)::int AS total_concluidas, COALESCE(SUM(valor_total), 0) AS faturamento_corridas
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado');
    `;
  }

  let totalViagens = Number(statsConcluidas[0]?.total_concluidas || 0);
  let faturamentoBruto = Number(statsConcluidas[0]?.faturamento_corridas || 0);

  if (faturamentoBruto === 0 && per === 'total') {
    try {
      const trans = await sql`
        SELECT COUNT(id)::int AS qtd,
               COALESCE(SUM(CASE WHEN valor > 0 THEN valor / ${pctMotorista} ELSE ABS(valor) / ${pctTaxa} END), 0) AS bruto_estimado
        FROM transacoes_carteira
        WHERE tipo_transacao IN ('credito_corrida_pix_mp', 'desconto_comissao_viagem_especie', 'pagamento_corrida');
      `;
      if (Number(trans[0]?.bruto_estimado || 0) > 0) {
        faturamentoBruto = Number(Number(trans[0].bruto_estimado).toFixed(2));
        totalViagens = Math.max(1, Number(trans[0].qtd || 1));
      }
    } catch (e) {}
  }

  const repasseMotoristas = Number((faturamentoBruto * pctMotorista).toFixed(2));
  const lucroHuby = Number((faturamentoBruto - repasseMotoristas).toFixed(2));

  const statsCat = await sql`
    SELECT COALESCE(sub_tipo_id, tipo, 'carro') AS cat, COUNT(id)::int AS qtd
    FROM pedidos
    WHERE LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelado', 'recusado')
    GROUP BY COALESCE(sub_tipo_id, tipo, 'carro');
  `;

  const distribuicao_categorias = { carro: 0, moto: 0, entrega: 0 };
  statsCat.forEach(c => {
    const nome = String(c.cat).toLowerCase();
    if (nome.includes('moto') && !nome.includes('flash')) distribuicao_categorias.moto += Number(c.qtd);
    else if (nome.includes('entrega') || nome.includes('frete') || nome.includes('flash')) distribuicao_categorias.entrega += Number(c.qtd);
    else distribuicao_categorias.carro += Number(c.qtd);
  });

  const somaCat = distribuicao_categorias.carro + distribuicao_categorias.moto + distribuicao_categorias.entrega;
  if (somaCat === 0 && totalViagens > 0) {
    distribuicao_categorias.carro = totalViagens;
  }

  return {
    faturamentoBruto,
    lucroHuby,
    repasseMotoristas,
    viagensConcluidas: totalViagens,
    taxaPlataforma: taxaPct,
    distribuicao_categorias
  };
}

async function inicializarTabelasAdmin() {
  try {
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS cnh_validade DATE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS crlv_validade DATE;`;

    await sql`
      CREATE TABLE IF NOT EXISTS despesas_corporativas (
        id SERIAL PRIMARY KEY,
        descricao TEXT NOT NULL,
        categoria VARCHAR(40) DEFAULT 'operacional',
        valor NUMERIC(10,2) NOT NULL,
        data_referencia DATE DEFAULT CURRENT_DATE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

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

    await sql`
      CREATE TABLE IF NOT EXISTS configuracoes_plataforma (
        chave TEXT PRIMARY KEY,
        valor JSONB NOT NULL,
        atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Aviso ao sincronizar tabelas administrativas:', err.message);
  }
}
inicializarTabelasAdmin();

export default function adminRoutes(io) {
  const router = express.Router();

  // =========================================================================
  // 1. MÉTRICAS DA PLATAFORMA (CAIXA ÚNICO EMPRESA VS. FROTA)
  // =========================================================================
  router.get('/metricas', autenticarToken, verificarAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const periodo = String(req.query.periodo || 'total').toLowerCase();
      const resumo = await calcularResumoFinanceiroReal(periodo);

      let incidentesAtivos = 0;
      try {
        const inc = await sql`SELECT COUNT(*)::int AS total FROM incidentes_seguranca WHERE resolvido = FALSE;`;
        incidentesAtivos = Number(inc[0]?.total || 0);
      } catch (e) {
        incidentesAtivos = 0;
      }

      res.json({
        ...resumo,
        alertasSeguranca: incidentesAtivos
      });
    } catch (err) {
      console.error('Erro ao consolidar métricas:', err);
      res.status(500).json({ erro: 'Falha ao buscar métricas.' });
    }
  });

  // =========================================================================
  // 1.1 PAINEL RÁPIDO: NÚMEROS DO DIA
  // =========================================================================
  router.get('/resumo-dia', autenticarToken, verificarAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const tarifasAtuais = await lerTarifasDoBanco();
      const pctTaxa = Number(tarifasAtuais.taxa_plataforma ?? 15) / 100;

      const corridasHoje = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'pago', 'finalizado'))::int AS concluidas,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(status, ''))) = 'cancelado')::int AS canceladas,
          COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('pendente', 'a_caminho', 'em_viagem', 'em_andamento', 'chegou_local'))::int AS em_andamento,
          COALESCE(SUM(valor_total) FILTER (WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'pago', 'finalizado')), 0) AS faturamento_hoje
        FROM pedidos
        WHERE (COALESCE(concluido_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
      `;

      const frotaStatus = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE status_online = TRUE AND status_aprovacao = 'aprovado')::int AS online_agora,
          COUNT(*) FILTER (WHERE status_aprovacao = 'aprovado')::int AS total_aprovados
        FROM motoristas;
      `;

      const c = corridasHoje[0] || {};
      const f = frotaStatus[0] || {};
      const fatHoje = Number(c.faturamento_hoje || 0);
      const lucroHoje = Number((fatHoje * pctTaxa).toFixed(2));

      res.json({
        sucesso: true,
        corridasConcluidasHoje: Number(c.concluidas || 0),
        corridasEmAndamento: Number(c.em_andamento || 0),
        cancelamentosHoje: Number(c.canceladas || 0),
        faturamentoHoje: fatHoje,
        lucroHubyHoje: lucroHoje,
        motoristasOnline: Number(f.online_agora || 0),
        motoristasAprovados: Number(f.total_aprovados || 0)
      });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao consultar resumo do dia.' });
    }
  });

  // =========================================================================
  // 1.2 TELEMETRIA DE ERROS
  // =========================================================================
  router.post('/logs-erro', async (req, res) => {
    try {
      const { origem, rota, mensagem, stack } = req.body || {};
      if (!mensagem) return res.status(400).json({ erro: 'Mensagem ausente.' });

      await sql`
        INSERT INTO logs_erros_sistema (origem, rota, mensagem, stack)
        VALUES (
          ${String(origem || 'frontend').slice(0, 40)},
          ${String(rota || '').slice(0, 140)},
          ${String(mensagem).slice(0, 500)},
          ${String(stack || '').slice(0, 2000)}
        );
      `;
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao registrar log.' });
    }
  });

  router.get('/logs-erro', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const logs = await sql`
        SELECT id, origem, rota, mensagem, stack, criado_em
        FROM logs_erros_sistema
        ORDER BY criado_em DESC
        LIMIT 30;
      `;
      res.json(logs);
    } catch (err) {
      res.json([]);
    }
  });

  // =========================================================================
  // 2. GESTÃO DE MOTORISTAS & CONTROLE DE VALIDADE CNH / CRLV
  // =========================================================================
  router.get('/motoristas', autenticarToken, verificarAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS cnh_validade DATE;`;
      await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS crlv_validade DATE;`;
      await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS ultima_selfie_url TEXT;`;
      await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS ultima_selfie_em TIMESTAMP WITH TIME ZONE;`;

      const motoristas = await sql`
        SELECT id, nome, email, telefone, cnh_numero AS cnh,
               to_char(cnh_validade, 'YYYY-MM-DD') AS cnh_validade,
               to_char(crlv_validade, 'YYYY-MM-DD') AS crlv_validade,
               categoria AS categoria_veiculo, veiculo_modelo, veiculo_placa,
               veiculo_cor, veiculo_ano, doc_cnh_url, doc_crlv_url, foto_perfil_url,
               ultima_selfie_url, ultima_selfie_em,
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

  router.put('/motoristas/:id/validade-documentos', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const cnhVal = req.body.cnh_validade ? String(req.body.cnh_validade).slice(0, 10) : null;
      const crlvVal = req.body.crlv_validade ? String(req.body.crlv_validade).slice(0, 10) : null;

      const atualizado = await sql`
        UPDATE motoristas
        SET cnh_validade = ${cnhVal},
            crlv_validade = ${crlvVal}
        WHERE id::text = ${String(id)}::text
        RETURNING id, nome, to_char(cnh_validade, 'YYYY-MM-DD') AS cnh_validade, to_char(crlv_validade, 'YYYY-MM-DD') AS crlv_validade;
      `;

      if (!atualizado.length) {
        return res.status(404).json({ erro: 'Motorista não encontrado.' });
      }

      res.json({ sucesso: true, motorista: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao atualizar validade dos documentos.' });
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
      const motivoRecusa = acao === 'recusar' ? String(motivo || 'Documentação ou perfil em desacordo.').slice(0, 200) : null;

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
  // 3. SAQUE AUTOMÁTICO BLINDADO CONTRA DUPLO CLIQUE + DISPARO PIX API
  // =========================================================================
  router.post('/motoristas/saque/automatico', autenticarToken, async (req, res) => {
    const motoristaId = String(req.usuario?.id || '');
    const { valor, chavePix, tipoChave } = req.body;
    const valorSaque = Math.round((Number(valor) || 0) * 100) / 100;

    if (!valorSaque || valorSaque <= 0) {
      return res.status(400).json({ erro: 'Informe um valor válido para saque.' });
    }
    if (!chavePix || String(chavePix).trim().length < 3) {
      return res.status(400).json({ erro: 'Chave Pix de destino é obrigatória.' });
    }

    try {
      const debitado = await sql`
        UPDATE motoristas
        SET saldo_carteira = saldo_carteira - ${valorSaque}
        WHERE (id::text = ${motoristaId} OR usuario_id::text = ${motoristaId})
          AND status_aprovacao = 'aprovado'
          AND COALESCE(saldo_carteira, 0) >= ${valorSaque}
        RETURNING id, nome, saldo_carteira;
      `;

      if (!debitado.length) {
        return res.status(400).json({ erro: 'Saldo insuficiente ou cadastro pendente de aprovação.' });
      }

      const mot = debitado[0];
      const reg = await sql`
        INSERT INTO saques_motoristas (motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status, solicitado_em)
        VALUES (${mot.id}, ${mot.nome}, ${String(chavePix).trim()}, ${String(tipoChave || 'cpf').slice(0, 20)}, ${valorSaque}, 'pendente', CURRENT_TIMESTAMP)
        RETURNING id;
      `;

      const saqueId = reg[0].id;

      const disp = await executarTransferenciaPixMercadoPago({
        saqueId,
        valor: valorSaque,
        chavePix: String(chavePix).trim(),
        tipoChave: String(tipoChave || 'cpf').slice(0, 20),
        motoristaNome: mot.nome
      });

      if (disp.enviado) {
        await sql`
          UPDATE saques_motoristas
          SET status = 'pago', comprovante_url = ${disp.comprovanteId}, pago_em = CURRENT_TIMESTAMP
          WHERE id = ${saqueId};
        `;
      }

      res.json({
        sucesso: true,
        pagoAutomatico: disp.enviado,
        mensagem: disp.enviado
          ? '⚡ Saque Pix transferido automaticamente para sua conta!'
          : 'Solicitação de saque registrada com segurança!',
        saqueId,
        novoSaldo: Number(mot.saldo_carteira),
        valorTransferido: valorSaque
      });
    } catch (err) {
      console.error('Erro no saque:', err);
      res.status(500).json({ erro: 'Erro ao processar solicitação de saque.' });
    }
  });

  router.get('/saques', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const saques = await sql`
        SELECT id, motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status, 
               COALESCE(criado_em, solicitado_em) AS criado_em, pago_em, motivo_recusa, comprovante_url
        FROM saques_motoristas
        ORDER BY 
          CASE WHEN status = 'processando' THEN 1 WHEN status = 'pendente' THEN 2 ELSE 3 END,
          COALESCE(criado_em, solicitado_em) DESC
        LIMIT 100;
      `;
      res.json(saques);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao listar histórico de saques.' });
    }
  });

  // =========================================================================
  // 4. MONITOR DE VIAGENS
  // =========================================================================
  router.get('/pedidos', autenticarToken, verificarAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const viagens = await sql`
        SELECT id, criado_em, concluido_em, tipo, sub_tipo_label, distancia_km, valor_total, motorista_nome, status, forma_pagamento
        FROM pedidos
        ORDER BY COALESCE(concluido_em, criado_em) DESC
        LIMIT 100;
      `;
      res.json(viagens);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao listar corridas.' });
    }
  });

  // =========================================================================
  // 5. CONSULTA E ATUALIZAÇÃO DE TARIFAS, INDICAÇÃO E DINÂMICA
  // =========================================================================
  router.get('/tarifas', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const tarifas = await lerTarifasDoBanco();
    res.json(tarifas);
  });

  router.put('/tarifas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const body = req.body || {};

      const lerNum = (val, padrao) => {
        const n = Number(String(val ?? '').replace(',', '.'));
        return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : padrao;
      };

      const novasTarifas = {
        taxa_plataforma: lerNum(body.taxa_plataforma, 15),
        carro: {
          base: lerNum(body.carro?.base, 6.0),
          km: lerNum(body.carro?.km, 2.2),
          min: lerNum(body.carro?.min, 0.30)
        },
        moto: {
          base: lerNum(body.moto?.base, 4.0),
          km: lerNum(body.moto?.km, 1.4),
          min: lerNum(body.moto?.min, 0.20)
        },
        entrega: {
          base: lerNum(body.entrega?.base, 5.0),
          km: lerNum(body.entrega?.km, 1.8),
          min: lerNum(body.entrega?.min, 0.25)
        }
      };

      const jsonTexto = JSON.stringify(novasTarifas);

      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('tarifas', (${jsonTexto}::text)::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE
        SET valor = (${jsonTexto}::text)::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;

      const socket = req.io || io;
      if (socket) {
        socket.emit('tarifas_atualizadas', novasTarifas);
      }

      res.json({
        sucesso: true,
        tarifas: novasTarifas,
        mensagem: 'Tarifas atualizadas com sucesso no banco de dados!'
      });
    } catch (err) {
      console.error('Erro ao atualizar tarifas:', err);
      res.status(500).json({ erro: 'Falha ao atualizar tarifas no banco.' });
    }
  });

  router.get('/config/indicacao', autenticarToken, verificarAdmin, async (req, res) => {
    const cfg = await lerConfigIndicacaoDoBanco();
    res.json(cfg);
  });

  router.put('/config/indicacao', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const cfg = {
        ativo: body.ativo !== false,
        desconto_indicado: Math.max(0, Number(body.desconto_indicado ?? 5.00)),
        bonus_indicador: Math.max(0, Number(body.bonus_indicador ?? 5.00)),
        bonus_motorista: Math.max(0, Number(body.bonus_motorista ?? 25.00)),
        meta_corridas_motorista: Math.max(1, parseInt(body.meta_corridas_motorista, 10) || 15)
      };
      const jsonStr = JSON.stringify(cfg);

      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('programa_indicacao', (${jsonStr}::text)::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE
        SET valor = (${jsonStr}::text)::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;

      res.json({ sucesso: true, config: cfg });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao salvar configuração de indicação.' });
    }
  });

  router.get('/config/dinamica', autenticarToken, verificarAdmin, async (req, res) => {
    const cfg = await lerConfigDinamicaDoBanco();
    res.json(cfg);
  });

  router.put('/config/dinamica', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const cfg = {
        ativa: body.ativa !== false,
        gatilho_chamadas: Math.max(1, parseInt(body.gatilho_chamadas, 10) || 3),
        multiplicador_maximo: Math.min(4.0, Math.max(1.0, Number(body.multiplicador_maximo ?? 1.8))),
        multiplicador_manual: Math.min(4.0, Math.max(1.0, Number(body.multiplicador_manual ?? 1.0)))
      };
      const jsonStr = JSON.stringify(cfg);

      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('tarifa_dinamica', (${jsonStr}::text)::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) DO UPDATE
        SET valor = (${jsonStr}::text)::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;

      const socket = req.io || io;
      if (socket) {
        socket.emit('dinamica_atualizada', cfg);
      }

      res.json({ sucesso: true, config: cfg });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao salvar configuração de tarifa dinâmica.' });
    }
  });

  // =========================================================================
  // 6. GATEWAY MERCADO PAGO
  // =========================================================================
  router.get('/gateway/mercadopago', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const config = await sql`
        SELECT valor::text AS valor_txt FROM configuracoes_plataforma 
        WHERE chave = 'gateway_mercadopago' 
        LIMIT 1;
      `;
      if (!config.length || !config[0].valor_txt) {
        return res.json({ configurado: false, access_token_mascarado: '', public_key: '', taxa_percentual: 0.99 });
      }
      const val = extrairObjetoJSONB(config[0].valor_txt, {});
      const tokenReal = String(val.access_token || '');
      const mascarado = tokenReal.length > 12
        ? `${tokenReal.slice(0, 10)}••••••••••••${tokenReal.slice(-4)}`
        : (tokenReal ? '••••••••' : '');

      res.json({
        configurado: Boolean(tokenReal),
        access_token_mascarado: mascarado,
        public_key: val.public_key || '',
        taxa_percentual: val.taxa_percentual ?? 0.99
      });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao consultar configurações do gateway.' });
    }
  });

  router.put('/gateway/mercadopago', autenticarToken, verificarAdmin, async (req, res) => {
    const { access_token, public_key, taxa_percentual } = req.body;

    if (!access_token || !access_token.trim() || access_token.includes('••••')) {
      return res.status(400).json({ erro: 'Insira um Access Token válido para atualizar.' });
    }

    try {
      const dados = {
        access_token: access_token.trim(),
        public_key: (public_key || '').trim(),
        taxa_percentual: Number(taxa_percentual) || 0.99
      };

      const jsonGw = JSON.stringify(dados);

      await sql`
        INSERT INTO configuracoes_plataforma (chave, valor, atualizado_em)
        VALUES ('gateway_mercadopago', (${jsonGw}::text)::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (chave) 
        DO UPDATE SET valor = (${jsonGw}::text)::jsonb, atualizado_em = CURRENT_TIMESTAMP;
      `;

      res.json({ sucesso: true, mensagem: 'Credenciais do Mercado Pago salvas com segurança!' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao salvar credenciais no banco.' });
    }
  });

  // =========================================================================
  // 7. GESTÃO DE CUPONS
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
      res.status(500).json({ erro: 'Falha ao listar cupons.' });
    }
  });

  router.post('/cupons', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { codigo, tipo, valor, limite_usos, expira_em } = req.body;
      if (!codigo || !valor) {
        return res.status(400).json({ erro: 'Código e valor são obrigatórios.' });
      }

      const codigoLimpo = String(codigo).replace(/[^A-Z0-9_-]/gi, '').trim().toUpperCase().slice(0, 25);
      const tipoCupom = tipo === 'porcentagem' ? 'porcentagem' : 'fixo';
      const valorNum = Math.max(0.5, Number(valor) || 0);
      const limiteNum = Math.max(1, parseInt(limite_usos, 10) || 100);
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
  // 8. SEGURANÇA E ZONAS DE RISCO
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
        VALUES (${String(nome || '').slice(0, 90)}, ${String(descricao || 'Área demarcada').slice(0, 200)}, ${nivel_risco || 'alto'}, ${Number(raio_metros) || 500}, ${Number(lat)}, ${Number(lng)}, ${horario_inicio || '20:00:00'}, ${horario_fim || '05:00:00'}, TRUE)
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
  // 9. DISPARO DE PUSH (BROADCAST)
  // =========================================================================
  router.post('/notificacoes/broadcast', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { publico = 'todos', regiao = 'todas', titulo, mensagem } = req.body;

      if (!String(titulo || '').trim() || !String(mensagem || '').trim()) {
        return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
      }

      const payload = {
        publico: String(publico).trim(),
        regiao: String(regiao || 'todas').trim(),
        titulo: String(titulo).trim(),
        mensagem: String(mensagem).trim(),
        criado_em: new Date().toISOString()
      };

      const socket = req.app.get('io') || io;
      if (socket) {
        socket.emit('nova_notificacao_push', payload);
      }

      res.json({ sucesso: true, payload });
    } catch (err) {
      console.error('Erro ao disparar broadcast push:', err);
      res.status(500).json({ erro: 'Falha ao disparar notificação push.' });
    }
  });

  // =========================================================================
  // 10. RELATÓRIO FINANCEIRO E CONTÁBIL (CSV UNIFICADO)
  // =========================================================================
  router.get('/relatorios/corridas.csv', autenticarCsv, verificarAdmin, async (req, res) => {
    try {
      const tarifas = await lerTarifasDoBanco();
      const taxaPct = Number(tarifas.taxa_plataforma ?? 15) / 100;

      const registros = await sql`
        WITH saques AS (
          SELECT motorista_id, COALESCE(SUM(valor), 0) AS total_saques
          FROM saques_motoristas
          WHERE status = 'pago'
          GROUP BY motorista_id
        ),
        corridas AS (
          SELECT motorista_id,
                 COUNT(id) AS total_viagens,
                 COALESCE(SUM(valor_total) FILTER (WHERE forma_pagamento IN ('pix_mp', 'pix', 'cartao_maquininha')), 0) AS entradas_app,
                 COALESCE(SUM(valor_total), 0) AS faturamento_bruto
          FROM pedidos
          WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'pago', 'finalizado')
          GROUP BY motorista_id
        )
        SELECT 
          m.id, m.nome, m.cpf, m.chave_pix_padrao, m.saldo_carteira, m.criado_em,
          COALESCE(s.total_saques, 0) AS saques_realizados,
          COALESCE(c.entradas_app, 0) AS entradas_app,
          COALESCE(c.faturamento_bruto, 0) AS faturamento_bruto,
          COALESCE(c.total_viagens, 0) AS total_viagens
        FROM motoristas m
        LEFT JOIN saques s ON m.id::text = s.motorista_id::text
        LEFT JOIN corridas c ON m.id::text = c.motorista_id::text
        ORDER BY m.nome ASC;
      `;

      let csv = '\ufeffID_Motorista;Nome;CPF;Chave_PIX;Data_Cadastro;Total_Viagens;Faturamento_Bruto;Entradas_Digitais_Pix;Taxa_Empresa_HUBy;Saques_Pagos;Saldo_Atual_Carteira\n';

      const formatarMoedaBR = (num) => Number(num).toFixed(2).replace('.', ',');
      const formatarData = (data) => new Date(data).toLocaleDateString('pt-BR');

      registros.forEach(r => {
        const fatBruto = Number(r.faturamento_bruto || 0);
        const taxaPlataforma = fatBruto * taxaPct;

        csv += `"${r.id}";"${r.nome || ''}";"${r.cpf || ''}";"${r.chave_pix_padrao || ''}";"${formatarData(r.criado_em)}";"${r.total_viagens}";"${formatarMoedaBR(fatBruto)}";"${formatarMoedaBR(r.entradas_app)}";"${formatarMoedaBR(taxaPlataforma)}";"${formatarMoedaBR(r.saques_realizados)}";"${formatarMoedaBR(r.saldo_carteira)}"\n`;
      });

      res.header('Content-Type', 'text/csv; charset=utf-8');
      res.attachment(`huby-relatorio-contabil-${Date.now()}.csv`);
      res.send(csv);
    } catch (err) {
      console.error('Erro ao gerar CSV financeiro:', err);
      res.status(500).json({ erro: 'Falha ao gerar relatório.' });
    }
  });

  // =========================================================================
  // 11. PAINEL DE DESPESAS CORPORATIVAS (CAIXA LÍQUIDO REAL DA EMPRESA)
  // =========================================================================
  router.get('/financeiro/despesas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS despesas_corporativas (
          id SERIAL PRIMARY KEY,
          descricao TEXT NOT NULL,
          categoria VARCHAR(40) DEFAULT 'operacional',
          valor NUMERIC(10,2) NOT NULL,
          data_referencia DATE DEFAULT CURRENT_DATE,
          criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      const lista = await sql`
        SELECT id, descricao, categoria, valor, to_char(data_referencia, 'YYYY-MM-DD') AS data_referencia, criado_em
        FROM despesas_corporativas
        ORDER BY data_referencia DESC, id DESC
        LIMIT 100;
      `;
      res.json(lista);
    } catch (err) {
      res.json([]);
    }
  });

  router.post('/financeiro/despesas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { descricao, categoria = 'operacional', valor, data_referencia } = req.body || {};
      const valorNum = Math.round((Number(String(valor ?? '').replace(',', '.')) || 0) * 100) / 100;
      if (!descricao || !String(descricao).trim() || valorNum <= 0) {
        return res.status(400).json({ erro: 'Informe descrição e valor válido.' });
      }
      const dataRef = data_referencia ? String(data_referencia).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const [nova] = await sql`
        INSERT INTO despesas_corporativas (descricao, categoria, valor, data_referencia)
        VALUES (${String(descricao).trim().slice(0, 200)}, ${String(categoria).trim()}, ${valorNum}, ${dataRef})
        RETURNING *;
      `;
      res.status(201).json({ sucesso: true, despesa: nova });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao registrar despesa corporativa.' });
    }
  });

  router.delete('/financeiro/despesas/:id', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      await sql`DELETE FROM despesas_corporativas WHERE id = ${Number(req.params.id)};`;
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao excluir despesa.' });
    }
  });

  // =========================================================================
  // 12. CENTRAL DE AGENDAMENTOS DO ADMIN (MONITORAMENTO E LIBERAÇÃO MANUAL)
  // =========================================================================
  router.get('/agendamentos', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const lista = await sql`
        SELECT p.id, p.cliente_id, u.nome AS cliente_nome, u.telefone AS cliente_telefone,
               p.motorista_id, p.motorista_nome, p.sub_tipo_label,
               p.origem_endereco, p.destino_endereco, p.valor_total,
               p.observacao, p.cupom_codigo, p.status, p.agendado_para, p.criado_em
        FROM pedidos p
        LEFT JOIN usuarios u ON p.cliente_id::text = u.id::text
        WHERE p.agendado_para IS NOT NULL
          AND LOWER(COALESCE(p.status, '')) IN ('agendado', 'pendente', 'a_caminho', 'em_viagem')
        ORDER BY p.agendado_para ASC
        LIMIT 80;
      `;
      res.json(lista);
    } catch (err) {
      res.json([]);
    }
  });

  router.put('/agendamentos/:id/liberar-agora', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const [pedido] = await sql`
        UPDATE pedidos
        SET status = 'pendente'
        WHERE id::text = ${String(id)}::text
        RETURNING *;
      `;
      if (!pedido) return res.status(404).json({ erro: 'Agendamento não localizado.' });

      const socket = req.io || io;
      if (socket) {
        socket.emit('nova_chamada', {
          id: pedido.id,
          clienteId: pedido.cliente_id,
          tipo: pedido.tipo || 'carro',
          subTipoLabel: `${pedido.sub_tipo_label || 'HUBy'} (Prioridade Admin)`,
          origem: pedido.origem_endereco,
          destino: pedido.destino_endereco,
          distanciaKm: Number(pedido.distancia_km || 0),
          duracaoMin: Number(pedido.duracao_min || 0),
          valorTotal: Number(pedido.valor_total || 0),
          agendadoPara: pedido.agendado_para,
          observacao: pedido.observacao || ''
        });
      }

      res.json({ sucesso: true, pedido });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao liberar agendamento no radar.' });
    }
  });

  return router;
}