// routes/socios.routes.js - Gestão e Split 50/50 dos Sócios HUBy
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

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

    // Garante a existência dos dois sócios
    const sociosExistentes = await sql`SELECT COUNT(*) AS total FROM socios_huby;`;
    if (Number(sociosExistentes[0]?.total || 0) === 0) {
      await sql`
        INSERT INTO socios_huby (nome, chave_pix, porcentagem, saldo_disponivel, total_retirado)
        VALUES 
          ('Sócio 1', '', 50.00, 0.00, 0.00),
          ('Sócio 2', '', 50.00, 0.00, 0.00);
      `;
    }
  } catch (err) {
    console.warn('Aviso ao inicializar tabelas dos sócios:', err.message);
  }
}
inicializarTabelasSocios();

export default function sociosRoutes() {
  const router = express.Router();

  // 1. Obter dados dos sócios e saldos calculados
  router.get('/resumo', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      // Calcula 15% de lucro bruto total das corridas finalizadas
      const faturamento = await sql`
        SELECT COALESCE(SUM(valor_total * 0.15), 0) AS total_lucro_plataforma
        FROM pedidos
        WHERE LOWER(status) = 'concluido';
      `;
      const lucroTotalPlataforma = Number(faturamento[0]?.total_lucro_plataforma || 0);
      const cotaBrutaSocio = Number((lucroTotalPlataforma / 2).toFixed(2));

      const socios = await sql`SELECT * FROM socios_huby ORDER BY id ASC LIMIT 2;`;

      const sociosFormatados = socios.map((s) => {
        const retirado = Number(s.total_retirado || 0);
        const saldoReal = Math.max(0, Number((cotaBrutaSocio - retirado).toFixed(2)));
        return {
          id: s.id,
          nome: s.nome,
          chave_pix: s.chave_pix || '',
          porcentagem: Number(s.porcentagem || 50),
          saldo_disponivel: saldoReal,
          total_retirado: retirado
        };
      });

      res.json({
        lucroTotalPlataforma,
        socios: sociosFormatados
      });
    } catch (err) {
      console.error('Erro ao buscar resumo dos sócios:', err);
      res.status(500).json({ erro: 'Falha ao buscar dados contábeis dos sócios.' });
    }
  });

  // 2. Atualizar dados do sócio (nome e chave Pix)
  router.put('/:id', autenticarToken, verificarAdmin, async (req, res) => {
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
      console.error('Erro ao atualizar sócio:', err);
      res.status(500).json({ erro: 'Falha ao atualizar dados do sócio.' });
    }
  });

  // 3. Registrar retirada / saque do sócio
  router.post('/retirada', autenticarToken, verificarAdmin, async (req, res) => {
    const { socio_id, valor } = req.body;
    const valorNum = parseFloat(valor);

    if (!socio_id || !valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'Dados de retirada inválidos.' });
    }

    try {
      const socioReg = await sql`SELECT * FROM socios_huby WHERE id = ${socio_id} LIMIT 1;`;
      if (!socioReg.length) return res.status(404).json({ erro: 'Sócio não encontrado.' });
      const socio = socioReg[0];

      if (!socio.chave_pix) {
        return res.status(400).json({ erro: 'Cadastre a chave Pix do sócio antes de retirar.' });
      }

      // Atualiza total retirado
      await sql`
        UPDATE socios_huby
        SET total_retirado = total_retirado + ${valorNum},
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ${socio_id};
      `;

      // Grava no histórico
      await sql`
        INSERT INTO retiradas_socios (socio_id, socio_nome, valor, chave_pix, status)
        VALUES (${socio_id}, ${socio.nome}, ${valorNum}, ${socio.chave_pix}, 'concluido');
      `;

      res.json({ sucesso: true, mensagem: `Retirada de R$ ${valorNum.toFixed(2)} registrada com sucesso!` });
    } catch (err) {
      console.error('Erro ao processar retirada:', err);
      res.status(500).json({ erro: 'Falha ao processar saque do sócio.' });
    }
  });

  // 4. Histórico de retiradas dos sócios
  router.get('/historico-retiradas', autenticarToken, verificarAdmin, async (req, res) => {
    try {
      const historico = await sql`
        SELECT * FROM retiradas_socios
        ORDER BY criado_em DESC
        LIMIT 50;
      `;
      res.json(historico);
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
      res.status(500).json({ erro: 'Falha ao buscar histórico de retiradas.' });
    }
  });

  return router;
}