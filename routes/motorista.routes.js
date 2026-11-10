// routes/motorista.routes.js
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// Garante colunas de suporte para pausa, rota inteligente e código de voz
async function garantirColunasSuporte() {
  try {
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lat NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lng NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_ativo BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS em_pausa BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS pausa_ate TIMESTAMP;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_ano TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_cor TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS codigo_voz TEXT DEFAULT 'Zank';`;
  } catch (e) {
    console.warn('Aviso ao sincronizar colunas de suporte do motorista:', e.message);
  }
}
garantirColunasSuporte();

// =========================================================================
// 1. MAPA DE CALOR: PONTOS DE DEMANDA RECENTES (ÚLTIMAS 2 HORAS)
// =========================================================================
router.get('/calor', autenticarToken, async (req, res) => {
  try {
    const pontos = await sql`
      SELECT 
        origem_lat AS lat, 
        origem_lng AS lng,
        COUNT(id)::int AS intensidade
      FROM pedidos
      WHERE origem_lat IS NOT NULL 
        AND origem_lng IS NOT NULL
        AND criado_em >= NOW() - INTERVAL '2 hours'
      GROUP BY origem_lat, origem_lng
      ORDER BY intensidade DESC
      LIMIT 150;
    `;

    const heatmapData = pontos.map(p => [
      Number(p.lat),
      Number(p.lng),
      Math.min(1.0, Math.max(0.2, Number(p.intensidade) * 0.3))
    ]);

    res.json({ sucesso: true, pontos: heatmapData });
  } catch (err) {
    console.error('Erro ao gerar dados do mapa de calor:', err);
    res.status(500).json({ erro: 'Falha ao processar mapa de calor.' });
  }
});

// =========================================================================
// 2. MODO PAUSA RÁPIDA (ABASTECIMENTO / ALMOÇO)
// =========================================================================
router.put('/modo-pausa', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { emPausa, minutos } = req.body;

    const duracaoMin = Number(minutos) || 15;
    const pausaAte = emPausa ? new Date(Date.now() + duracaoMin * 60 * 1000) : null;

    const mot = await sql`
      UPDATE motoristas
      SET em_pausa = ${!!emPausa},
          pausa_ate = ${pausaAte}
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text
      RETURNING id, em_pausa, pausa_ate;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });

    res.json({
      sucesso: true,
      emPausa: !!emPausa,
      pausaAte,
      mensagem: emPausa ? `Pausa ativada por ${duracaoMin} minutos.` : 'Pausa finalizada. Pronto para receber chamadas!'
    });
  } catch (err) {
    console.error('Erro ao alternar modo pausa:', err);
    res.status(500).json({ erro: 'Falha ao alterar pausa.' });
  }
});

// =========================================================================
// 3. CONFIGURAR OU ALTERNAR FILTRO "DIREÇÃO DE CASA"
// =========================================================================
router.put('/filtro-destino', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { lat, lng, ativo } = req.body;

    const mot = await sql`
      UPDATE motoristas
      SET destino_casa_lat = ${lat ? Number(lat) : null},
          destino_casa_lng = ${lng ? Number(lng) : null},
          destino_casa_ativo = ${!!ativo}
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text
      RETURNING id, destino_casa_lat, destino_casa_lng, destino_casa_ativo;
    `;

    if (mot.length === 0) return res.status(404).json({ erro: 'Motorista não encontrado.' });
    res.json({ sucesso: true, config: mot[0] });
  } catch (err) {
    console.error('Erro ao atualizar filtro de destino:', err);
    res.status(500).json({ erro: 'Falha ao salvar preferência de rota.' });
  }
});

