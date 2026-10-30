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
      WHERE id::text = ${usuarioId}::text OR usuario_id::text = ${usuarioId}::text
      RETURNING id, destino_casa_lat, destino_casa_lng, destino_casa_ativo;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });
    res.json({ sucesso: true, config: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar filtro de destino:', err);
    res.status(500).json({ erro: 'Falha ao salvar preferência de rota.' });
  }
});

// 2. Obter Perfil Completo com Dados Reais do Formulário de Cadastro (Sem JOIN problemático)
router.get('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';

    // 1. Consulta direta na tabela de motoristas
    const mot = await sql`
      SELECT 
        id, usuario_id, nome, email, telefone, categoria,
        saldo_carteira, status_aprovacao, foto_perfil_url,
        avaliacao_media, total_corridas,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
        chave_pix_padrao
      FROM motoristas
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      LIMIT 1;
    `;

    if (mot.length > 0) {
      const m = mot[0];
      return res.json({
        id: m.id,
        nome: m.nome || '',
        email: m.email || '',
        telefone: m.telefone || '',
        categoria: m.categoria || 'carro',
        saldo_carteira: Number(m.saldo_carteira || 0),
        status_aprovacao: m.status_aprovacao || 'aprovado',
        foto_perfil_url: m.foto_perfil_url || '',
        avaliacao_media: Number(m.avaliacao_media || 5.0),
        total_corridas: Number(m.total_corridas || 0),
        veiculo_modelo: m.veiculo_modelo || '',
        veiculo_placa: m.veiculo_placa || '',
        veiculo_cor: m.veiculo_cor || '',
        veiculo_ano: m.veiculo_ano || '',
        chave_pix_padrao: m.chave_pix_padrao || ''
      });
    }

    // 2. Fallback: Se não encontrou em motoristas, busca em usuarios
    const usr = await sql`
      SELECT id, nome, email, telefone, COALESCE(foto_perfil_url, '') AS foto_perfil_url
      FROM usuarios 
      WHERE id::text = ${usuarioId}::text 
      LIMIT 1;
    `;

    const u = usr[0] || {};
    const nomeFinal = u.nome || req.usuario.nome || 'Motorista Parceiro';
    const emailFinal = u.email || emailUsuario;
    const telefoneFinal = u.telefone || '';
    const fotoFinal = u.foto_perfil_url || '';

    // 3. Cria automaticamente o registro do motorista
    try {
      const novo = await sql`
        INSERT INTO motoristas (
          id, usuario_id, nome, email, telefone, foto_perfil_url,
          categoria, saldo_carteira, status_aprovacao, avaliacao_media, total_corridas
        ) VALUES (
          ${usuarioId}, ${usuarioId}, ${nomeFinal}, ${emailFinal}, ${telefoneFinal}, ${fotoFinal},
          'carro', 0, 'aprovado', 5.0, 0
        )
        ON CONFLICT (id) DO UPDATE 
        SET nome = EXCLUDED.nome
        RETURNING *;
      `;

      if (novo.length > 0) {
        const n = novo[0];
        return res.json({
          id: n.id,
          nome: n.nome || '',
          email: n.email || '',
          telefone: n.telefone || '',
          categoria: n.categoria || 'carro',
          saldo_carteira: Number(n.saldo_carteira || 0),
          status_aprovacao: n.status_aprovacao || 'aprovado',
          foto_perfil_url: n.foto_perfil_url || '',
          avaliacao_media: Number(n.avaliacao_media || 5.0),
          total_corridas: Number(n.total_corridas || 0),
          veiculo_modelo: n.veiculo_modelo || '',
          veiculo_placa: n.veiculo_placa || '',
          veiculo_cor: n.veiculo_cor || '',
          veiculo_ano: n.veiculo_ano || '',
          chave_pix_padrao: n.chave_pix_padrao || ''
        });
      }
    } catch (insertErr) {
      console.warn('Aviso no auto-registro de motorista:', insertErr.message);
    }

    return res.json({
      id: usuarioId,
      nome: nomeFinal,
      email: emailFinal,
      telefone: telefoneFinal,
      categoria: 'carro',
      saldo_carteira: 0,
      status_aprovacao: 'aprovado',
      foto_perfil_url: fotoFinal,
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
    res.status(500).json({ erro: 'Falha ao consultar perfil.' });
  }
});

