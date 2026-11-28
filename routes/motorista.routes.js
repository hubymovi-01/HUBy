// routes/motorista.routes.js - Perfil, Pausa, Destino, Selfie, Extrato, Ganhos e Saque do Motorista HUBy
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';
import { lerTarifasDoBanco } from './admin.routes.js';
import { avisarAdmins } from '../services/salas-socket.js';

const router = express.Router();

const MAX_FOTO_CHARS = 1_500_000;  // ~1 MB em base64
const MAX_SELFIE_CHARS = 2_000_000;

// ============================================================================
// ESTRUTURA
// ============================================================================
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
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS ultima_selfie_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS ultima_selfie_em TIMESTAMP WITH TIME ZONE;`;

    await sql`
      CREATE TABLE IF NOT EXISTS verificacoes_selfie_motorista (
        id SERIAL PRIMARY KEY,
        motorista_id TEXT NOT NULL,
        selfie_url TEXT NOT NULL,
        ip_origem VARCHAR(60),
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (e) {
    console.warn('Aviso ao sincronizar colunas de suporte do motorista:', e.message);
  }
}
garantirColunasSuporte();

// ============================================================================
// LIMPEZA DE SELFIES ANTIGAS (LGPD: dado biométrico não fica guardado para sempre)
// - Histórico de verificações: a FOTO é apagada após o prazo; fica só o registro
//   de que houve verificação (data e IP), útil para apurar incidentes.
// - Última selfie do motorista: apagada se ele não verifica há mais do que o prazo.
// Prazo padrão: 90 dias (dá para mudar no Render com SELFIE_RETENCAO_DIAS).
// ============================================================================
const SELFIE_RETENCAO_DIAS = Math.min(365, Math.max(7, Number(process.env.SELFIE_RETENCAO_DIAS) || 90));

async function limparSelfiesAntigas() {
  try {
    const historico = await sql`
      UPDATE verificacoes_selfie_motorista
      SET selfie_url = 'removida'
      WHERE criado_em < NOW() - (${SELFIE_RETENCAO_DIAS} * INTERVAL '1 day')
        AND selfie_url <> 'removida'
      RETURNING id;
    `;
    const ultimas = await sql`
      UPDATE motoristas
      SET ultima_selfie_url = NULL
      WHERE ultima_selfie_url IS NOT NULL
        AND ultima_selfie_em < NOW() - (${SELFIE_RETENCAO_DIAS} * INTERVAL '1 day')
      RETURNING id;
    `;
    if (historico.length || ultimas.length) {
      console.log(`[lgpd] Selfies antigas apagadas: ${historico.length} do histórico, ${ultimas.length} de perfis (prazo: ${SELFIE_RETENCAO_DIAS} dias).`);
    }
  } catch (err) {
    console.warn('[lgpd] Falha ao limpar selfies antigas:', err.message);
  }
}

// Roda 1 minuto depois de ligar e depois 1 vez por dia
setTimeout(limparSelfiesAntigas, 60 * 1000).unref();
setInterval(limparSelfiesAntigas, 24 * 60 * 60 * 1000).unref();
// ============================================================================
// AUXILIARES DE SEGURANÇA
// ============================================================================
const textoOuNull = (v, max = 100) => {
  const t = String(v ?? '').replace(/[<>]/g, '').trim();
  return t ? t.slice(0, max) : null;
};

function ehImagemBase64(v, max) {
  return typeof v === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(v) && v.length <= max;
}

// Só deixa passar quem está logado como motorista (ou admin)
function somenteMotorista(req, res, next) {
  const role = String(req.usuario?.role || '').toLowerCase();
  if (role !== 'motorista' && role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Área exclusiva para motoristas parceiros.' });
  }
  next();
}

// Encontra SOMENTE o motorista dono do token. Nunca usa "outro motorista" como reserva.
async function motoristaDoToken(req) {
  const ids = [req.usuario?.motoristaId, req.usuario?.id].filter(Boolean).map(String);
  if (!ids.length) return null;
  const rows = await sql`
    SELECT * FROM motoristas
    WHERE id::text = ANY(${ids}) OR usuario_id::text = ANY(${ids})
    LIMIT 1;
  `;
  return rows[0] || null;
}

