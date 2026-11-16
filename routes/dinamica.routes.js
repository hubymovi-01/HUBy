// routes/dinamica.routes.js - Motor de Tarifa Dinâmica (Surge Pricing Automático, Manual e Zonas)
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { lerConfigDinamicaDoBanco } from './admin.routes.js';

const router = express.Router();

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

async function inicializarTabelaZonas() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS zonas_dinamicas (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        multiplicador NUMERIC(5,2) NOT NULL DEFAULT 1.00,
        centro_lat NUMERIC NOT NULL,
        centro_lng NUMERIC NOT NULL,
        raio_metros INT DEFAULT 2000,
        ativa BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (err) {
    console.warn('Aviso ao sincronizar tabela zonas_dinamicas:', err.message);
  }
}
inicializarTabelaZonas();

// =========================================================================
// 0. CALCULAR MULTIPLICADOR DINÂMICO EM TEMPO REAL (POR COORDENADA)
// =========================================================================
export async function calcularMultiplicadorAtual(lat = null, lng = null) {
  const cfg = await lerConfigDinamicaDoBanco();
  if (!cfg.ativa) {
    return { multiplicador: 1.0, motivo: 'normal', ativa: false };
  }

  let multiplicadorFinal = Math.max(1.0, Number(cfg.multiplicador_manual || 1.0));
  let motivo = multiplicadorFinal > 1.0 ? 'manual_admin' : 'normal';

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);

  // 1. Verifica zonas dinâmicas cadastradas no mapa
  if (!isNaN(latNum) && !isNaN(lngNum)) {
    try {
      const zonasAtivas = await sql`
        SELECT nome, multiplicador
        FROM zonas_dinamicas
        WHERE ativa = TRUE
          AND (
            6371000 * acos(
              LEAST(1.0, GREATEST(-1.0,
                cos(radians(${latNum})) * cos(radians(centro_lat)) *
                cos(radians(centro_lng) - radians(${lngNum})) +
                sin(radians(${latNum})) * sin(radians(centro_lat))
              ))
            )
          ) <= COALESCE(raio_metros, 2000)
        ORDER BY multiplicador DESC
        LIMIT 1;
      `;

      if (zonasAtivas.length > 0 && Number(zonasAtivas[0].multiplicador) > multiplicadorFinal) {
        multiplicadorFinal = Number(zonasAtivas[0].multiplicador);
        motivo = `zona:${zonasAtivas[0].nome}`;
      }
    } catch (eZona) {}
  }

  // 2. Cálculo automático pela relação Chamadas Pendentes vs Motoristas Online
  try {
    const pendentes = await sql`
      SELECT COUNT(id)::int AS qtd
      FROM pedidos
      WHERE status IN ('pendente', 'aguardando', 'buscando')
        AND criado_em >= NOW() - INTERVAL '20 minutes';
    `;

    const online = await sql`
      SELECT COUNT(id)::int AS qtd
      FROM motoristas
      WHERE status_online = TRUE AND status_aprovacao = 'aprovado';
    `;

    const qtdChamadas = Number(pendentes[0]?.qtd || 0);
    const qtdMotoristas = Math.max(1, Number(online[0]?.qtd || 0));
    const gatilho = Math.max(1, Number(cfg.gatilho_chamadas || 3));

    if (qtdChamadas >= gatilho) {
      const razaoDemanda = qtdChamadas / qtdMotoristas;
      const calcAuto = Math.min(
        Number(cfg.multiplicador_maximo || 1.8),
        Number((1.0 + (razaoDemanda * 0.25)).toFixed(1))
      );

      if (calcAuto > multiplicadorFinal) {
        multiplicadorFinal = calcAuto;
        motivo = 'alta_demanda_automatica';
      }
    }
  } catch (eAuto) {}

  multiplicadorFinal = Math.min(Number(cfg.multiplicador_maximo || 2.0), Math.max(1.0, Number(multiplicadorFinal.toFixed(2))));

  return {
    multiplicador: multiplicadorFinal,
    motivo,
    ativa: true
  };
}

router.get('/calcular', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const resultado = await calcularMultiplicadorAtual(lat, lng);
    res.json({ sucesso: true, ...resultado });
  } catch (err) {
    res.json({ sucesso: true, multiplicador: 1.0, motivo: 'normal', ativa: false });
  }
});

// =========================================================================
// 1. Listar todas as Zonas Dinâmicas
// =========================================================================
router.get('/', async (req, res) => {
  try {
    const zonas = await sql`
      SELECT id, nome, multiplicador, centro_lat, centro_lng, raio_metros, ativa, criado_em
      FROM zonas_dinamicas
      ORDER BY criado_em DESC;
    `;
    res.json(zonas);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar zonas dinâmicas.' });
  }
});

// =========================================================================
// 2. Criar Nova Zona Dinâmica
// =========================================================================
router.post('/', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { nome, multiplicador, centro_lat, centro_lng, raio_metros } = req.body;

    if (!nome || !multiplicador || !centro_lat || !centro_lng) {
      return res.status(400).json({ erro: 'Parâmetros incompletos para criação da zona.' });
    }

    const novaZona = await sql`
      INSERT INTO zonas_dinamicas (nome, multiplicador, centro_lat, centro_lng, raio_metros, ativa)
      VALUES (${nome}, ${Number(multiplicador)}, ${Number(centro_lat)}, ${Number(centro_lng)}, ${Number(raio_metros) || 2000}, TRUE)
      RETURNING *;
    `;

    res.status(201).json({ sucesso: true, zona: novaZona[0] });
  } catch (err) {
    console.error('Erro ao criar zona dinâmica:', err);
    res.status(500).json({ erro: 'Falha ao criar zona dinâmica.' });
  }
});

// =========================================================================
// 3. Alternar Ativação ou Excluir Zona
// =========================================================================
router.put('/:id/toggle', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const atualizada = await sql`
      UPDATE zonas_dinamicas SET ativa = NOT ativa WHERE id = ${id} RETURNING id, ativa;
    `;
    res.json({ sucesso: true, zona: atualizada[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao alternar zona.' });
  }
});

router.delete('/:id', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM zonas_dinamicas WHERE id = ${id};`;
    res.json({ sucesso: true, mensagem: 'Zona removida.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao deletar zona.' });
  }
});

export default router;