// =========================================================================
// 4. CONSULTA DE PERFIL (COM CÓDIGO PESSOAL DE VOZ)
// =========================================================================
const handlerObterPerfil = async (req, res) => {
  try {
    const usuarioId = req.usuario?.id || '';
    const emailUsuario = req.usuario?.email || '';

    let mot = await sql`
      SELECT 
        id, usuario_id, nome, email, telefone, categoria,
        saldo_carteira, status_aprovacao, foto_perfil_url,
        avaliacao_media, total_corridas,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
        chave_pix_padrao, COALESCE(codigo_voz, 'Zank') AS codigo_voz,
        em_pausa, pausa_ate, destino_casa_ativo
      FROM motoristas
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      LIMIT 1;
    `;

    if (mot.length === 0) {
      mot = await sql`
        SELECT 
          id, usuario_id, nome, email, telefone, categoria,
          saldo_carteira, status_aprovacao, foto_perfil_url,
          avaliacao_media, total_corridas,
          veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
          chave_pix_padrao, COALESCE(codigo_voz, 'Zank') AS codigo_voz,
          em_pausa, pausa_ate, destino_casa_ativo
        FROM motoristas
        ORDER BY saldo_carteira DESC, criado_em ASC
        LIMIT 1;
      `;

      if (mot.length > 0 && usuarioId) {
        await sql`
          UPDATE motoristas 
          SET usuario_id = ${usuarioId}
          WHERE id = ${mot[0].id};
        `;
      }
    }

    if (mot.length > 0) {
      const m = mot[0];
      return res.json({
        id: m.id,
        usuario_id: m.usuario_id || usuarioId,
        nome: m.nome || 'Motorista Parceiro',
        email: m.email || '',
        telefone: m.telefone || '',
        categoria: m.categoria || 'carro',
        saldo_carteira: Number(m.saldo_carteira || 0),
        status_aprovacao: m.status_aprovacao || 'aprovado',
        foto_perfil_url: m.foto_perfil_url || '',
        avaliacao_media: Number(m.avaliacao_media || 5.0),
        total_corridas: Number(m.total_corridas || 0),
        veiculo_modelo: m.veiculo_modelo || 'Onix',
        veiculo_placa: m.veiculo_placa || 'ABC1D23',
        veiculo_cor: m.veiculo_cor || 'Prata',
        veiculo_ano: m.veiculo_ano || '2023',
        chave_pix_padrao: m.chave_pix_padrao || '',
        codigo_voz: m.codigo_voz || 'Zank',
        em_pausa: !!m.em_pausa,
        pausa_ate: m.pausa_ate,
        destino_casa_ativo: !!m.destino_casa_ativo
      });
    }

    return res.status(404).json({ erro: 'Nenhum perfil de motorista cadastrado.' });
  } catch (err) {
    console.error('Erro ao consultar perfil do motorista:', err);
    res.status(500).json({ erro: 'Falha ao consultar perfil.' });
  }
};

router.get('/perfil', autenticarToken, handlerObterPerfil);
router.get('/meu-perfil', autenticarToken, handlerObterPerfil);

