// routes/motorista.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// 1. Configurar ou Alternar Filtro "Direção de Casa"
router.put('/filtro-destino', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { lat, lng, ativo } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET destino_casa_lat = ${lat ? Number(lat) : null},
          destino_casa_lng = ${lng ? Number(lng) : null},
          destino_casa_ativo = ${!!ativo}
      WHERE id = ${usuarioId} OR usuario_id = ${usuarioId}
      RETURNING id, destino_casa_lat, destino_casa_lng, destino_casa_ativo;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });
    res.json({ sucesso: true, config: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar filtro de destino:', err);
    res.status(500).json({ erro: 'Falha ao salvar preferência de rota.' });
  }
});

// 2. Obter Perfil Completo com Dados Reais do Formulário de Cadastro
router.get('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';

    const mot = await sql`
      SELECT 
        m.id, 
        COALESCE(m.nome, u.nome, '') AS nome,
        COALESCE(m.email, u.email, '') AS email,
        COALESCE(m.telefone, u.telefone, '') AS telefone,
        COALESCE(m.categoria, 'carro') AS categoria, 
        COALESCE(m.saldo_carteira, 0) AS saldo_carteira,
        COALESCE(m.status_aprovacao, 'aprovado') AS status_aprovacao,
        COALESCE(m.foto_perfil_url, u.foto_perfil_url, '') AS foto_perfil_url,
        COALESCE(m.avaliacao_media, 5.0) AS avaliacao_media,
        COALESCE(m.total_corridas, 0) AS total_corridas,
        COALESCE(m.veiculo_modelo, '') AS veiculo_modelo,
        COALESCE(m.veiculo_placa, '') AS veiculo_placa,
        COALESCE(m.veiculo_cor, '') AS veiculo_cor,
        COALESCE(m.veiculo_ano, '') AS veiculo_ano,
        COALESCE(m.chave_pix_padrao, '') AS chave_pix_padrao
      FROM motoristas m
      FULL OUTER JOIN usuarios u ON (m.usuario_id = u.id OR m.id = u.id)
      WHERE m.id = ${usuarioId} 
         OR m.usuario_id = ${usuarioId} 
         OR u.id = ${usuarioId}
         OR (m.email = ${emailUsuario} AND ${emailUsuario} != '')
      LIMIT 1;
    `;

    if (mot.length > 0) {
      return res.json(mot[0]);
    }

    // Fallback de segurança se não houver registros
    res.json({
      id: usuarioId,
      nome: req.usuario.nome || '',
      email: emailUsuario,
      telefone: '',
      categoria: 'carro',
      saldo_carteira: 0,
      status_aprovacao: 'aprovado',
      foto_perfil_url: '',
      avaliacao_media: 5.0,
      total_corridas: 0,
      veiculo_modelo: '',
      veiculo_placa: '',
      veiculo_cor: '',
      veiculo_ano: '',
      chave_pix_padrao: ''
    });
  } catch (err) {
    console.error('Erro ao consultar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao obter perfil.' });
  }
});

// 3. Atualizar Dados do Perfil com Suporte a Foto e Auto-Criação
router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';
    const {
      nome, telefone, foto_perfil_url,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      chave_pix_padrao
    } = req.body;

    // Normaliza strings vazias para null
    const fNome = (nome && nome.trim()) ? nome.trim() : null;
    const fTel = (telefone && telefone.trim()) ? telefone.trim() : null;
    const fFoto = (foto_perfil_url && foto_perfil_url.trim()) ? foto_perfil_url.trim() : null;
    const fMod = (veiculo_modelo && veiculo_modelo.trim()) ? veiculo_modelo.trim() : null;
    const fPlaca = (veiculo_placa && veiculo_placa.trim()) ? veiculo_placa.trim().toUpperCase() : null;
    const fCor = (veiculo_cor && veiculo_cor.trim()) ? veiculo_cor.trim() : null;
    const fAno = (veiculo_ano && veiculo_ano.trim()) ? veiculo_ano.trim() : null;
    const fPix = (chave_pix_padrao && chave_pix_padrao.trim()) ? chave_pix_padrao.trim() : null;

    // 1. Tenta atualizar se o motorista já existe
    let mot = await sql`
      UPDATE motoristas
      SET 
        nome = COALESCE(${fNome}, nome),
        telefone = COALESCE(${fTel}, telefone),
        foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
        veiculo_modelo = COALESCE(${fMod}, veiculo_modelo),
        veiculo_placa = COALESCE(${fPlaca}, veiculo_placa),
        veiculo_cor = COALESCE(${fCor}, veiculo_cor),
        veiculo_ano = COALESCE(${fAno}, veiculo_ano),
        chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao)
      WHERE id = ${usuarioId} 
         OR usuario_id = ${usuarioId} 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      RETURNING *;
    `;

    // 2. Se não existia registro na tabela motoristas, cria um registro agora (UPSERT)
    if (mot.length === 0) {
      mot = await sql`
        INSERT INTO motoristas (
          usuario_id, nome, email, telefone, foto_perfil_url,
          veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, chave_pix_padrao,
          categoria, saldo_carteira, status_aprovacao
        ) VALUES (
          ${usuarioId}, 
          ${fNome || req.usuario.nome || 'Motorista'}, 
          ${emailUsuario}, 
          ${fTel || ''}, 
          ${fFoto || ''}, 
          ${fMod || ''}, 
          ${fPlaca || ''}, 
          ${fCor || ''}, 
          ${fAno || ''}, 
          ${fPix || ''},
          'carro', 0, 'aprovado'
        )
        RETURNING *;
      `;
    }

    // 3. Atualiza também a tabela de usuários para sincronizar
    await sql`
      UPDATE usuarios
      SET 
        nome = COALESCE(${fNome}, nome),
        telefone = COALESCE(${fTel}, telefone),
        foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url)
      WHERE id = ${usuarioId};
    `;

    res.json({ sucesso: true, motorista: mot[0] || {} });
  } catch (err) {
    console.error('Erro detalhado ao atualizar perfil do motorista:', err);
    res.status(500).json({ erro: err.message || 'Falha ao salvar dados do perfil.' });
  }
});

// 4. Extrato Financeiro
router.get('/extrato', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em
      FROM saques_motoristas
      WHERE motorista_id = ${usuarioId}
      ORDER BY criado_em DESC
      LIMIT 15;
    `;

    const corridas = await sql`
      SELECT 
        id, valor_total, 
        (valor_total * 0.85) AS repasse_liquido,
        valor_gorjeta, concluido_em, origem_endereco, destino_endereco
      FROM pedidos
      WHERE motorista_id = ${usuarioId} AND status = 'concluido'
      ORDER BY concluido_em DESC
      LIMIT 15;
    `;

    res.json({ saques, corridas });
  } catch (err) {
    console.error('Erro ao obter extrato:', err);
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

export default router;