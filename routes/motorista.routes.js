// routes/motorista.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// 1. Configurar ou Alternar Filtro "Direção de Casa"
router.put('/filtro-destino', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;
    const { lat, lng, ativo } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET destino_casa_lat = ${lat ? Number(lat) : null},
          destino_casa_lng = ${lng ? Number(lng) : null},
          destino_casa_ativo = ${!!ativo}
      WHERE id = ${motoristaId}
      RETURNING id, destino_casa_lat, destino_casa_lng, destino_casa_ativo;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });

    res.json({ sucesso: true, config: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar filtro de destino:', err);
    res.status(500).json({ erro: 'Falha ao salvar preferência de rota.' });
  }
});

// 2. Obter Perfil Completo do Motorista (Dados, Carro, Avaliação e Chave Pix)
router.get('/perfil', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;

    const mot = await sql`
      SELECT 
        id, nome, email, telefone, categoria, 
        saldo_carteira, status_aprovacao, foto_perfil_url,
        avaliacao_media, total_corridas,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
        chave_pix_padrao
      FROM motoristas
      WHERE id = ${motoristaId}
      LIMIT 1;
    `;

    if (mot.length === 0) {
      return res.status(404).json({ erro: 'Motorista não encontrado.' });
    }

    res.json(mot[0]);
  } catch (err) {
    console.error('Erro ao consultar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao obter perfil.' });
  }
});

// 3. Atualizar Dados do Perfil (Foto, Detalhes do Carro e Chave Pix)
router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;
    const { foto_perfil_url, veiculo_cor, veiculo_ano, chave_pix_padrao } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET 
        foto_perfil_url = COALESCE(${foto_perfil_url || null}, foto_perfil_url),
        veiculo_cor = COALESCE(${veiculo_cor || null}, veiculo_cor),
        veiculo_ano = COALESCE(${veiculo_ano || null}, veiculo_ano),
        chave_pix_padrao = COALESCE(${chave_pix_padrao || null}, chave_pix_padrao)
      WHERE id = ${motoristaId}
      RETURNING 
        id, nome, email, telefone, categoria, saldo_carteira, 
        status_aprovacao, foto_perfil_url, avaliacao_media, total_corridas,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, chave_pix_padrao;
    `;

    if (mot.length === 0) {
      return res.status(404).json({ erro: 'Motorista não encontrado.' });
    }

    res.json({ sucesso: true, motorista: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao atualizar dados.' });
  }
});

// 4. Extrato Financeiro Completo (Histórico de Saques e Ganhos por Viagem)
router.get('/extrato', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;

    // Buscar saques efetuados/solicitados
    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em
      FROM saques_motoristas
      WHERE motorista_id = ${motoristaId}
      ORDER BY criado_em DESC
      LIMIT 20;
    `;

    // Buscar corridas concluídas com repasses líquidos e gorjetas
    const corridas = await sql`
      SELECT 
        id, valor_total, 
        (valor_total * 0.85) AS repasse_liquido,
        valor_gorjeta, concluido_em, origem_endereco, destino_endereco
      FROM pedidos
      WHERE motorista_id = ${motoristaId} AND status = 'concluido'
      ORDER BY concluido_em DESC
      LIMIT 20;
    `;

    res.json({
      saques,
      corridas
    });
  } catch (err) {
    console.error('Erro ao consultar extrato financeiro:', err);
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

export default router;