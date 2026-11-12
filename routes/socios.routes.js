// routes/socios.routes.js - Gestão e Split 50/50 dos Sócios HUBy Sincronizado com o Painel Admin
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { lerTarifasDoBanco } from './admin.routes.js';

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

async function inicializarTabelasSocios() {
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
        socio_id INT REFERENCES socios_huby(id),
        socio_nome VARCHAR(100),
        valor NUMERIC(10,2) NOT NULL,
        chave_pix VARCHAR(150) NOT NULL,
        status VARCHAR(20) DEFAULT 'concluido',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const sociosExistentes = await sql`SELECT COUNT(*) AS total FROM socios_huby;`;
    if (Number(sociosExistentes[0]?.total || 0) === 0) {
      await sql`
        INSERT INTO socios_huby (nome, chave_pix, porcentagem, saldo_disponivel, total_retirado)
        VALUES 
          ('Sócio 1', 'pix1@huby.app.br', 50.00, 0.00, 0.00),
          ('Sócio 2', 'pix2@huby.app.br', 50.00, 0.00, 0.00);
      `;
    }
  } catch (err) {
    console.warn('Aviso ao inicializar tabelas dos sócios:', err.message);
  }
}
inicializarTabelasSocios();

const router = express.Router();

// Handler unificado para /saldo-divisao e /resumo
async function obterDivisaoSocios(req, res) {
  try {
    const tarifas = await lerTarifasDoBanco();
    const pctTaxa = Number(tarifas.taxa_plataforma || 15) / 100;

    const faturamento = await sql`
      SELECT COALESCE(SUM(valor_total), 0) AS bruto_concluido
      FROM pedidos
      WHERE LOWER(status) = 'concluido';
    `;

    const brutoTotal = Number(faturamento[0]?.bruto_concluido || 0);
    const lucroTotalPlataforma = Number((brutoTotal * pctTaxa).toFixed(2));
    const cotaBrutaSocio = Number((lucroTotalPlataforma / 2).toFixed(2));

    const socios = await sql`SELECT * FROM socios_huby ORDER BY id ASC LIMIT 2;`;
    const historicoRetiradas = await sql`
      SELECT * FROM retiradas_socios
      ORDER BY criado_em DESC
      LIMIT 50;
    `;

    const sociosFormatados = socios.map((s) => {
      const retirado = Number(s.total_retirado || 0);
      const saldoReal = Math.max(0, Number((cotaBrutaSocio - retirado).toFixed(2)));
      return {
        id: s.id,
        nome: s.nome,
        chave_pix: s.chave_pix || 'Não cadastrada',
        porcentagem: Number(s.porcentagem || 50),
        saldoDisponivel: saldoReal,
        saldo_disponivel: saldoReal,
        jaSacado: retirado,
        total_retirado: retirado
      };
    });

    res.json({
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

// Atualizar dados do sócio (compatível com /atualizar/:id e /:id)
async function atualizarSocioHandler(req, res) {
  const { id } = req.params;
  const { nome, chave_pix } = req.body;

  if (!nome) {
    return res.status(400).json({ erro: 'O nome do sócio é obrigatório.' });
  }

  try {
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

// Registrar retirada / saque do sócio (compatível com /retirar/:id e /retirada)
async function retirarSocioHandler(req, res) {
  const socioId = req.params.id || req.body.socio_id;
  const valorNum = parseFloat(String(req.body.valor ?? '').replace(',', '.'));

  if (!socioId || !valorNum || valorNum <= 0) {
    return res.status(400).json({ erro: 'Dados de retirada inválidos.' });
  }

  try {
    const socioReg = await sql`SELECT * FROM socios_huby WHERE id = ${socioId} LIMIT 1;`;
    if (!socioReg.length) return res.status(404).json({ erro: 'Sócio não encontrado.' });
    const socio = socioReg[0];

    if (!socio.chave_pix) {
      return res.status(400).json({ erro: 'Cadastre a chave Pix do sócio antes de retirar.' });
    }

    await sql`
      UPDATE socios_huby
      SET total_retirado = COALESCE(total_retirado, 0) + ${valorNum},
          atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ${socioId};
    `;

    await sql`
      INSERT INTO retiradas_socios (socio_id, socio_nome, valor, chave_pix, status)
      VALUES (${socioId}, ${socio.nome}, ${valorNum}, ${socio.chave_pix}, 'concluido');
    `;

    res.json({ sucesso: true, mensagem: `Retirada de R$ ${valorNum.toFixed(2).replace('.', ',')} registrada com sucesso!` });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao processar saque do sócio.' });
  }
}

router.post('/retirar/:id', autenticarToken, verificarAdmin, retirarSocioHandler);
router.post('/retirada', autenticarToken, verificarAdmin, retirarSocioHandler);

router.get('/historico-retiradas', autenticarToken, verificarAdmin, async (req, res) => {
  try {
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