// routes/socios.routes.js - Gestão e Split 50/50 dos Sócios HUBy Sincronizado com o Painel Admin
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { calcularResumoFinanceiroReal, lerTarifasDoBanco } from './admin.routes.js';
import { executarTransferenciaPixMercadoPago } from './carteira.routes.js';

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase().trim();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

let tabelasGarantidas = false;

async function garantirTabelasSocios() {
  if (tabelasGarantidas) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS socios_huby (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        chave_pix VARCHAR(150),
        porcentagem NUMERIC(5,2) DEFAULT 50.00,
        saldo_disponivel NUMERIC(10,2) DEFAULT 0.00,
        total_retirado NUMERIC(10,2) DEFAULT 0.00,
        atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS retiradas_socios (
        id SERIAL PRIMARY KEY,
        socio_id INT,
        socio_nome VARCHAR(100),
        valor NUMERIC(10,2) NOT NULL,
        chave_pix VARCHAR(150) NOT NULL,
        comprovante_url TEXT,
        status VARCHAR(20) DEFAULT 'concluido',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`ALTER TABLE retiradas_socios ADD COLUMN IF NOT EXISTS comprovante_url TEXT;`;

    const sociosExistentes = await sql`SELECT COUNT(*)::int AS total FROM socios_huby;`;
    if (Number(sociosExistentes[0]?.total || 0) === 0) {
      await sql`
        INSERT INTO socios_huby (id, nome, chave_pix, porcentagem, saldo_disponivel, total_retirado)
        VALUES 
          (1, 'Sócio 1', 'pix1@huby.app.br', 50.00, 0.00, 0.00),
          (2, 'Sócio 2', 'pix2@huby.app.br', 50.00, 0.00, 0.00)
        ON CONFLICT (id) DO NOTHING;
      `;
    }
    tabelasGarantidas = true;
  } catch (err) {
    console.warn('Aviso ao inicializar tabelas dos sócios:', err.message);
  }
}

garantirTabelasSocios();

async function apurarLucroTotalPlataforma() {
  // 1. Usa o resumo financeiro oficial do admin.routes.js
  const resumo = await calcularResumoFinanceiroReal('total');
  let lucroTotal = Number(resumo.lucroHuby || 0);

  // 2. Fallback direto no banco caso haja corridas concluídas ou pagas ainda não contabilizadas
  if (lucroTotal <= 0) {
    const tarifas = await lerTarifasDoBanco();
    const pctTaxa = Number(tarifas.taxa_plataforma ?? 15) / 100;

    const ped = await sql`
      SELECT COALESCE(SUM(valor_total), 0) AS bruto
      FROM pedidos
      WHERE LOWER(TRIM(COALESCE(status, ''))) IN ('concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado');
    `;
    const brutoPedidos = Number(ped[0]?.bruto || 0);
    if (brutoPedidos > 0) {
      lucroTotal = Number((brutoPedidos * pctTaxa).toFixed(2));
    }
  }

  return lucroTotal;
}

const router = express.Router();

// ============================================================================
// 1. CONSULTAR DIVISÃO E SALDO REAL DE CADA SÓCIO (50% / 50%)
// ============================================================================
async function obterDivisaoSocios(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    await garantirTabelasSocios();

    const lucroTotalPlataforma = await apurarLucroTotalPlataforma();
    const socios = await sql`SELECT * FROM socios_huby ORDER BY id ASC LIMIT 2;`;

    const historicoRetiradas = await sql`
      SELECT * FROM retiradas_socios
      ORDER BY criado_em DESC
      LIMIT 50;
    `;

    const sociosFormatados = [];

    for (const s of socios) {
      const pct = Number(s.porcentagem || 50) / 100;
      const cotaBrutaSocio = Number((lucroTotalPlataforma * pct).toFixed(2));
      const retirado = Number(s.total_retirado || 0);
      const saldoReal = Math.max(0, Number((cotaBrutaSocio - retirado).toFixed(2)));

      // Sincroniza o saldo calculado na tabela socios_huby
      await sql`
        UPDATE socios_huby
        SET saldo_disponivel = ${saldoReal},
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ${s.id};
      `;

      sociosFormatados.push({
        id: s.id,
        nome: s.nome,
        chave_pix: s.chave_pix || 'Não cadastrada',
        porcentagem: Number(s.porcentagem || 50),
        cotaBruta: cotaBrutaSocio,
        saldoDisponivel: saldoReal,
        saldo_disponivel: saldoReal,
        jaSacado: retirado,
        total_retirado: retirado
      });
    }

    res.json({
      sucesso: true,
      lucroTotalPlataforma,
      socios: sociosFormatados,
      historicoRetiradas
    });
  } catch (err) {
    console.error('Erro ao buscar resumo dos sócios:', err);
    res.status(500).json({ erro: 'Falha ao buscar dados contábeis dos sócios.' });
  }
}

router.get('/saldo-divisao', autenticarToken, verificarAdmin, obterDivisaoSocios);
router.get('/resumo', autenticarToken, verificarAdmin, obterDivisaoSocios);

