// routes/dinamica.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

// 1. Listar todas as Zonas Dinâmicas
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

// 2. Criar Nova Zona Dinâmica (Admin)
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

// 3. Alternar Ativação ou Excluir Zona
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