// Middleware: carrega o motorista do token em req.motorista
async function carregarMotorista(req, res, next) {
  try {
    const mot = await motoristaDoToken(req);
    if (!mot) return res.status(404).json({ erro: 'Cadastro de motorista não localizado para esta conta.' });
    req.motorista = mot;
    next();
  } catch (err) {
    console.error('Erro ao localizar motorista:', err);
    res.status(500).json({ erro: 'Falha ao localizar seu cadastro.' });
  }
}

const doMotorista = [autenticarToken, somenteMotorista, carregarMotorista];

// ============================================================================
// ZONAS DE RISCO (mapa do motorista)
// ============================================================================
router.get('/zonas-risco', autenticarToken, async (req, res) => {
  try {
    const zonas = await sql`
      SELECT id, nome, descricao, nivel_risco, raio_metros, lat, lng, horario_inicio, horario_fim, ativo
      FROM zonas_risco
      WHERE COALESCE(ativo, TRUE) = TRUE AND lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY id DESC;
    `;
    return res.json({ sucesso: true, zonas });
  } catch (err) {
    console.error('Erro ao buscar zonas de risco:', err);
    return res.status(500).json({ erro: 'Falha ao carregar zonas de risco.' });
  }
});

// ============================================================================
// 0. SELFIE AO FICAR ONLINE
// ============================================================================
router.post('/verificar-selfie', ...doMotorista, async (req, res) => {
  try {
    const selfie = String(req.body?.selfie_base64 || '').trim();
    if (!ehImagemBase64(selfie, MAX_SELFIE_CHARS)) {
      return res.status(400).json({ erro: 'Selfie inválida ou muito grande. Capture novamente pela câmera.' });
    }

    const motId = String(req.motorista.id);

    await sql`
      UPDATE motoristas
      SET ultima_selfie_url = ${selfie}, ultima_selfie_em = CURRENT_TIMESTAMP
      WHERE id = ${motId};
    `;
    await sql`
      INSERT INTO verificacoes_selfie_motorista (motorista_id, selfie_url, ip_origem)
      VALUES (${motId}, ${selfie}, ${String(req.ip || '').slice(0, 50)});
    `;

    return res.status(201).json({ sucesso: true, verificadoEm: new Date().toISOString() });
  } catch (err) {
    console.error('Erro ao registrar selfie:', err);
    return res.status(500).json({ erro: 'Falha ao validar selfie no servidor.' });
  }
});

// ============================================================================
// 1. MAPA DE CALOR (últimas 2 horas)
// ============================================================================
router.get('/calor', autenticarToken, somenteMotorista, async (req, res) => {
  try {
    const pontos = await sql`
      SELECT ROUND(origem_lat::numeric, 3) AS lat, ROUND(origem_lng::numeric, 3) AS lng, COUNT(id)::int AS intensidade
      FROM pedidos
      WHERE origem_lat IS NOT NULL AND origem_lng IS NOT NULL
        AND criado_em >= NOW() - INTERVAL '2 hours'
      GROUP BY 1, 2
      ORDER BY intensidade DESC
      LIMIT 150;
    `;

    const heatmapData = pontos.map((p) => [
      Number(p.lat),
      Number(p.lng),
      Math.min(1.0, Math.max(0.2, Number(p.intensidade) * 0.3))
    ]);

    res.json({ sucesso: true, pontos: heatmapData });
  } catch (err) {
    console.error('Erro no mapa de calor:', err);
    res.status(500).json({ erro: 'Falha ao processar mapa de calor.' });
  }
});

// ============================================================================
// 2. MODO PAUSA
// ============================================================================
router.put('/modo-pausa', ...doMotorista, async (req, res) => {
  try {
    const emPausa = Boolean(req.body?.emPausa);
    const duracaoMin = Math.min(120, Math.max(5, Number(req.body?.minutos) || 15));
    const pausaAte = emPausa ? new Date(Date.now() + duracaoMin * 60 * 1000) : null;

    await sql`
      UPDATE motoristas SET em_pausa = ${emPausa}, pausa_ate = ${pausaAte}
      WHERE id = ${req.motorista.id};
    `;

    res.json({
      sucesso: true,
      emPausa,
      pausaAte,
      mensagem: emPausa ? `Pausa ativada por ${duracaoMin} minutos.` : 'Pausa finalizada. Pronto para receber chamadas!'
    });
  } catch (err) {
    console.error('Erro ao alternar pausa:', err);
    res.status(500).json({ erro: 'Falha ao alterar pausa.' });
  }
});