// 3. Atualizar Dados do Perfil com Suporte a Foto e Auto-Criação Segura
router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';
    const {
      nome, telefone, foto_perfil_url,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      chave_pix_padrao
    } = req.body;

    const fNome = (nome && nome.trim()) ? nome.trim() : null;
    const fTel = (telefone && telefone.trim()) ? telefone.trim() : null;
    const fFoto = (foto_perfil_url && foto_perfil_url.trim()) ? foto_perfil_url.trim() : null;
    const fMod = (veiculo_modelo && veiculo_modelo.trim()) ? veiculo_modelo.trim() : null;
    const fPlaca = (veiculo_placa && veiculo_placa.trim()) ? veiculo_placa.trim().toUpperCase() : null;
    const fCor = (veiculo_cor && veiculo_cor.trim()) ? veiculo_cor.trim() : null;
    const fAno = (veiculo_ano && veiculo_ano.trim()) ? veiculo_ano.trim() : null;
    const fPix = (chave_pix_padrao && chave_pix_padrao.trim()) ? chave_pix_padrao.trim() : null;

    // Tenta atualizar registro existente
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
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      RETURNING *;
    `;

    // Se ainda não existia linha em motoristas, insere com chave primária id garantida
    if (mot.length === 0) {
      mot = await sql`
        INSERT INTO motoristas (
          id, usuario_id, nome, email, telefone, foto_perfil_url,
          veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, chave_pix_padrao,
          categoria, saldo_carteira, status_aprovacao
        ) VALUES (
          ${usuarioId}, ${usuarioId}, 
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

    // Sincroniza também na tabela de usuários
    await sql`
      UPDATE usuarios
      SET 
        nome = COALESCE(${fNome}, nome),
        telefone = COALESCE(${fTel}, telefone),
        foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url)
      WHERE id::text = ${usuarioId}::text;
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
      WHERE motorista_id::text = ${usuarioId}::text
      ORDER BY criado_em DESC
      LIMIT 15;
    `;

    const corridas = await sql`
      SELECT 
        id, valor_total, 
        (valor_total * 0.85) AS repasse_liquido,
        valor_gorjeta, concluido_em, origem_endereco, destino_endereco
      FROM pedidos
      WHERE motorista_id::text = ${usuarioId}::text AND status = 'concluido'
      ORDER BY concluido_em DESC
      LIMIT 15;
    `;

    res.json({ saques, corridas });
  } catch (err) {
    console.error('Erro ao obter extrato:', err);
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

// 5. Ganhos de Hoje e Estatísticas do Turno
router.get('/ganhos-hoje', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    // Busca corridas concluídas a partir da meia-noite de hoje (horário local/servidor)
    const corridasHoje = await sql`
      SELECT 
        COUNT(*)::int AS total_corridas,
        COALESCE(SUM(valor_total * 0.85), 0) AS ganhos_liquidos
      FROM pedidos
      WHERE motorista_id::text = ${usuarioId}::text
        AND status = 'concluido'
        AND concluido_em >= CURRENT_DATE;
    `;

    const dados = corridasHoje[0] || { total_corridas: 0, ganhos_liquidos: 0 };

    res.json({
      sucesso: true,
      corridasHoje: dados.total_corridas,
      ganhosHoje: Number(dados.ganhos_liquidos)
    });
  } catch (err) {
    console.error('Erro ao calcular ganhos do dia:', err);
    res.status(500).json({ erro: 'Falha ao obter resumo diário.' });
  }
});
// 6. Atualizar Status Online / Offline do Motorista
router.put('/status-online', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { online } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET status_online = ${!!online}
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text
      RETURNING id, status_online;
    `;

    res.json({ sucesso: true, online: !!online, motorista: mot[0] || null });
  } catch (err) {
    console.error('Erro ao alternar status online:', err);
    res.status(500).json({ erro: 'Falha ao atualizar status online.' });
  }
});

export default router;