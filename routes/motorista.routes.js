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

// 2. Obter Perfil Completo com Dados de Cadastro
router.get('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';

    // Busca tanto pelo id direto quanto por usuario_id ou email
    const mot = await sql`
      SELECT 
        m.id, 
        COALESCE(m.nome, u.nome, 'Motorista') AS nome,
        COALESCE(m.email, u.email) AS email,
        COALESCE(m.telefone, u.telefone, '---') AS telefone,
        COALESCE(m.categoria, 'carro') AS categoria, 
        COALESCE(m.saldo_carteira, 0) AS saldo_carteira,
        COALESCE(m.status_aprovacao, 'aprovado') AS status_aprovacao,
        COALESCE(m.foto_perfil_url, u.foto_perfil_url, '') AS foto_perfil_url,
        COALESCE(m.avaliacao_media, 5.0) AS avaliacao_media,
        COALESCE(m.total_corridas, 0) AS total_corridas,
        COALESCE(m.veiculo_modelo, 'Carro Padrão') AS veiculo_modelo,
        COALESCE(m.veiculo_placa, 'HUB-0000') AS veiculo_placa,
        COALESCE(m.veiculo_cor, 'Não informada') AS veiculo_cor,
        COALESCE(m.veiculo_ano, '2022') AS veiculo_ano,
        COALESCE(m.chave_pix_padrao, '') AS chave_pix_padrao
      FROM motoristas m
      LEFT JOIN usuarios u ON (m.usuario_id = u.id OR m.id = u.id)
      WHERE m.id = ${usuarioId} 
         OR m.usuario_id = ${usuarioId} 
         OR (m.email = ${emailUsuario} AND ${emailUsuario} != '')
      LIMIT 1;
    `;

    if (mot.length > 0) {
      return res.json(mot[0]);
    }

    // Se ainda não existir registro na tabela motoristas, lê de usuarios e cria
    const usr = await sql`SELECT id, nome, email, telefone FROM usuarios WHERE id = ${usuarioId} LIMIT 1;`;
    if (usr.length > 0) {
      const u = usr[0];
      const novoMot = await sql`
        INSERT INTO motoristas (usuario_id, nome, email, telefone, categoria, status_aprovacao, saldo_carteira)
        VALUES (${u.id}, ${u.nome}, ${u.email}, ${u.telefone || ''}, 'carro', 'aprovado', 0)
        ON CONFLICT DO NOTHING
        RETURNING *;
      `;
      return res.json(novoMot[0] || {
        id: u.id, nome: u.nome, email: u.email, telefone: u.telefone,
        categoria: 'carro', saldo_carteira: 0, status_aprovacao: 'aprovado',
        veiculo_modelo: 'Carro Padrão', veiculo_placa: 'HUB-0000', veiculo_cor: 'Não informada',
        veiculo_ano: '2022', avaliacao_media: 5.0, total_corridas: 0, foto_perfil_url: '', chave_pix_padrao: ''
      });
    }

    res.status(404).json({ erro: 'Cadastro de motorista não encontrado.' });
  } catch (err) {
    console.error('Erro ao consultar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao obter perfil.' });
  }
});

// 3. Atualizar Dados do Perfil (Foto, Veículo, Nome, Chave Pix)
router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';
    const { 
      nome, telefone, foto_perfil_url, 
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, 
      chave_pix_padrao 
    } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET 
        nome = COALESCE(${nome || null}, nome),
        telefone = COALESCE(${telefone || null}, telefone),
        foto_perfil_url = COALESCE(${foto_perfil_url || null}, foto_perfil_url),
        veiculo_modelo = COALESCE(${veiculo_modelo || null}, veiculo_modelo),
        veiculo_placa = COALESCE(${veiculo_placa || null}, veiculo_placa),
        veiculo_cor = COALESCE(${veiculo_cor || null}, veiculo_cor),
        veiculo_ano = COALESCE(${veiculo_ano || null}, veiculo_ano),
        chave_pix_padrao = COALESCE(${chave_pix_padrao || null}, chave_pix_padrao)
      WHERE id = ${usuarioId} 
         OR usuario_id = ${usuarioId} 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      RETURNING *;
    `;

    // Sincroniza também nome e foto na tabela de usuários
    await sql`
      UPDATE usuarios
      SET 
        nome = COALESCE(${nome || null}, nome),
        foto_perfil_url = COALESCE(${foto_perfil_url || null}, foto_perfil_url)
      WHERE id = ${usuarioId};
    `;

    res.json({ sucesso: true, motorista: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao salvar dados do perfil.' });
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
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

export default router;