// ============================================================================
// 3. FILTRO "DIREÇÃO DE CASA"
// ============================================================================
router.put('/filtro-destino', ...doMotorista, async (req, res) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const coordsOk = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    const ativo = Boolean(req.body?.ativo);

    const [mot] = await sql`
      UPDATE motoristas
      SET destino_casa_lat = ${coordsOk ? lat : null},
          destino_casa_lng = ${coordsOk ? lng : null},
          destino_casa_ativo = ${ativo && coordsOk}
      WHERE id = ${req.motorista.id}
      RETURNING id, destino_casa_lat, destino_casa_lng, destino_casa_ativo;
    `;

    res.json({ sucesso: true, config: mot });
  } catch (err) {
    console.error('Erro no filtro de destino:', err);
    res.status(500).json({ erro: 'Falha ao salvar preferência de rota.' });
  }
});

// ============================================================================
// 4. PERFIL DO MOTORISTA
// ============================================================================
const handlerObterPerfil = (req, res) => {
  const m = req.motorista;
  res.json({
    id: m.id,
    usuario_id: m.usuario_id || m.id,
    nome: m.nome || 'Motorista Parceiro',
    email: m.email || '',
    telefone: m.telefone || '',
    categoria: m.categoria || 'carro',
    saldo_carteira: Number(m.saldo_carteira || 0),
    status_aprovacao: m.status_aprovacao || 'pendente',
    foto_perfil_url: m.foto_perfil_url || '',
    avaliacao_media: Number(m.avaliacao_media || 5.0),
    total_corridas: Number(m.total_corridas || 0),
    nivel: m.nivel || 'bronze',
    veiculo_modelo: m.veiculo_modelo || '',
    veiculo_placa: m.veiculo_placa || '',
    veiculo_cor: m.veiculo_cor || '',
    veiculo_ano: m.veiculo_ano || '',
    chave_pix_padrao: m.chave_pix_padrao || '',
    codigo_voz: m.codigo_voz || 'Zank',
    em_pausa: Boolean(m.em_pausa),
    pausa_ate: m.pausa_ate,
    destino_casa_ativo: Boolean(m.destino_casa_ativo),
    ultima_selfie_em: m.ultima_selfie_em
  });
};

router.get('/perfil', ...doMotorista, handlerObterPerfil);
router.get('/meu-perfil', ...doMotorista, handlerObterPerfil);

