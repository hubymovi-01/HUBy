// routes/admin.routes.js - Métricas, Frota, DRE dos Sócios, Saque Blindado e Gestão Master HUBy
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

  let filtroPeriodo = sql``;
  const per = String(periodo || 'total').toLowerCase().trim();
  if (per === 'hoje') {
    filtroPeriodo = sql`AND (COALESCE(concluido_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;
  } else if (per === '7d' || per === '7dias') {
    filtroPeriodo = sql`AND COALESCE(concluido_em, criado_em) >= NOW() - INTERVAL '7 days'`;
  } else if (per === 'mes') {
    filtroPeriodo = sql`AND COALESCE(concluido_em, criado_em) >= DATE_TRUNC('month', NOW())`;
  }

  const statsConcluidas = await sql`
    SELECT 
      COUNT(id)::int AS total_concluidas,
      COALESCE(SUM(valor_total), 0) AS faturamento_corridas
    FROM pedidos
    WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado')
    ${filtroPeriodo};
  `;

  let totalViagens = Number(statsConcluidas[0]?.total_concluidas || 0);
  let faturamentoBruto = Number(statsConcluidas[0]?.faturamento_corridas || 0);

  if (faturamentoBruto === 0) {
    const statsGeralConcluidas = await sql`
      SELECT 
        COUNT(id)::int AS total_concluidas,
        COALESCE(SUM(valor_total), 0) AS faturamento_corridas
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado');
    `;
    if (Number(statsGeralConcluidas[0]?.faturamento_corridas || 0) > 0) {
      totalViagens = Number(statsGeralConcluidas[0].total_concluidas || 0);
      faturamentoBruto = Number(statsGeralConcluidas[0].faturamento_corridas || 0);
    }
  }

  if (faturamentoBruto === 0) {
    try {
      const trans = await sql`
        SELECT 
          COUNT(id)::int AS qtd,
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

  if (faturamentoBruto === 0) {
    try {
      const cobsPagas = await sql`
        SELECT COUNT(id)::int AS qtd, COALESCE(SUM(valor), 0) AS soma
        FROM cobrancas_pix
        WHERE LOWER(COALESCE(status, '')) = 'pago';
      `;
      if (Number(cobsPagas[0]?.soma || 0) > 0) {
        faturamentoBruto = Number(Number(cobsPagas[0].soma).toFixed(2));
        totalViagens = Math.max(1, Number(cobsPagas[0].qtd || 1));
      }
    } catch (e) {}
  }

  if (faturamentoBruto === 0) {
    const statsPedidosAtivos = await sql`
      SELECT COUNT(id)::int AS qtd, COALESCE(SUM(valor_total), 0) AS soma
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) NOT IN ('cancelado', 'recusado')
        AND COALESCE(valor_total, 0) > 0;
    `;
    if (Number(statsPedidosAtivos[0]?.soma || 0) > 0) {
      faturamentoBruto = Number(Number(statsPedidosAtivos[0].soma).toFixed(2));
      totalViagens = Math.max(1, Number(statsPedidosAtivos[0].qtd || 1));
    }
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
  // 1. MÉTRICAS DA PLATAFORMA & SPLIT DE FATURAMENTO
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
  // 2. DRE / RELATÓRIO EXECUTIVO DA DIVISÃO DOS SÓCIOS
  // =========================================================================
  router.get('/financeiro/dre', autenticarToken, verificarAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const resumo = await calcularResumoFinanceiroReal('total');

      const saquesPendentes = await sql`
        SELECT COALESCE(SUM(valor), 0) AS total_a_pagar 
        FROM saques_motoristas 
        WHERE status = 'pendente';
      `;

      const saquesPagos = await sql`
        SELECT COALESCE(SUM(valor), 0) AS total_ja_pago 
        FROM saques_motoristas 
        WHERE status = 'pago';
      `;

      const receitaPlataforma = resumo.lucroHuby;
      const reservaOperacional = Number((receitaPlataforma * 0.20).toFixed(2));
      const lucroLiquidoSocios = Number((receitaPlataforma - reservaOperacional).toFixed(2));
      const cotaPorSocio = Number((lucroLiquidoSocios / 2).toFixed(2));

      res.json({
        metricasGerais: {
          corridasConcluidas: resumo.viagensConcluidas,
          faturamentoBruto: resumo.faturamentoBruto,
          repasseMotoristas: resumo.repasseMotoristas,
          receitaPlataforma
        },
        divisaoSocios: {
          fundoReservaTecnica: reservaOperacional,
          lucroDistribuivelTotal: lucroLiquidoSocios,
          proLaborePorSocio: cotaPorSocio
        },
        fluxoCaixaSaques: {
          saquesPendentesAprovacao: Number(saquesPendentes[0]?.total_a_pagar || 0),
          saquesLiquidados: Number(saquesPagos[0]?.total_ja_pago || 0)
        }
      });
    } catch (err) {
      console.error('Erro ao gerar relatório contábil DRE:', err);
      res.status(500).json({ erro: 'Falha ao consolidar dados contábeis.' });
    }
  });

  // =========================================================================
  // 3. GESTÃO DE MOTORISTAS & FROTA
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
  // 4. SAQUE AUTOMÁTICO BLINDADO CONTRA DUPLO CLIQUE + DISPARO PIX API
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
  // 5. MONITOR DE VIAGENS
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
  // 6. CONSULTA E ATUALIZAÇÃO DE TARIFAS
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

  // =========================================================================
  // 7. GATEWAY MERCADO PAGO
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
  // 8. GESTÃO DE CUPONS
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
  // 9. SEGURANÇA E ZONAS DE RISCO
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
  // 10. NOTIFICAÇÕES BROADCAST & RELATÓRIO CSV
  // =========================================================================
  router.post('/notificacoes/broadcast', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const { publico, titulo, mensagem } = req.body;
      if (!titulo || !mensagem) {
        return res.status(400).json({ erro: 'Título e mensagem são obrigatórios.' });
      }
      const pubLimpo = ['todos', 'motoristas', 'passageiros'].includes(publico) ? publico : 'todos';
      const titLimpo = String(titulo).trim().slice(0, 110);
      const msgLimpa = String(mensagem).trim().slice(0, 500);

      await sql`
        INSERT INTO notificacoes_globais (titulo, mensagem, publico)
        VALUES (${titLimpo}, ${msgLimpa}, ${pubLimpo});
      `;

      const socket = req.io || io;
      if (socket) {
        socket.emit('broadcast_alerta', { publico: pubLimpo, titulo: titLimpo, mensagem: msgLimpa });
      }

      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao disparar broadcast.' });
    }
  });

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