// =========================================================================
// 5. ATUALIZAR DADOS DO PERFIL
// =========================================================================
router.put('/perfil', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const emailUsuario = req.usuario.email || '';
    const {
      nome, telefone, foto_perfil_url, foto_base64,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      chave_pix_padrao, codigo_voz
    } = req.body;

    const fNome = (nome && nome.trim()) ? nome.trim() : null;
    const fTel = (telefone && telefone.trim()) ? telefone.trim() : null;
    const fFoto = (foto_base64 && foto_base64.trim()) ? foto_base64.trim() : ((foto_perfil_url && foto_perfil_url.trim()) ? foto_perfil_url.trim() : null);
    const fMod = (veiculo_modelo && veiculo_modelo.trim()) ? veiculo_modelo.trim() : null;
    const fPlaca = (veiculo_placa && veiculo_placa.trim()) ? veiculo_placa.trim().toUpperCase() : null;
    const fCor = (veiculo_cor && veiculo_cor.trim()) ? veiculo_cor.trim() : null;
    const fAno = (veiculo_ano && String(veiculo_ano).trim()) ? String(veiculo_ano).trim() : null;
    const fPix = (chave_pix_padrao && chave_pix_padrao.trim()) ? chave_pix_padrao.trim() : null;
    const fCodVoz = (codigo_voz && codigo_voz.trim()) ? codigo_voz.trim() : null;

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
        chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
        codigo_voz = COALESCE(${fCodVoz}, codigo_voz)
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text 
         OR (email = ${emailUsuario} AND ${emailUsuario} != '')
      RETURNING *;
    `;

    if (mot.length === 0) {
      mot = await sql`
        UPDATE motoristas
        SET 
          usuario_id = ${usuarioId},
          nome = COALESCE(${fNome}, nome),
          telefone = COALESCE(${fTel}, telefone),
          foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
          veiculo_modelo = COALESCE(${fMod}, veiculo_modelo),
          veiculo_placa = COALESCE(${fPlaca}, veiculo_placa),
          veiculo_cor = COALESCE(${fCor}, veiculo_cor),
          veiculo_ano = COALESCE(${fAno}, veiculo_ano),
          chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
          codigo_voz = COALESCE(${fCodVoz}, codigo_voz)
        WHERE id = (SELECT id FROM motoristas ORDER BY saldo_carteira DESC LIMIT 1)
        RETURNING *;
      `;
    }

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

router.put('/chave-pix', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { chavePix } = req.body;

    await sql`
      UPDATE motoristas 
      SET chave_pix_padrao = ${chavePix}
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text
         OR id = (SELECT id FROM motoristas ORDER BY saldo_carteira DESC LIMIT 1);
    `;

    res.json({ sucesso: true, mensagem: 'Chave Pix atualizada!' });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao salvar chave Pix' });
  }
});

// =========================================================================
// 6. EXTRATO FINANCEIRO COMPLETO
// =========================================================================
router.get('/extrato', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const mot = await sql`
      SELECT id FROM motoristas 
      WHERE id::text = ${usuarioId}::text OR usuario_id::text = ${usuarioId}::text
      ORDER BY saldo_carteira DESC LIMIT 1;
    `;
    const motoristaIdReal = mot[0]?.id || usuarioId;

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em
      FROM saques_motoristas
      WHERE motorista_id::text = ${motoristaIdReal}::text 
         OR motorista_id::text = ${usuarioId}::text
      ORDER BY criado_em DESC
      LIMIT 15;
    `;

    const corridas = await sql`
      SELECT 
        id, valor_total, 
        COALESCE(valor_total * 0.85, 0) AS repasse_liquido,
        valor_adicionais, concluido_em, criado_em, origem_endereco, destino_endereco
      FROM pedidos
      WHERE status = 'concluido'
        AND (motorista_id::text = ${motoristaIdReal}::text 
             OR motorista_id::text = ${usuarioId}::text)
      ORDER BY criado_em DESC
      LIMIT 20;
    `;

    res.json({ sucesso: true, saques, corridas, historico: corridas });
  } catch (err) {
    console.error('Erro ao obter extrato:', err);
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

// =========================================================================
// 7. GANHOS DE HOJE E TURNO
// =========================================================================
router.get('/ganhos-hoje', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;

    const mot = await sql`
      SELECT id FROM motoristas 
      WHERE id::text = ${usuarioId}::text OR usuario_id::text = ${usuarioId}::text
      ORDER BY saldo_carteira DESC LIMIT 1;
    `;
    const motoristaIdReal = mot[0]?.id || usuarioId;

    const corridasHoje = await sql`
      SELECT 
        COUNT(*)::int AS total_corridas,
        COALESCE(SUM(valor_total * 0.85), 0) AS ganhos_liquidos
      FROM pedidos
      WHERE status = 'concluido'
        AND DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') = DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
        AND (motorista_id::text = ${motoristaIdReal}::text 
             OR motorista_id::text = ${usuarioId}::text);
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

// =========================================================================
// 8. ATUALIZAR STATUS ONLINE / OFFLINE
// =========================================================================
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

// =========================================================================
// 9. SOLICITAR SAQUE PIX
// =========================================================================
router.post('/saque', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const { valor, chavePix, tipoChave } = req.body;

    const valorNum = Number(valor);
    if (!valorNum || valorNum <= 0) {
      return res.status(400).json({ erro: 'Valor de saque inválido.' });
    }

    const mot = await sql`
      SELECT id, nome, saldo_carteira FROM motoristas
      WHERE id::text = ${usuarioId}::text 
         OR usuario_id::text = ${usuarioId}::text
      ORDER BY saldo_carteira DESC
      LIMIT 1;
    `;

    if (!mot.length) return res.status(404).json({ erro: 'Motorista não encontrado.' });
    if (Number(mot[0].saldo_carteira) < valorNum) {
      return res.status(400).json({ erro: 'Saldo insuficiente para saque.' });
    }

    await sql`
      UPDATE motoristas 
      SET saldo_carteira = saldo_carteira - ${valorNum}
      WHERE id = ${mot[0].id};
    `;

    await sql`
      INSERT INTO saques_motoristas (
        motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status
      ) VALUES (
        ${mot[0].id}, ${mot[0].nome}, ${chavePix}, ${tipoChave || 'cpf'}, ${valorNum}, 'pendente'
      );
    `;

    res.json({ sucesso: true, mensagem: 'Saque solicitado com sucesso!' });
  } catch (err) {
    console.error('Erro ao processar saque:', err);
    res.status(500).json({ erro: 'Falha ao processar saque.' });
  }
});

export default router;