// ============================================================================
// 5. ATUALIZAR PERFIL
// Placa e modelo NÃO mudam por aqui: troca de veículo passa pelo admin (novo CRLV).
// ============================================================================
router.put('/perfil', ...doMotorista, async (req, res) => {
  try {
    const b = req.body || {};
    const fNome = textoOuNull(b.nome, 120);
    const fTel = b.telefone ? String(b.telefone).replace(/\D/g, '').slice(0, 13) || null : null;
    const fotoBruta = b.foto_base64 || b.foto_perfil_url || null;
    const fFoto = fotoBruta && ehImagemBase64(fotoBruta, MAX_FOTO_CHARS) ? fotoBruta : null;
    const fPix = textoOuNull(b.chave_pix_padrao, 150);
    const fCodVoz = textoOuNull(b.codigo_voz, 30);

    if (fotoBruta && !fFoto) {
      return res.status(400).json({ erro: 'Foto inválida ou muito grande (máx. 1 MB).' });
    }
    if (fTel && fTel.length < 10) {
      return res.status(400).json({ erro: 'Telefone inválido.' });
    }

    const placaPedida = b.veiculo_placa ? String(b.veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : null;
    const modeloPedido = textoOuNull(b.veiculo_modelo, 80);
    const corPedida = textoOuNull(b.veiculo_cor, 30);
    const anoPedido = b.veiculo_ano !== undefined && b.veiculo_ano !== null ? String(b.veiculo_ano).trim() : '';
    const tentouTrocarVeiculo =
      (placaPedida && placaPedida !== String(req.motorista.veiculo_placa || '').toUpperCase()) ||
      (modeloPedido && modeloPedido !== req.motorista.veiculo_modelo) ||
      (corPedida && corPedida.toUpperCase() !== String(req.motorista.veiculo_cor || '').trim().toUpperCase()) ||
      (anoPedido && anoPedido !== String(req.motorista.veiculo_ano || '').trim());

    const [mot] = await sql`
      UPDATE motoristas
      SET nome = COALESCE(${fNome}, nome),
          telefone = COALESCE(${fTel}, telefone),
          foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
          chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
          codigo_voz = COALESCE(${fCodVoz}, codigo_voz)
      WHERE id = ${req.motorista.id}
      RETURNING id, nome, telefone, foto_perfil_url, veiculo_modelo, veiculo_placa,
                veiculo_cor, veiculo_ano, chave_pix_padrao, codigo_voz;
    `;

    await sql`
      UPDATE usuarios
      SET nome = COALESCE(${fNome}, nome),
          telefone = COALESCE(${fTel}, telefone),
          foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url)
      WHERE id::text = ${String(req.motorista.usuario_id || req.motorista.id)}::text;
    `;

    res.json({
      sucesso: true,
      motorista: mot,
      aviso: tentouTrocarVeiculo
        ? 'Os dados do veículo (placa, modelo, cor e ano) não foram alterados. Para mudar, fale com o suporte HUBy e envie o novo CRLV.'
        : undefined
    });
  } catch (err) {
    console.error('Erro ao atualizar perfil do motorista:', err);
    if (err?.code === '23505') return res.status(409).json({ erro: 'Este telefone já está em uso.' });
    res.status(500).json({ erro: 'Falha ao salvar dados do perfil.' });
  }
});

router.put('/chave-pix', ...doMotorista, async (req, res) => {
  try {
    const chavePix = textoOuNull(req.body?.chavePix, 150);
    if (!chavePix || chavePix.length < 5) {
      return res.status(400).json({ erro: 'Informe uma chave Pix válida.' });
    }

    await sql`UPDATE motoristas SET chave_pix_padrao = ${chavePix} WHERE id = ${req.motorista.id};`;
    res.json({ sucesso: true, mensagem: 'Chave Pix atualizada!' });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao salvar chave Pix.' });
  }
});

// ============================================================================
// 6. EXTRATO (repasse calculado com a taxa do NÍVEL do motorista)
// ============================================================================
async function fatorRepasseDoMotorista(mot) {
  const tarifas = await lerTarifasDoBanco();
  const nivel = String(mot.nivel || 'bronze').toLowerCase();
  const taxa = Number(tarifas.niveis_motorista?.[nivel]?.taxa_huby ?? tarifas.taxa_plataforma ?? 15);
  return { fator: Math.max(0.1, (100 - taxa) / 100), taxa };
}

router.get('/extrato', ...doMotorista, async (req, res) => {
  try {
    const motId = String(req.motorista.id);
    const { fator } = await fatorRepasseDoMotorista(req.motorista);

    const saques = await sql`
      SELECT id, valor, chave_pix, tipo_chave, status, criado_em
      FROM saques_motoristas
      WHERE motorista_id::text = ${motId}
      ORDER BY criado_em DESC
      LIMIT 15;
    `;

    const corridas = await sql`
      SELECT id, valor_total,
             ROUND(COALESCE(valor_total, 0) * ${fator}, 2) AS repasse_liquido,
             valor_adicionais, concluido_em, criado_em, origem_endereco, destino_endereco
      FROM pedidos
      WHERE LOWER(status) = 'concluido' AND motorista_id::text = ${motId}
      ORDER BY COALESCE(concluido_em, criado_em) DESC
      LIMIT 20;
    `;

    res.json({ sucesso: true, saques, corridas, historico: corridas });
  } catch (err) {
    console.error('Erro ao obter extrato:', err);
    res.status(500).json({ erro: 'Falha ao obter extrato.' });
  }
});

// ============================================================================
// 7. GANHOS DE HOJE (fuso de Brasília)
// ============================================================================
router.get('/ganhos-hoje', ...doMotorista, async (req, res) => {
  try {
    const motId = String(req.motorista.id);
    const { fator, taxa } = await fatorRepasseDoMotorista(req.motorista);

    const [dados] = await sql`
      SELECT COUNT(*)::int AS total_corridas,
             COALESCE(SUM(valor_total * ${fator}), 0) AS ganhos_liquidos
      FROM pedidos
      WHERE LOWER(status) = 'concluido'
        AND motorista_id::text = ${motId}
        AND (COALESCE(concluido_em, criado_em) AT TIME ZONE 'America/Sao_Paulo')::date
            = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
    `;

    res.json({
      sucesso: true,
      corridasHoje: Number(dados?.total_corridas || 0),
      ganhosHoje: Number(Number(dados?.ganhos_liquidos || 0).toFixed(2)),
      taxaAplicada: taxa
    });
  } catch (err) {
    console.error('Erro ao calcular ganhos do dia:', err);
    res.status(500).json({ erro: 'Falha ao obter resumo diário.' });
  }
});

// ============================================================================
// 8. ONLINE / OFFLINE (só motorista aprovado fica online)
// ============================================================================
router.put('/status-online', ...doMotorista, async (req, res) => {
  try {
    const online = Boolean(req.body?.online);

    if (online && req.motorista.status_aprovacao !== 'aprovado') {
      return res.status(403).json({
        erro: req.motorista.status_aprovacao === 'recusado'
          ? 'Seu cadastro foi recusado. Fale com o suporte HUBy.'
          : 'Seu cadastro ainda está em análise. Você poderá ficar online assim que for aprovado.'
      });
    }

    const [mot] = await sql`
      UPDATE motoristas SET status_online = ${online}
      WHERE id = ${req.motorista.id}
      RETURNING id, status_online;
    `;

    res.json({ sucesso: true, online, motorista: mot });
  } catch (err) {
    console.error('Erro ao alternar status online:', err);
    res.status(500).json({ erro: 'Falha ao atualizar status online.' });
  }
});

// ============================================================================
// 9. SAQUE PIX (débito atômico: impossível sacar duas vezes o mesmo saldo)
// ============================================================================
router.post('/saque', ...doMotorista, async (req, res) => {
  try {
    const valorNum = Math.round((Number(String(req.body?.valor ?? '').replace(',', '.')) || 0) * 100) / 100;
    const chavePix = textoOuNull(req.body?.chavePix, 150);
    const tipoChave = textoOuNull(req.body?.tipoChave, 20) || 'cpf';

    if (!valorNum || valorNum < 1) {
      return res.status(400).json({ erro: 'O valor mínimo de saque é R$ 1,00.' });
    }
    if (!chavePix || chavePix.length < 5) {
      return res.status(400).json({ erro: 'Informe a chave Pix de destino.' });
    }

    const [debitado] = await sql`
      UPDATE motoristas
      SET saldo_carteira = saldo_carteira - ${valorNum}
      WHERE id = ${req.motorista.id}
        AND status_aprovacao = 'aprovado'
        AND COALESCE(saldo_carteira, 0) >= ${valorNum}
      RETURNING id, nome, saldo_carteira;
    `;

    if (!debitado) {
      return res.status(400).json({ erro: 'Saldo insuficiente ou cadastro ainda não aprovado.' });
    }

    try {
      const [saque] = await sql`
        INSERT INTO saques_motoristas (motorista_id, motorista_nome, chave_pix, tipo_chave, valor, status)
        VALUES (${debitado.id}, ${debitado.nome}, ${chavePix}, ${tipoChave}, ${valorNum}, 'pendente')
        RETURNING id;
      `;

      await sql`
        INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
        VALUES (${debitado.id}, 'motorista', 'solicitacao_saque_pix', ${-valorNum}, ${String(saque.id)});
      `;

      // Aviso de saque só para os admins
      const io = req.io || req.app.get('io');
      avisarAdmins(io, 'novo_saque_solicitado', { saqueId: saque.id, motorista_nome: debitado.nome, valor: valorNum });

      res.json({
        sucesso: true,
        saqueId: saque.id,
        novoSaldo: Number(debitado.saldo_carteira),
        mensagem: 'Saque solicitado! Ele será pago após a conferência da equipe HUBy.'
      });
    } catch (erroRegistro) {
      // Se o registro falhar, devolve o dinheiro
      await sql`UPDATE motoristas SET saldo_carteira = saldo_carteira + ${valorNum} WHERE id = ${debitado.id};`;
      throw erroRegistro;
    }
  } catch (err) {
    console.error('Erro ao processar saque:', err);
    if (!res.headersSent) res.status(500).json({ erro: 'Falha ao processar saque.' });
  }
});

export default router;