// ============================================================================
// 2. ATUALIZAR NOME E CHAVE PIX DO SÓCIO
// ============================================================================
async function atualizarSocioHandler(req, res) {
  const { id } = req.params;
  const { nome, chave_pix } = req.body;

  if (!nome || !nome.trim()) {
    return res.status(400).json({ erro: 'O nome do sócio é obrigatório.' });
  }

  try {
    await garantirTabelasSocios();

    const atualizado = await sql`
      UPDATE socios_huby
      SET nome = ${nome.trim()},
          chave_pix = ${chave_pix ? chave_pix.trim() : ''},
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ${id}
      RETURNING *;
    `;

    if (!atualizado.length) {
      return res.status(404).json({ erro: 'Sócio não localizado.' });
    }

    res.json({ sucesso: true, socio: atualizado[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao atualizar dados do sócio.' });
  }
}

router.put('/atualizar/:id', autenticarToken, verificarAdmin, atualizarSocioHandler);
router.put('/:id', autenticarToken, verificarAdmin, atualizarSocioHandler);

// ============================================================================
// 3. SOLICITAR RETIRADA DO SÓCIO (COM VALIDAÇÃO DE SALDO REAL + DISPARO PIX)
// ============================================================================
async function retirarSocioHandler(req, res) {
  const socioId = req.params.id || req.body.socio_id;
  const valorNum = Math.round((parseFloat(String(req.body.valor ?? '').replace(',', '.')) || 0) * 100) / 100;

  if (!socioId || !valorNum || valorNum <= 0) {
    return res.status(400).json({ erro: 'Informe um valor válido para retirada.' });
  }

  try {
    await garantirTabelasSocios();

    const socioReg = await sql`SELECT * FROM socios_huby WHERE id = ${socioId} LIMIT 1;`;
    if (!socioReg.length) return res.status(404).json({ erro: 'Sócio não encontrado.' });
    const socio = socioReg[0];

    if (!socio.chave_pix || socio.chave_pix.includes('pix1@huby') || socio.chave_pix.includes('pix2@huby')) {
      return res.status(400).json({ erro: 'Clique em "Editar" e cadastre a chave Pix real do sócio antes de retirar.' });
    }

    const lucroTotalPlataforma = await apurarLucroTotalPlataforma();
    const pct = Number(socio.porcentagem || 50) / 100;
    const cotaBruta = Number((lucroTotalPlataforma * pct).toFixed(2));
    const jaRetirado = Number(socio.total_retirado || 0);
    const disponivelReal = Math.max(0, Number((cotaBruta - jaRetirado).toFixed(2)));

    if (valorNum > disponivelReal) {
      return res.status(400).json({
        erro: `Saldo insuficiente. Disponível para ${socio.nome}: R$ ${disponivelReal.toFixed(2).replace('.', ',')}`
      });
    }

    // Tenta executar o Pix automático via API Mercado Pago (quando Payouts/CNPJ estiver ativo)
    const transferencia = await executarTransferenciaPixMercadoPago({
      saqueId: `socio_${socioId}_${Date.now()}`,
      valor: valorNum,
      chavePix: socio.chave_pix,
      tipoChave: 'cpf',
      motoristaNome: socio.nome
    });

    const novoRetirado = Number((jaRetirado + valorNum).toFixed(2));
    const novoSaldo = Math.max(0, Number((cotaBruta - novoRetirado).toFixed(2)));

    await sql`
      UPDATE socios_huby
      SET total_retirado = ${novoRetirado},
          saldo_disponivel = ${novoSaldo},
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ${socioId};
    `;

    await sql`
      INSERT INTO retiradas_socios (socio_id, socio_nome, valor, chave_pix, comprovante_url, status)
      VALUES (${socioId}, ${socio.nome}, ${valorNum}, ${socio.chave_pix}, ${transferencia.comprovanteId || 'registro_admin'}, 'concluido');
    `;

    res.json({
      sucesso: true,
      enviadoAutomaticoMP: transferencia.enviado,
      novoSaldo,
      mensagem: transferencia.enviado
        ? `⚡ Pix de R$ ${valorNum.toFixed(2).replace('.', ',')} transferido automaticamente para ${socio.nome}!`
        : `✅ Retirada de R$ ${valorNum.toFixed(2).replace('.', ',')} registrada para ${socio.nome}!`
    });
  } catch (err) {
    console.error('Erro na retirada do sócio:', err);
    res.status(500).json({ erro: 'Falha ao processar retirada do sócio.' });
  }
}

router.post('/retirar/:id', autenticarToken, verificarAdmin, retirarSocioHandler);
router.post('/retirada', autenticarToken, verificarAdmin, retirarSocioHandler);

router.get('/historico-retiradas', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    await garantirTabelasSocios();
    const historico = await sql`
      SELECT * FROM retiradas_socios
      ORDER BY criado_em DESC
      LIMIT 50;
    `;
    res.json(historico);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao buscar histórico de retiradas.' });
  }
});

export default router;