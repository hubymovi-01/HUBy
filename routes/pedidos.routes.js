// routes/pedidos.routes.js - Pedidos, Agendamento, Níveis do Motorista, Demanda Não Atendida, Push, Indicação e SOS
// Versão com controle de acesso: cada rota verifica QUEM pode mexer em QUAL corrida.
import express from 'express';
import { sql, JWT_SECRET } from '../db.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { lerTarifasDoBanco, extrairObjetoJSONB } from './admin.routes.js';
import { dispararPushParaMotoristas } from './push.routes.js';
import { liquidarBonusIndicacaoPrimeiraCorrida } from './indicacoes.routes.js';
import { calcularCotacao, chaveCategoriaPreco, CATEGORIAS_PRECO } from '../services/precificacao.service.js';
import {
  avisarCorrida, avisarAdmins, avisarMotoristas,
  colocarPassageiroNaCorrida, colocarMotoristaNaCorrida
} from '../services/salas-socket.js';

const TEMPO_TOLERANCIA_ESPERA_SEG = 180; // 3 minutos de tolerância após motorista chegar
const VALOR_TAXA_CANCELAMENTO = 5.00;
const RAIO_MAXIMO_KM = 15.0; // Distância máxima para um motorista ver uma corrida
const VALOR_ADICIONAIS_MAX = 500; // Teto de segurança para adicionais enviados pelo app
const FOTO_MAX_CARACTERES = 700000; // ~500 KB em base64

// Grupos de status usados nas regras
const STATUS_BUSCANDO = ['pendente', 'aguardando', 'buscando', 'criado', 'agendado'];
const STATUS_CHEGADA = ['chegou_local', 'aguardando_passageiro', 'no_local', 'motorista_no_local'];
const STATUS_A_CAMINHO = ['a_caminho', 'aceito', ...STATUS_CHEGADA];
const STATUS_ATIVOS_MOTORISTA = [...STATUS_A_CAMINHO, 'em_andamento', 'em_viagem'];
const STATUS_ENCERRADOS = ['concluido', 'cancelado'];
const FORMAS_PRESENCIAIS = ['dinheiro', 'cartao_maquininha'];

const NIVEIS_PADRAO = {
  bronze: { nome: 'Bronze', corridas_min: 0, nota_min: 0.0, taxa_huby: 15 },
  prata: { nome: 'Prata', corridas_min: 50, nota_min: 4.8, taxa_huby: 12 },
  ouro: { nome: 'Ouro', corridas_min: 150, nota_min: 4.9, taxa_huby: 10 }
};

function extrairBairroDeEndereco(enderecoRaw) {
  const txt = String(enderecoRaw || '').trim();
  if (!txt || txt.startsWith('Partida (') || txt.startsWith('Local atual (')) {
    return 'Localização GPS (Sem bairro)';
  }
  const partes = txt.split(/[-–,]/).map((p) => p.trim()).filter(Boolean);
  for (const parte of partes) {
    if (/^(rua|av\.?|avenida|travessa|tv\.?|praça|praca|rodovia|br-|pi-|são joão do piauí|simplício mendes|pi|brasil)/i.test(parte)) {
      continue;
    }
    if (parte.length >= 3 && parte.length <= 45) {
      return parte;
    }
  }
  return partes[0] || 'Centro';
}

async function registrarDemandaNaoAtendida({
  pedidoId,
  origemEndereco,
  destinoEndereco,
  lat,
  lng,
  motivo,
  io
}) {
  try {
    const agora = new Date();
    const horaBR = Number(
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hour12: false
      }).format(agora)
    );
    const horaLimpa = Number.isFinite(horaBR) ? horaBR : agora.getHours();
    const faixaHorario = `${String(horaLimpa).padStart(2, '0')}h - ${String((horaLimpa + 1) % 24).padStart(2, '0')}h`;
    const bairro = extrairBairroDeEndereco(origemEndereco);

    const [reg] = await sql`
      INSERT INTO demandas_nao_atendidas (
        pedido_id, bairro, origem_endereco, destino_endereco,
        lat, lng, dia_semana, hora_dia, faixa_horario, motivo
      ) VALUES (
        ${pedidoId ? String(pedidoId) : null},
        ${bairro},
        ${String(origemEndereco || '').slice(0, 300)},
        ${String(destinoEndereco || '').slice(0, 300)},
        ${Number.isFinite(Number(lat)) ? Number(lat) : null},
        ${Number.isFinite(Number(lng)) ? Number(lng) : null},
        ${agora.getDay()},
        ${horaLimpa},
        ${faixaHorario},
        ${String(motivo || 'sem_aceite').slice(0, 60)}
      )
      RETURNING *;
    `;

    if (io && reg) {
      io.emit('demanda_nao_atendida_registrada', reg);
    }
  } catch (err) {
    console.warn('Aviso ao registrar demanda não atendida:', err.message);
  }
}

function normalizarConfigNiveis(tarifasBanco) {
  const bruto = tarifasBanco?.niveis_motorista || {};
  const taxaBaseBronze = Number(tarifasBanco?.taxa_plataforma ?? 15);
  return {
    bronze: {
      nome: 'Bronze',
      corridas_min: Number(bruto.bronze?.corridas_min ?? NIVEIS_PADRAO.bronze.corridas_min),
      nota_min: Number(bruto.bronze?.nota_min ?? NIVEIS_PADRAO.bronze.nota_min),
      taxa_huby: Number(bruto.bronze?.taxa_huby ?? taxaBaseBronze)
    },
    prata: {
      nome: 'Prata',
      corridas_min: Number(bruto.prata?.corridas_min ?? NIVEIS_PADRAO.prata.corridas_min),
      nota_min: Number(bruto.prata?.nota_min ?? NIVEIS_PADRAO.prata.nota_min),
      taxa_huby: Number(bruto.prata?.taxa_huby ?? NIVEIS_PADRAO.prata.taxa_huby)
    },
    ouro: {
      nome: 'Ouro',
      corridas_min: Number(bruto.ouro?.corridas_min ?? NIVEIS_PADRAO.ouro.corridas_min),
      nota_min: Number(bruto.ouro?.nota_min ?? NIVEIS_PADRAO.ouro.nota_min),
      taxa_huby: Number(bruto.ouro?.taxa_huby ?? NIVEIS_PADRAO.ouro.taxa_huby)
    }
  };
}

function calcularNivelMotorista(totalCorridas, avaliacaoMedia, niveisConfig) {
  const corridas = Number(totalCorridas || 0);
  const nota = Number(avaliacaoMedia ?? 5.0);

  if (corridas >= niveisConfig.ouro.corridas_min && nota >= niveisConfig.ouro.nota_min) {
    return 'ouro';
  }
  if (corridas >= niveisConfig.prata.corridas_min && nota >= niveisConfig.prata.nota_min) {
    return 'prata';
  }
  return 'bronze';
}

async function obterDadosNivelMotorista(motoristaId, tarifasBanco) {
  const niveisConfig = normalizarConfigNiveis(tarifasBanco);
  if (!motoristaId) {
    return { motorista: null, nivel: 'bronze', taxaPorcentagem: niveisConfig.bronze.taxa_huby, niveisConfig };
  }

  const rows = await sql`
    SELECT id, total_corridas, avaliacao_media, COALESCE(nivel, 'bronze') AS nivel
    FROM motoristas
    WHERE id::text = ${String(motoristaId)}::text
       OR usuario_id::text = ${String(motoristaId)}::text
    LIMIT 1;
  `;

  if (rows.length === 0) {
    return { motorista: null, nivel: 'bronze', taxaPorcentagem: niveisConfig.bronze.taxa_huby, niveisConfig };
  }

  const mot = rows[0];
  const nivelCalculado = calcularNivelMotorista(mot.total_corridas, mot.avaliacao_media, niveisConfig);
  const taxaPorcentagem = Number(niveisConfig[nivelCalculado]?.taxa_huby ?? niveisConfig.bronze.taxa_huby);

  return { motorista: mot, nivel: nivelCalculado, taxaPorcentagem, niveisConfig };
}

export function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : req.query.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

// Lê o token se existir, sem obrigar login (a cotação funciona para visitantes)
function lerUsuarioOpcional(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : null;
  if (!token || token === 'null' || token === 'undefined') return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Limite simples de cotações por IP (60 por minuto) para não sobrecarregar o banco
const LIMITE_COTACOES_MIN = 60;
const contadorCotacoes = new Map();
function limitarCotacao(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'anon').split(',')[0].trim();
  const agora = Date.now();
  const reg = contadorCotacoes.get(ip);
  if (!reg || agora - reg.inicio > 60000) {
    contadorCotacoes.set(ip, { inicio: agora, qtd: 1 });
  } else {
    reg.qtd += 1;
    if (reg.qtd > LIMITE_COTACOES_MIN) {
      return res.status(429).json({ erro: 'Muitas consultas de preço. Aguarde alguns segundos.' });
    }
  }
  if (contadorCotacoes.size > 5000) contadorCotacoes.clear();
  next();
}

// Conta só as paradas reais (o app às vezes manda nota/cupom/agendamento junto na lista)
function contarParadasReais(paradas) {
  const lista = Array.isArray(paradas) ? paradas.slice(0, 10) : [];
  return {
    lista,
    qtd: lista.filter((p) => p && !p.nota && !p.cupom && !p.agendado_para).length
  };
}

function lerCoordenadas(body) {
  const origLat = Number(body.origem_lat !== undefined ? body.origem_lat : body.coordsOrigem?.[0]);
  const origLng = Number(body.origem_lng !== undefined ? body.origem_lng : body.coordsOrigem?.[1]);
  const destLat = Number(body.destino_lat !== undefined ? body.destino_lat : body.coordsDestino?.[0]);
  const destLng = Number(body.destino_lng !== undefined ? body.destino_lng : body.coordsDestino?.[1]);
  const ok = [origLat, origLng, destLat, destLng].every(Number.isFinite)
    && Math.abs(origLat) <= 90 && Math.abs(destLat) <= 90
    && Math.abs(origLng) <= 180 && Math.abs(destLng) <= 180;
  return { ok, origLat, origLng, destLat, destLng };
}

function numeroDoApp(val) {
  return Number(String(val ?? '').replace(',', '.')) || 0;
}

async function inicializarColunasPedidos() {
  try {
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS status_online BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS aceita_entrega BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS aceita_dinheiro BOOLEAN DEFAULT TRUE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS aceita_cartao BOOLEAN DEFAULT TRUE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS aceita_pix BOOLEAN DEFAULT TRUE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS nivel TEXT DEFAULT 'bronze';`;

    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pgto VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS sub_tipo_id VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS sub_tipo_label VARCHAR(100);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_adicionais NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS observacao TEXT;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cupom_codigo VARCHAR(40);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paradas JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_txid TEXT;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chegou_origem_em TIMESTAMP WITH TIME ZONE;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_cancelamento NUMERIC(10,2) DEFAULT 0.00;`;

    await sql`
      CREATE TABLE IF NOT EXISTS mensagens_chat (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT NOT NULL,
        remetente_id TEXT NOT NULL,
        remetente_nome VARCHAR(100),
        mensagem TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`ALTER TABLE avaliacoes ADD COLUMN IF NOT EXISTS etiquetas JSONB DEFAULT '[]'::jsonb;`;
  } catch (e) {
    console.warn('Aviso: Verificação de colunas de pedidos:', e.message);
  }
}
inicializarColunasPedidos();

// ============================================================================
// FUNÇÕES DE CONTROLE DE ACESSO
// ============================================================================
function ehAdminToken(usuario) {
  const role = String(usuario?.role || usuario?.funcao || '').toLowerCase();
  return role === 'admin' || role === 'administrador';
}

function ehMotoristaToken(usuario) {
  return String(usuario?.role || '').toLowerCase() === 'motorista';
}

function motoristaAprovado(mot) {
  return String(mot?.status_aprovacao || '').toLowerCase() === 'aprovado';
}

// Busca o cadastro do motorista dono do token. Nunca "adivinha" outro motorista.
async function buscarMotoristaDoToken(usuario) {
  if (!ehMotoristaToken(usuario)) return null;
  const ids = [usuario?.id, usuario?.motoristaId]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(String);
  if (!ids.length) return null;

  const rows = await sql`
    SELECT *
    FROM motoristas
    WHERE id::text = ANY(${ids})
       OR usuario_id::text = ANY(${ids})
    LIMIT 1;
  `;
  return rows[0] || null;
}

// Diz qual o papel do usuário NESTA corrida: 'admin', 'motorista', 'cliente' ou null (sem acesso)
function papelNoPedido(pedido, usuario, mot) {
  if (ehAdminToken(usuario)) return 'admin';
  if (mot && pedido?.motorista_id && String(pedido.motorista_id) === String(mot.id)) return 'motorista';
  if (pedido?.cliente_id && String(pedido.cliente_id) === String(usuario?.id)) return 'cliente';
  return null;
}

function calcularDistanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function textoLimpo(valor, max) {
  const t = String(valor ?? '').trim();
  return t ? t.slice(0, max) : null;
}

// Worker automático que ativa corridas agendadas faltando 15 minutos para o horário
export function iniciarDespachanteAgendamentos(io) {
  setInterval(async () => {
    try {
      const prontas = await sql`
        UPDATE pedidos
        SET status = 'pendente'
        WHERE status = 'agendado'
          AND agendado_para IS NOT NULL
          AND agendado_para <= NOW() + INTERVAL '15 minutes'
          AND COALESCE(motorista_id::text, '') = ''
        RETURNING *;
      `;

      for (const p of prontas) {
        const valorNum = Number(p.valor_total || 0);
        if (io) {
          io.emit('nova_chamada', {
            id: p.id,
            tipo: p.tipo || 'carro',
            subTipoLabel: `${p.sub_tipo_label || 'HUBy'} (Agendada)`,
            origem: p.origem_endereco,
            destino: p.destino_endereco,
            distanciaKm: Number(p.distancia_km || 0),
            duracaoMin: Number(p.duracao_min || 0),
            valorTotal: valorNum,
            agendadoPara: p.agendado_para,
            observacao: p.observacao || '',
            cupomCodigo: p.cupom_codigo || null,
            paradas: p.paradas || []
          });
        }

        dispararPushParaMotoristas({
          titulo: `⏰ Corrida Agendada Liberada • R$ ${valorNum.toFixed(2).replace('.', ',')}`,
          corpo: `${p.origem_endereco} ➔ ${p.destino_endereco}`,
          categoria: p.sub_tipo_id || p.tipo,
          pedidoId: p.id
        });
      }
    } catch (err) {
      // Silencioso em caso de oscilação de rede
    }
  }, 30000).unref();
}

export default function pedidosRouter(io) {
  const router = express.Router();

  // =========================================================================
  // 0. COTAÇÃO: preço oficial de todas as categorias (não grava nada, não gasta cupom)
  // =========================================================================
  router.post('/cotacao', limitarCotacao, async (req, res) => {
    try {
      const { ok, origLat, origLng, destLat, destLng } = lerCoordenadas(req.body || {});
      if (!ok) {
        return res.status(400).json({ erro: 'Defina a origem e o destino no mapa.' });
      }

      const body = req.body || {};
      const usuario = lerUsuarioOpcional(req);
      const { qtd } = contarParadasReais(body.paradas);
      const qtdParadas = body.paradas !== undefined ? qtd : Math.max(0, parseInt(body.qtdParadas ?? body.qtd_paradas, 10) || 0);

      const categoriaPedida = body.categoria || body.sub_tipo_id || body.subTipoId;
      const categorias = categoriaPedida ? [chaveCategoriaPreco(categoriaPedida)] : CATEGORIAS_PRECO;

      const cotacao = await calcularCotacao({
        origLat, origLng, destLat, destLng,
        distanciaKmApp: body.distancia_km ?? body.distanciaKm,
        duracaoMinApp: body.duracao_min ?? body.duracaoMin,
        qtdParadas,
        adicionais: body.valor_adicionais ?? body.valorAdicionais ?? body.adicionais ?? 0,
        cupomCodigo: body.cupom_codigo || body.cupomCodigo || null,
        clienteId: usuario && !ehMotoristaToken(usuario) ? usuario.id : null,
        categorias
      });

      // O id interno do cupom não sai do servidor
      const { cupomId, ...publico } = cotacao;
      return res.json({ sucesso: true, ...publico });
    } catch (error) {
      console.error('Erro na cotação:', error.message);
      return res.status(500).json({ erro: 'Não foi possível calcular o preço agora.' });
    }
  });

  // =========================================================================
  // 1. CRIAR PEDIDO (IMEDIATO OU AGENDADO + TAXA PARADA DINÂMICA + PUSH REAL)
  // =========================================================================
  router.post('/', autenticarToken, async (req, res) => {
    let cupomReservadoId = null;
    try {
      const {
        id, tipo, subTipoId, sub_tipo_id, subTipoLabel, sub_tipo_label,
        origem, destino, origem_endereco, destino_endereco,
        coordsOrigem, coordsDestino, origem_lat, origem_lng, destino_lat, destino_lng,
        paradas,
        distanciaKm, distancia_km, duracaoMin, duracao_min,
        valorAdicionais, valor_adicionais,
        metodoPgto, metodo_pagamento, forma_pagamento,
        cupomCodigo, cupom_codigo, observacao, agendadoPara, agendado_para
      } = req.body;

      const clienteId = String(req.usuario.id);

      const endOrigem = origem_endereco || origem;
      const endDestino = destino_endereco || destino;

      if (!endOrigem || !endDestino) {
        return res.status(400).json({ erro: 'Dados incompletos para registo da viagem.' });
      }

      const dataAgendamentoRaw = agendado_para || agendadoPara;
      let dataAgendamento = null;
      let statusInicialPedido = 'pendente';

      if (dataAgendamentoRaw) {
        const dt = new Date(dataAgendamentoRaw);
        if (Number.isNaN(dt.getTime())) {
          return res.status(400).json({ erro: 'Data e hora de agendamento inválidas.' });
        }
        const diffMinutos = (dt.getTime() - Date.now()) / 60000;
        if (diffMinutos < 20) {
          return res.status(400).json({ erro: 'O agendamento deve ser feito com pelo menos 25 minutos de antecedência.' });
        }
        if (diffMinutos > 7 * 24 * 60) {
          return res.status(400).json({ erro: 'O agendamento máximo permitido é de 7 dias.' });
        }
        dataAgendamento = dt.toISOString();
        statusInicialPedido = 'agendado';
      }

      const idPedido = (typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id))
        ? id
        : 'ped_' + crypto.randomBytes(8).toString('hex');

      // Adicionais nunca podem ser negativos (evita baixar o preço pelo app)
      const vAdicInformado = Math.min(
        VALOR_ADICIONAIS_MAX,
        Math.max(0, numeroDoApp(valor_adicionais !== undefined ? valor_adicionais : valorAdicionais))
      );

      const { ok: coordsOk, origLat, origLng, destLat, destLng } = lerCoordenadas(req.body);
      if (!coordsOk) {
        return res.status(400).json({ erro: 'Defina a origem e o destino no mapa.' });
      }

      const { lista: paradasValidas, qtd: qtdParadas } = contarParadasReais(paradas);
      const catPreco = chaveCategoriaPreco(sub_tipo_id || subTipoId || tipo || 'carro');
      const cupomInformado = String(cupom_codigo || cupomCodigo || '').trim().toUpperCase().slice(0, 40);

      // Preço calculado pela MESMA fórmula da rota /cotacao (services/precificacao.service.js)
      const parametrosCotacao = {
        origLat, origLng, destLat, destLng,
        distanciaKmApp: distancia_km !== undefined ? distancia_km : distanciaKm,
        duracaoMinApp: duracao_min !== undefined ? duracao_min : duracaoMin,
        qtdParadas,
        adicionais: vAdicInformado,
        clienteId,
        categorias: [catPreco],
        tarifas: await lerTarifasDoBanco()
      };

      let cotacao = await calcularCotacao({ ...parametrosCotacao, cupomCodigo: cupomInformado || null });
      let cupomFinal = null;

      // Cupom válido: reserva 1 uso de forma atômica. Se esgotou no meio do caminho, recalcula sem cupom.
      if (cotacao.cupomId) {
        const reservado = await sql`
          UPDATE cupons_desconto
          SET usos_atuais = COALESCE(usos_atuais, 0) + 1
          WHERE id = ${cotacao.cupomId}
            AND ativo = TRUE
            AND (expira_em IS NULL OR expira_em > NOW())
            AND (COALESCE(limite_usos, 0) = 0 OR COALESCE(usos_atuais, 0) < limite_usos)
          RETURNING id;
        `;
        if (reservado.length > 0) {
          cupomReservadoId = cotacao.cupomId;
          cupomFinal = cupomInformado;
        } else {
          cotacao = await calcularCotacao({ ...parametrosCotacao, cupomCodigo: null });
        }
      }

      const precoCat = cotacao.categorias[catPreco];
      const dKm = cotacao.distanciaKm;
      const dMin = cotacao.duracaoMin;
      const vAdic = cotacao.adicionais;
      const vTotal = precoCat.valorFinal;
      const descontoAplicado = precoCat.descontoTotal;

      // Se o app mostrou um preço e o real ficou mais caro (ex.: dinâmica subiu), pede confirmação
      const valorEsperado = numeroDoApp(req.body.valor_esperado ?? req.body.valorEsperado);
      if (valorEsperado > 0 && vTotal > valorEsperado + 0.50) {
        if (cupomReservadoId) {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
          cupomReservadoId = null;
        }
        return res.status(409).json({
          erro: `O preço mudou para R$ ${vTotal.toFixed(2).replace('.', ',')}. Confirme para chamar.`,
          codigo: 'PRECO_ALTERADO',
          valorAtual: vTotal,
          cotacao: { ...cotacao, cupomId: undefined }
        });
      }

      const obsFinal = textoLimpo(observacao, 400);
      const formaPagamentoFinal = String(forma_pagamento || metodo_pagamento || metodoPgto || 'livre').slice(0, 40);
      const subTipoLabelFinal = String(sub_tipo_label || subTipoLabel || 'HUBy Carro').slice(0, 100);
      const subTipoIdFinal = String(sub_tipo_id || subTipoId || tipo || 'carro').slice(0, 50);

      const usuarioExiste = await sql`SELECT id FROM usuarios WHERE id::text = ${clienteId}::text LIMIT 1;`;
      const idClienteFinal = usuarioExiste.length > 0 ? usuarioExiste[0].id : null;

      if (!idClienteFinal) {
        if (cupomReservadoId) {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
        }
        return res.status(403).json({ erro: 'Entre com uma conta de passageiro para pedir uma corrida.' });
      }

      const inserido = await sql`
        INSERT INTO pedidos (
          id, cliente_id, tipo, sub_tipo_id, sub_tipo_label,
          origem_endereco, destino_endereco,
          origem_lat, origem_lng, destino_lat, destino_lng,
          distancia_km, duracao_min, valor_total, valor_adicionais,
          forma_pagamento, metodo_pgto, status, agendado_para,
          observacao, cupom_codigo, paradas
        ) VALUES (
          ${idPedido}, ${idClienteFinal}, ${String(tipo || 'carro').slice(0, 50)}, ${subTipoIdFinal}, ${subTipoLabelFinal},
          ${String(endOrigem).slice(0, 300)}, ${String(endDestino).slice(0, 300)},
          ${origLat}, ${origLng}, ${destLat}, ${destLng},
          ${dKm}, ${dMin}, ${vTotal}, ${vAdic},
          ${formaPagamentoFinal}, ${formaPagamentoFinal}, ${statusInicialPedido}, ${dataAgendamento},
          ${obsFinal}, ${cupomFinal}, ${JSON.stringify(paradasValidas)}::jsonb
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id;
      `;

      if (!inserido.length) {
        if (cupomReservadoId) {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
        }
        return res.status(409).json({ erro: 'Já existe uma corrida com este código.' });
      }

      if (io) {
        io.emit('nova_chamada', {
          id: idPedido,
          tipo: tipo || 'carro',
          subTipoLabel: subTipoLabelFinal,
          origem: endOrigem,
          destino: endDestino,
          distanciaKm: dKm,
          duracaoMin: dMin,
          valorTotal: vTotal,
          status: statusInicialPedido,
          agendadoPara: dataAgendamento,
          observacao: obsFinal,
          cupomCodigo: cupomFinal,
          paradas: paradasValidas
        });
      }

      if (statusInicialPedido === 'pendente') {
        dispararPushParaMotoristas({
          titulo: `🚘 Nova Chamada (${subTipoLabelFinal}) • R$ ${vTotal.toFixed(2).replace('.', ',')}`,
          corpo: `${endOrigem} ➔ ${endDestino}`,
          categoria: subTipoIdFinal,
          pedidoId: idPedido
        });
      } else if (statusInicialPedido === 'agendado') {
        const horaFmt = new Date(dataAgendamento).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        dispararPushParaMotoristas({
          titulo: `📅 Novo Agendamento (${horaFmt}) • R$ ${vTotal.toFixed(2).replace('.', ',')}`,
          corpo: `${endOrigem} ➔ ${endDestino}`,
          categoria: subTipoIdFinal,
          pedidoId: idPedido
        });
      }

      return res.status(201).json({
        sucesso: true,
        id: idPedido,
        agendada: statusInicialPedido === 'agendado',
        agendadoPara: dataAgendamento,
        valorFinal: vTotal,
        desconto: descontoAplicado,
        distanciaKm: dKm,
        duracaoMin: dMin,
        multiplicador: cotacao.multiplicador,
        cupomAplicado: cupomFinal,
        cupomRecusado: cupomInformado && !cupomFinal ? (cotacao.cupom?.motivo || 'Cupom não aplicado.') : null
      });
    } catch (error) {
      console.error('⚠️ ERRO AO GRAVAR PEDIDO NO BANCO:', error);
      if (cupomReservadoId) {
        try {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
        } catch (e) { }
      }
      return res.status(500).json({ erro: 'Falha ao salvar a corrida. Tente novamente.' });
    }
  });

  // Listar corridas agendadas do usuário
  router.get('/agendadas', autenticarToken, async (req, res) => {
    try {
      const usuarioId = String(req.usuario.id);
      const lista = await sql`
        SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco,
               distancia_km, valor_total, status, agendado_para, observacao, cupom_codigo, criado_em
        FROM pedidos
        WHERE cliente_id::text = ${usuarioId}::text
          AND status = 'agendado'
        ORDER BY agendado_para ASC;
      `;
      res.json(lista);
    } catch (err) {
      res.json([]);
    }
  });

  // =========================================================================
  // 2. RADAR DE MOTORISTAS EM TEMPO REAL (TRANSMISSÃO GPS) - SÓ MOTORISTA
  // =========================================================================
  router.post('/motoristas/localizacao', autenticarToken, async (req, res) => {
    try {
      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });

      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const heading = Number(req.body?.heading || 0);
      const emCorrida = Boolean(req.body?.emCorrida);

      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ erro: 'Coordenadas inválidas.' });
      }

      if (io) {
        io.emit('posicao_motorista', {
          motoristaId: mot.id,
          lat,
          lng,
          heading: Number.isFinite(heading) ? heading : 0,
          emCorrida,
          atualizadoEm: new Date().toISOString()
        });
      }

      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao emitir localização.' });
    }
  });

  // =========================================================================
  // 3. CONSULTA DE CHAMADAS PENDENTES (COM PRIORIDADE OURO > PRATA > BRONZE)
  // =========================================================================
  router.get('/pendentes', autenticarToken, async (req, res) => {
    try {
      const ehAdmin = ehAdminToken(req.usuario);
      let mot = null;

      if (!ehAdmin) {
        mot = await buscarMotoristaDoToken(req.usuario);
        if (!mot) {
          return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });
        }
        if (!motoristaAprovado(mot)) {
          return res.status(403).json({ erro: 'Seu cadastro ainda está em análise.' });
        }
        if (mot.status_online === false) {
          return res.json([]);
        }
      }

      const { categoria, aceitaEntrega, lat, lng } = req.query;
      const motoristaLat = Number(lat);
      const motoristaLng = Number(lng);
      const temCoordsValidas =
        Number.isFinite(motoristaLat) &&
        Number.isFinite(motoristaLng) &&
        Math.abs(motoristaLat) <= 90 &&
        Math.abs(motoristaLng) <= 180 &&
        !(motoristaLat === 0 && motoristaLng === 0);

      // A categoria do motorista vem do cadastro dele, não do app
      let catMotorista = String((mot?.categoria) || categoria || 'carro').toLowerCase().trim();
      const fazEntregaExtra = mot
        ? Boolean(mot.aceita_entrega)
        : String(aceitaEntrega || '').toLowerCase() === 'true';
      const nivelMotorista = String(mot?.nivel || 'bronze').toLowerCase();

      if (catMotorista.includes('flash') || catMotorista.includes('frete') || catMotorista.includes('entrega')) {
        catMotorista = 'entrega';
      } else if (catMotorista.includes('moto')) {
        catMotorista = 'moto';
      } else {
        catMotorista = 'carro';
      }

      const atrasoPrioridadeSeg = ehAdmin
        ? 0
        : (nivelMotorista === 'ouro' ? 0 : (nivelMotorista === 'prata' ? 4 : 8));

      const rawPedidos = await sql`
        SELECT id, status, tipo, sub_tipo_id, sub_tipo_label,
               origem_endereco, destino_endereco,
               origem_lat, origem_lng, destino_lat, destino_lng,
               distancia_km, duracao_min, valor_total, forma_pagamento, metodo_pgto,
               observacao, cupom_codigo, paradas, agendado_para, criado_em,
               EXTRACT(EPOCH FROM (NOW() - criado_em)) AS segundos_espera
        FROM pedidos
        WHERE status = ANY(${STATUS_BUSCANDO})
          AND COALESCE(motorista_id::text, '') = ''
        ORDER BY criado_em DESC
        LIMIT 60;
      `;

      const listaEntrega = ['cargo_pickup', 'frete', 'entrega', 'flash', 'hubyflash', 'huby flash'];
      const listaMoto = ['moto', 'hubymoto', 'huby moto'];

      const filtrados = rawPedidos.filter((p) => {
        if (p.status !== 'agendado' && atrasoPrioridadeSeg > 0) {
          const segs = Number(p.segundos_espera || 0);
          if (segs < atrasoPrioridadeSeg) return false;
        }

        const tipoPedido = String(p.sub_tipo_id || p.tipo || 'carro').toLowerCase().trim();
        const ehPedidoEntrega = listaEntrega.includes(tipoPedido);
        const ehPedidoMoto = listaMoto.includes(tipoPedido);
        const ehPedidoCarro = !ehPedidoEntrega && !ehPedidoMoto;

        let compativelCategoria = false;
        if (catMotorista === 'moto') {
          compativelCategoria = ehPedidoMoto || (fazEntregaExtra && ehPedidoEntrega);
        } else if (catMotorista === 'entrega') {
          compativelCategoria = ehPedidoEntrega;
        } else {
          compativelCategoria = ehPedidoCarro || (fazEntregaExtra && ehPedidoEntrega);
        }

        if (!compativelCategoria) return false;

        if (temCoordsValidas && p.origem_lat !== null && p.origem_lng !== null) {
          const dist = calcularDistanciaKm(
            motoristaLat,
            motoristaLng,
            Number(p.origem_lat),
            Number(p.origem_lng)
          );
          if (Number.isFinite(dist) && dist > RAIO_MAXIMO_KM) {
            return false;
          }
        }

        return true;
      }).slice(0, 30);

      return res.json(filtrados);
    } catch (error) {
      console.error('Erro em GET /api/pedidos/pendentes:', error);
      return res.status(500).json({ erro: 'Falha ao consultar chamadas.' });
    }
  });

  // =========================================================================
  // 4. HISTÓRICO (CADA UM VÊ SÓ O SEU)
  // =========================================================================
  router.get('/historico', autenticarToken, async (req, res) => {
    try {
      if (ehMotoristaToken(req.usuario)) {
        const mot = await buscarMotoristaDoToken(req.usuario);
        if (!mot) return res.json([]);
        const historico = await sql`
          SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km,
                 valor_total, status, criado_em, cliente_id
          FROM pedidos
          WHERE motorista_id::text = ${String(mot.id)}::text
          ORDER BY criado_em DESC
          LIMIT 30;
        `;
        return res.json(historico);
      }

      const historico = await sql`
        SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km,
               valor_total, status, criado_em, motorista_nome
        FROM pedidos
        WHERE cliente_id::text = ${String(req.usuario.id)}::text
        ORDER BY criado_em DESC
        LIMIT 30;
      `;
      return res.json(historico);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao obter histórico de viagens.' });
    }
  });

  // =========================================================================
  // 5. ROTA PÚBLICA PARA RASTREIO (LINK COMPARTILHADO) E RECIBO
  //    Sem telefone, sem dados de pagamento no rastreio.
  // =========================================================================
  router.get('/publico/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT
          p.id, p.status, p.origem_endereco, p.destino_endereco,
          p.origem_lat, p.origem_lng, p.destino_lat, p.destino_lng,
          p.distancia_km, p.duracao_min, p.sub_tipo_label,
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.foto_perfil_url AS motorista_foto,
          m.avaliacao_media AS motorista_avaliacao
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id::text = m.id::text
        WHERE p.id::text = ${String(id)}::text
        LIMIT 1;
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Viagem não encontrada.' });
      }

      return res.json(pedidos[0]);
    } catch (err) {
      return res.status(500).json({ erro: 'Erro interno ao consultar dados da viagem.' });
    }
  });

  router.get('/recibo/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT
          p.id, p.status, p.tipo, p.sub_tipo_label,
          p.origem_endereco, p.destino_endereco,
          p.distancia_km, p.duracao_min,
          p.valor_total, p.forma_pagamento, p.metodo_pgto,
          p.criado_em, p.embarque_em, p.concluido_em,
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.veiculo_cor,
          m.foto_perfil_url AS motorista_foto
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id::text = m.id::text
        WHERE p.id::text = ${String(id)}::text
          AND p.status = 'concluido'
        LIMIT 1;
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Recibo disponível apenas para corridas concluídas.' });
      }

      return res.json(pedidos[0]);
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao gerar recibo da viagem.' });
    }
  });

  // =========================================================================
  // 6. STATUS DA VIAGEM (SÓ PASSAGEIRO, MOTORISTA DA CORRIDA OU ADMIN)
  // =========================================================================
  router.get('/:id/status', autenticarToken, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const { id } = req.params;
      const pedidos = await sql`
        SELECT
          p.id, p.status, p.cliente_id, p.valor_total, p.distancia_km, p.duracao_min,
          p.origem_endereco, p.destino_endereco,
          p.origem_lat, p.origem_lng, p.destino_lat, p.destino_lng,
          p.chegou_origem_em, p.agendado_para, p.observacao, p.cupom_codigo, p.cancelado_por,
          p.forma_pagamento,
          p.motorista_id,
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.telefone, p.motorista_telefone) AS motorista_telefone,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.veiculo_cor,
          m.veiculo_ano,
          m.foto_perfil_url AS motorista_foto,
          m.avaliacao_media AS motorista_avaliacao,
          m.total_corridas AS motorista_corridas,
          COALESCE(m.nivel, 'bronze') AS motorista_nivel,
          COALESCE(m.aceita_dinheiro, true) AS aceita_dinheiro,
          COALESCE(m.aceita_cartao, true) AS aceita_cartao,
          COALESCE(m.aceita_pix, true) AS aceita_pix
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id::text = m.id::text
        WHERE p.id::text = ${String(id)}::text
        LIMIT 1;
      `;

      if (pedidos.length === 0) return res.status(404).json({ erro: 'Chamada não localizada.' });

      const pedido = pedidos[0];
      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedido, req.usuario, mot);

      if (!papel) {
        // Outro motorista só pode saber se a chamada ainda está livre (usado pelo radar)
        if (mot) {
          return res.json({ id: pedido.id, status: pedido.status });
        }
        return res.status(404).json({ erro: 'Chamada não localizada.' });
      }

      return res.json(pedido);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao consultar estado da chamada.' });
    }
  });

  // Motorista da corrida avisa que chegou (ou volta para "a caminho")
  router.put('/:id/status', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const novoStatus = String(req.body?.status || '').trim().toLowerCase();

      const permitidos = ['a_caminho', ...STATUS_CHEGADA];
      if (!permitidos.includes(novoStatus)) {
        return res.status(400).json({ erro: 'Status inválido.' });
      }

      const pedidos = await sql`
        SELECT id, status, cliente_id, motorista_id FROM pedidos
        WHERE id::text = ${String(id)}::text LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Corrida não encontrada.' });

      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedidos[0], req.usuario, mot);
      // Passageiro pode cancelar enquanto procura motorista OU enquanto o motorista vem buscá-lo.
      // Depois do embarque (em viagem) não dá mais para cancelar pelo app.
      // Por enquanto sem taxa para o passageiro (ainda não existe cobrança de cancelamento).
      const passageiroPodeCancelar = aindaBuscando || STATUS_A_CAMINHO.includes(statusAtual);
      if (papel === 'cliente' && !passageiroPodeCancelar) {
        return res.status(403).json({ erro: 'A viagem já começou. Para encerrar, fale com o motorista ou com o suporte.' });
      }

      const ehChegadaNoLocal = STATUS_CHEGADA.includes(novoStatus);

      const atualizado = ehChegadaNoLocal
        ? await sql`
            UPDATE pedidos
            SET status = ${novoStatus},
                chegou_origem_em = COALESCE(chegou_origem_em, CURRENT_TIMESTAMP)
            WHERE id::text = ${String(id)}::text
              AND status = ANY(${STATUS_A_CAMINHO})
            RETURNING id, chegou_origem_em;
          `
        : await sql`
            UPDATE pedidos
            SET status = ${novoStatus}
            WHERE id::text = ${String(id)}::text
              AND status = ANY(${STATUS_A_CAMINHO})
            RETURNING id, chegou_origem_em;
          `;

      if (atualizado.length === 0) {
        return res.status(409).json({ erro: 'Esta corrida não está mais nesta etapa.' });
      }

      if (io) {
        io.emit('status_corrida_atualizado', {
          pedidoId: id,
          status: novoStatus,
          chegouOrigemEm: ehChegadaNoLocal ? atualizado[0].chegou_origem_em : undefined
        });
      }

      res.json({ sucesso: true, status: novoStatus });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao atualizar status do pedido.' });
    }
  });

  router.put('/:id/embarque', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT id, status, cliente_id, motorista_id FROM pedidos
        WHERE id::text = ${String(id)}::text LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Corrida não encontrada.' });

      const pedido = pedidos[0];
      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedido, req.usuario, mot);
      if (papel !== 'motorista' && papel !== 'admin') {
        return res.status(403).json({ erro: 'Apenas o motorista desta corrida pode confirmar o embarque.' });
      }

      if (String(pedido.status).toLowerCase() === 'em_viagem') {
        return res.json({ sucesso: true, status: 'em_viagem' });
      }

      const atualizado = await sql`
        UPDATE pedidos
        SET status = 'em_viagem',
            embarque_em = CURRENT_TIMESTAMP
        WHERE id::text = ${String(id)}::text
          AND status = ANY(${STATUS_A_CAMINHO})
        RETURNING id;
      `;

      if (atualizado.length === 0) {
        return res.status(409).json({ erro: 'Esta corrida não está aguardando embarque.' });
      }

      if (io) {
        io.emit('passageiro_a_bordo', { pedidoId: id, status: 'em_viagem' });
      }

      res.json({ sucesso: true, status: 'em_viagem' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao registrar embarque do passageiro.' });
    }
  });

  // =========================================================================
  // CHAT DA CORRIDA (SÓ PASSAGEIRO, MOTORISTA DA CORRIDA OU ADMIN)
  // =========================================================================
  router.get('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT id, cliente_id, motorista_id FROM pedidos
        WHERE id::text = ${String(id)}::text LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Corrida não encontrada.' });

      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!papelNoPedido(pedidos[0], req.usuario, mot)) {
        return res.status(403).json({ erro: 'Sem acesso a este chat.' });
      }

      const msgs = await sql`
        SELECT id, pedido_id, remetente_id, remetente_nome, mensagem, criado_em
        FROM mensagens_chat
        WHERE pedido_id = ${String(id)}
        ORDER BY id ASC
        LIMIT 100;
      `;
      res.json(msgs);
    } catch (err) {
      res.json([]);
    }
  });

  router.post('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const mensagem = String(req.body?.mensagem || '').trim().slice(0, 500);
      if (!mensagem) return res.status(400).json({ erro: 'Mensagem vazia.' });

      const pedidos = await sql`
        SELECT id, status, cliente_id, motorista_id FROM pedidos
        WHERE id::text = ${String(id)}::text LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Corrida não encontrada.' });

      const pedido = pedidos[0];
      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedido, req.usuario, mot);
      if (!papel) return res.status(403).json({ erro: 'Sem acesso a este chat.' });

      if (STATUS_ENCERRADOS.includes(String(pedido.status).toLowerCase()) && papel !== 'admin') {
        return res.status(400).json({ erro: 'O chat desta corrida já foi encerrado.' });
      }

      // O nome vem do cadastro, não do app (evita alguém se passar por "Suporte HUBy")
      let remetenteNome = 'Passageiro';
      if (papel === 'motorista') remetenteNome = mot?.nome || 'Motorista';
      else if (papel === 'admin') remetenteNome = 'Suporte HUBy';
      else remetenteNome = String(req.usuario?.nome || 'Passageiro');
      remetenteNome = remetenteNome.slice(0, 80);

      const remetenteId = papel === 'motorista' ? String(mot.id) : String(req.usuario?.id || '');

      const nova = await sql`
        INSERT INTO mensagens_chat (pedido_id, remetente_id, remetente_nome, mensagem)
        VALUES (${String(id)}, ${remetenteId}, ${remetenteNome}, ${mensagem})
        RETURNING id, pedido_id, remetente_id, remetente_nome, mensagem, criado_em;
      `;

      if (io) {
        io.emit(`nova_mensagem_chat_${id}`, nova[0]);
      }

      res.status(201).json(nova[0]);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao enviar mensagem.' });
    }
  });

  // =========================================================================
  // 7. ACEITAR VIAGEM (SÓ MOTORISTA APROVADO, SEM OUTRA CORRIDA EM ANDAMENTO)
  // =========================================================================
  router.put('/:id/aceitar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) {
        return res.status(403).json({ erro: 'Apenas motoristas parceiros podem aceitar corridas.' });
      }
      if (!motoristaAprovado(mot)) {
        return res.status(403).json({ erro: 'Seu cadastro ainda está em análise. Aguarde a aprovação.' });
      }

      const saldoAtual = Number(mot.saldo_carteira || 0);
      if (saldoAtual <= -50) {
        return res.status(403).json({
          erro: `Acesso suspenso: Seu saldo na carteira é de R$ ${saldoAtual.toFixed(2).replace('.', ',')}. Regularize seus repasses pendentes para aceitar novas corridas.`
        });
      }

      // Já é minha? (repetição do mesmo pedido, ex.: internet instável)
      const jaMinha = await sql`
        SELECT * FROM pedidos
        WHERE id::text = ${String(id)}::text
          AND motorista_id::text = ${String(mot.id)}::text
          AND status = ANY(${STATUS_ATIVOS_MOTORISTA})
        LIMIT 1;
      `;
      if (jaMinha.length > 0) {
        return res.json({ sucesso: true, pedido: jaMinha[0] });
      }

      // Não pode pegar duas corridas ao mesmo tempo
      const outraAtiva = await sql`
        SELECT id FROM pedidos
        WHERE motorista_id::text = ${String(mot.id)}::text
          AND status = ANY(${STATUS_ATIVOS_MOTORISTA})
          AND id::text <> ${String(id)}::text
        LIMIT 1;
      `;
      if (outraAtiva.length > 0) {
        return res.status(409).json({ erro: 'Você já tem uma corrida em andamento. Finalize-a antes de aceitar outra.' });
      }

      const pedidoAtualizado = await sql`
        UPDATE pedidos
        SET status = 'a_caminho',
            motorista_id = ${String(mot.id)},
            motorista_nome = ${mot.nome || 'Motorista'},
            motorista_telefone = ${mot.telefone || ''},
            motorista_veiculo = ${mot.veiculo_modelo || ''},
            motorista_placa = ${mot.veiculo_placa || ''}
        WHERE id::text = ${String(id)}::text
          AND status = ANY(${STATUS_BUSCANDO})
          AND COALESCE(motorista_id::text, '') = ''
        RETURNING *;
      `;

      if (pedidoAtualizado.length === 0) {
        return res.status(409).json({ erro: 'Esta corrida já não está disponível.' });
      }

      const payloadResposta = {
        ...pedidoAtualizado[0],
        motorista_foto: mot.foto_perfil_url,
        motorista_avaliacao: mot.avaliacao_media,
        motorista_corridas: mot.total_corridas,
        motorista_nivel: mot.nivel || 'bronze',
        veiculo_cor: mot.veiculo_cor,
        aceita_dinheiro: mot.aceita_dinheiro !== false,
        aceita_cartao: mot.aceita_cartao !== false,
        aceita_pix: mot.aceita_pix !== false
      };

      if (io) {
        io.emit('corrida_aceita', {
          pedidoId: id,
          status: 'a_caminho',
          motorista: {
            id: mot.id,
            nome: mot.nome,
            telefone: mot.telefone,
            veiculo: mot.veiculo_modelo || '',
            placa: mot.veiculo_placa || '',
            cor: mot.veiculo_cor || '',
            foto: mot.foto_perfil_url,
            avaliacao: mot.avaliacao_media,
            nivel: mot.nivel || 'bronze',
            aceita_dinheiro: mot.aceita_dinheiro !== false,
            aceita_cartao: mot.aceita_cartao !== false,
            aceita_pix: mot.aceita_pix !== false
          }
        });
      }

      res.json({ sucesso: true, pedido: payloadResposta });
    } catch (err) {
      console.error('Erro ao aceitar pedido:', err);
      res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
    }
  });

  // =========================================================================
  // 8. CONCLUIR VIAGEM MANUALMENTE (SÓ ADMIN)
  //    Credita o repasse na carteira: use apenas quando o pagamento entrou pela plataforma.
  //    O app do motorista usa a rota 8.1 (finalizar-liquidacao).
  // =========================================================================
  router.put('/:id/concluir', autenticarToken, async (req, res) => {
    try {
      if (!ehAdminToken(req.usuario)) {
        return res.status(403).json({ erro: 'Apenas administradores podem concluir corridas manualmente.' });
      }

      const { id } = req.params;

      const concluido = await sql`
        UPDATE pedidos
        SET status = 'concluido', concluido_em = NOW()
        WHERE id::text = ${String(id)}::text
          AND status <> ALL(${STATUS_ENCERRADOS})
        RETURNING id, cliente_id, valor_total, motorista_id;
      `;
      if (concluido.length === 0) {
        return res.status(409).json({ erro: 'Corrida não encontrada ou já encerrada.' });
      }

      const pedido = concluido[0];
      const valorBruto = Number(pedido.valor_total) || 0;
      let repasseMotorista = 0;
      let taxaPlataforma = 0;
      let taxaPorcentagem = 0;
      let nivelAnterior = 'bronze';
      let novoNivel = 'bronze';
      let novoSaldo = 0;

      if (pedido.motorista_id) {
        const tarifasBanco = await lerTarifasDoBanco();
        const dadosNivel = await obterDadosNivelMotorista(pedido.motorista_id, tarifasBanco);
        taxaPorcentagem = dadosNivel.taxaPorcentagem;
        nivelAnterior = dadosNivel.nivel;

        taxaPlataforma = Number(((valorBruto * taxaPorcentagem) / 100).toFixed(2));
        repasseMotorista = Number((valorBruto - taxaPlataforma).toFixed(2));

        const novoTotalCorridas = Number(dadosNivel.motorista?.total_corridas || 0) + 1;
        novoNivel = calcularNivelMotorista(novoTotalCorridas, dadosNivel.motorista?.avaliacao_media ?? 5.0, dadosNivel.niveisConfig);

        const condutorAtualizado = await sql`
          UPDATE motoristas
          SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista},
              total_corridas = ${novoTotalCorridas},
              nivel = ${novoNivel}
          WHERE id::text = ${String(pedido.motorista_id)}::text
          RETURNING saldo_carteira;
        `;
        novoSaldo = Number(condutorAtualizado[0]?.saldo_carteira || 0);

        try {
          await sql`
            INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
            VALUES (${String(pedido.motorista_id)}, 'motorista', 'repasse_conclusao_admin', ${repasseMotorista}, ${String(id)});
          `;
        } catch (eTx) { }
      }

      if (pedido.cliente_id) {
        await liquidarBonusIndicacaoPrimeiraCorrida(pedido.cliente_id);
      }

      if (io) {
        io.emit('corrida_finalizada', {
          pedidoId: id,
          status: 'concluido',
          valorFinal: valorBruto
        });
      }

      res.json({
        sucesso: true,
        mensagem: 'Chamada concluída com sucesso!',
        repasseLiquido: repasseMotorista,
        taxaHuby: taxaPlataforma,
        taxaPercentualAplicada: taxaPorcentagem,
        nivelAnterior,
        nivelAtual: novoNivel,
        subiuNivel: nivelAnterior !== novoNivel,
        novoSaldoCarteira: novoSaldo
      });
    } catch (err) {
      res.status(500).json({ erro: 'Falha interna ao processar valores.' });
    }
  });

  // =========================================================================
  // 8.1 FINALIZAÇÃO COM ESCOLHA DO MÉTODO (DINHEIRO, MAQUININHA OU PIX)
  //     Só o motorista da corrida (ou admin). Nunca cobra a taxa duas vezes.
  // =========================================================================
  router.post('/:id/finalizar-liquidacao', autenticarToken, async (req, res) => {
    const { id } = req.params;
    const formaPagamento = String(req.body?.forma_pagamento || '').trim();

    try {
      if (![...FORMAS_PRESENCIAIS, 'pix_mp'].includes(formaPagamento)) {
        return res.status(400).json({ erro: 'Forma de pagamento não suportada.' });
      }

      const pedidos = await sql`
        SELECT * FROM pedidos
        WHERE id::text = ${String(id)}::text
        LIMIT 1;
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Corrida não encontrada.' });
      }

      const pedido = pedidos[0];
      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedido, req.usuario, mot);

      if (papel !== 'motorista' && papel !== 'admin') {
        return res.status(403).json({ erro: 'Apenas o motorista desta corrida pode finalizá-la.' });
      }

      const statusAtual = String(pedido.status || '').toLowerCase();
      if (statusAtual === 'concluido') {
        return res.status(409).json({ erro: 'Esta corrida já foi finalizada.' });
      }
      if (statusAtual === 'cancelado') {
        return res.status(409).json({ erro: 'Esta corrida foi cancelada.' });
      }
      if (!pedido.motorista_id) {
        return res.status(400).json({ erro: 'Corrida sem motorista atribuído.' });
      }

      const valorTotal = Number(pedido.valor_total || 0);

      if (FORMAS_PRESENCIAIS.includes(formaPagamento)) {
        // Conclusão atômica: só uma requisição consegue concluir (evita taxa em dobro)
        const concluido = await sql`
          UPDATE pedidos
          SET status = 'concluido',
              forma_pagamento = ${formaPagamento},
              metodo_pgto = ${formaPagamento},
              concluido_em = CURRENT_TIMESTAMP
          WHERE id::text = ${String(id)}::text
            AND status <> ALL(${STATUS_ENCERRADOS})
          RETURNING id;
        `;

        if (concluido.length === 0) {
          return res.status(409).json({ erro: 'Esta corrida já foi finalizada.' });
        }

        const tarifasBanco = await lerTarifasDoBanco();
        const { motorista: motDados, nivel: nivelAnterior, taxaPorcentagem, niveisConfig } =
          await obterDadosNivelMotorista(pedido.motorista_id, tarifasBanco);
        const taxaPlataforma = Number(((valorTotal * taxaPorcentagem) / 100).toFixed(2));

        const novoTotalCorridas = Number(motDados?.total_corridas || 0) + 1;
        const novoNivel = calcularNivelMotorista(novoTotalCorridas, motDados?.avaliacao_media ?? 5.0, niveisConfig);

        await sql`
          UPDATE motoristas
          SET saldo_carteira = COALESCE(saldo_carteira, 0) - ${taxaPlataforma},
              total_corridas = ${novoTotalCorridas},
              nivel = ${novoNivel}
          WHERE id::text = ${String(pedido.motorista_id)}::text;
        `;

        try {
          await sql`
            INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
            VALUES (${String(pedido.motorista_id)}, 'motorista', 'desconto_comissao_viagem_especie', ${-taxaPlataforma}, ${String(id)});
          `;
        } catch (eTrans) { }

        if (pedido.cliente_id) {
          await liquidarBonusIndicacaoPrimeiraCorrida(pedido.cliente_id);
        }

        if (io) {
          io.emit(`corrida_finalizada_${id}`, {
            sucesso: true,
            pedidoId: id,
            forma_pagamento: formaPagamento,
            valorTotal,
            mensagem: 'Viagem finalizada e acertada com o motorista!'
          });
          io.emit('corrida_finalizada', { pedidoId: id, status: 'concluido', valorFinal: valorTotal });
        }

        return res.json({
          sucesso: true,
          status: 'concluido',
          forma_pagamento: formaPagamento,
          taxaPercentualAplicada: taxaPorcentagem,
          nivelAtual: novoNivel,
          subiuNivel: nivelAnterior !== novoNivel
        });
      }

      // ---------------- PIX MERCADO PAGO ----------------
      let accessToken = process.env.MP_ACCESS_TOKEN;

      if (!accessToken) {
        const configGateway = await sql`
          SELECT valor::text AS valor_txt FROM configuracoes_plataforma
          WHERE chave = 'gateway_mercadopago'
          LIMIT 1;
        `;
        const gw = extrairObjetoJSONB(configGateway[0]?.valor_txt, {});
        accessToken = gw.access_token;
      }

      if (!accessToken) {
        return res.status(400).json({ erro: 'Credenciais do Mercado Pago não configuradas no sistema.' });
      }

      if (!(valorTotal > 0)) {
        return res.status(400).json({ erro: 'Valor da corrida inválido para cobrança Pix.' });
      }

      const client = new MercadoPagoConfig({ accessToken });
      const payment = new Payment(client);
      const notificationUrl = `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`;

      const respostaMP = await payment.create({
        body: {
          transaction_amount: valorTotal,
          description: `HUBy - Corrida #${id}`,
          external_reference: String(id),
          payment_method_id: 'pix',
          notification_url: notificationUrl,
          payer: {
            email: 'passageiro@huby.app',
            first_name: 'Passageiro',
            last_name: 'HUBy'
          }
        }
      });

      const pixData = respostaMP.point_of_interaction?.transaction_data;
      const txidGerado = String(respostaMP.id);

      if (!pixData) {
        return res.status(500).json({ erro: 'Falha ao gerar QR Code Pix no Mercado Pago.' });
      }

      try {
        await sql`UPDATE pedidos SET pix_txid = ${txidGerado} WHERE id::text = ${String(id)}::text;`;
      } catch (ePed) { }

      try {
        await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS txid VARCHAR(64);`;
        await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pedido_id TEXT;`;
        await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
        await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;`;
        await sql`
          INSERT INTO cobrancas_pix (txid, transacao_id, pedido_id, usuario_id, valor, status, pix_copia_cola, qr_code, qr_code_base64)
          VALUES (${txidGerado}, ${txidGerado}, ${String(id)}, ${pedido.cliente_id ? String(pedido.cliente_id) : null}, ${valorTotal}, 'pendente', ${pixData.qr_code}, ${pixData.qr_code}, ${pixData.qr_code_base64});
        `;
      } catch (ePix) {
        console.warn('Aviso cobrancas_pix:', ePix.message);
      }

      const payloadPix = {
        pedido_id: id,
        txid: txidGerado,
        transacao_id: txidGerado,
        valor: valorTotal,
        qr_code: pixData.qr_code,
        qr_code_base64: pixData.qr_code_base64
      };

      if (io) {
        io.emit(`exibir_pix_corrida_${id}`, payloadPix);
      }

      return res.json({ sucesso: true, status: 'aguardando_pix', pix: payloadPix });
    } catch (err) {
      console.error('Erro ao finalizar corrida:', err);
      res.status(500).json({ erro: 'Erro interno ao processar encerramento da corrida.' });
    }
  });

  // =========================================================================
  // 9. CANCELAR VIAGEM
  //    Passageiro: só enquanto procura motorista. Motorista: só a corrida dele.
  // =========================================================================
  router.put('/:id/cancelar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const motivo = textoLimpo(req.body?.motivo, 200);

      const pedidos = await sql`
        SELECT id, status, cliente_id, motorista_id, chegou_origem_em,
               origem_endereco, destino_endereco, origem_lat, origem_lng
        FROM pedidos
        WHERE id::text = ${String(id)}::text
        LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      const statusAtual = String(pedido.status || '').toLowerCase();

      if (STATUS_ENCERRADOS.includes(statusAtual)) {
        return res.status(400).json({ erro: 'Esta corrida já foi encerrada.' });
      }

      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedido, req.usuario, mot);
      const aindaBuscando = STATUS_BUSCANDO.includes(statusAtual) && !pedido.motorista_id;

      if (!papel) {
        return res.status(403).json({ erro: 'Você não tem permissão para cancelar esta corrida.' });
      }
      if (papel === 'cliente' && !aindaBuscando) {
        return res.status(403).json({ erro: 'Corrida já aceita. Apenas o motorista parceiro pode cancelar agora.' });
      }

      const canceladoPor = papel === 'cliente' ? 'cliente' : papel; // 'motorista' | 'admin' | 'cliente'

      // Calcula (mas só aplica depois de cancelar de fato)
      let taxaCancelamentoAplicada = 0;
      let repasseEsperaMotorista = 0;
      if (canceladoPor === 'motorista' && pedido.motorista_id && pedido.chegou_origem_em) {
        const segundosEsperados = (Date.now() - new Date(pedido.chegou_origem_em).getTime()) / 1000;
        if (segundosEsperados >= TEMPO_TOLERANCIA_ESPERA_SEG) {
          taxaCancelamentoAplicada = VALOR_TAXA_CANCELAMENTO;
          repasseEsperaMotorista = Number((VALOR_TAXA_CANCELAMENTO * 0.85).toFixed(2));
        }
      }

      const motivoFinal = taxaCancelamentoAplicada > 0
        ? `${motivo || 'Cancelado pelo motorista'} (Taxa de espera aplicada: R$ ${taxaCancelamentoAplicada.toFixed(2).replace('.', ',')})`
        : (motivo || (canceladoPor === 'cliente' ? 'Cancelado pelo passageiro durante a busca' : (canceladoPor === 'admin' ? 'Cancelado pela administração' : 'Cancelado pelo motorista')));

      // Cancelamento atômico: se duas requisições chegarem juntas, só uma vale
      const atualizado = await sql`
        UPDATE pedidos
        SET status = 'cancelado',
            motivo_cancelamento = ${motivoFinal},
            cancelado_por = ${canceladoPor},
            taxa_cancelamento = ${taxaCancelamentoAplicada}
        WHERE id::text = ${String(id)}::text
          AND status <> ALL(${STATUS_ENCERRADOS})
        RETURNING *;
      `;

      if (atualizado.length === 0) {
        return res.status(400).json({ erro: 'Esta corrida já foi encerrada.' });
      }

      if (repasseEsperaMotorista > 0) {
        await sql`
          UPDATE motoristas
          SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseEsperaMotorista}
          WHERE id::text = ${String(pedido.motorista_id)}::text;
        `;
        try {
          await sql`
            INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
            VALUES (${String(pedido.motorista_id)}, 'motorista', 'taxa_espera_cancelamento', ${repasseEsperaMotorista}, ${String(id)});
          `;
        } catch (eTx) { }
      }

      if (aindaBuscando) {
        await registrarDemandaNaoAtendida({
          pedidoId: pedido.id,
          origemEndereco: pedido.origem_endereco,
          destinoEndereco: pedido.destino_endereco,
          lat: pedido.origem_lat,
          lng: pedido.origem_lng,
          motivo: canceladoPor === 'cliente' ? 'cancelado_durante_busca' : 'sem_aceite',
          io
        });
      }

      if (io) {
        io.emit('corrida_cancelada', {
          pedidoId: id,
          canceladoPor,
          taxaCancelamento: taxaCancelamentoAplicada,
          repasseMotorista: repasseEsperaMotorista
        });
      }

      res.json({
        sucesso: true,
        canceladoPor,
        taxaCancelamento: taxaCancelamentoAplicada,
        repasseMotorista: repasseEsperaMotorista,
        mensagem: repasseEsperaMotorista > 0
          ? `Corrida cancelada. Como você aguardou mais de 3 min, R$ ${repasseEsperaMotorista.toFixed(2).replace('.', ',')} foram creditados na sua carteira.`
          : 'Corrida cancelada com sucesso.',
        pedido: atualizado[0]
      });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
    }
  });

  // =========================================================================
  // 10. PREFERÊNCIAS DE PAGAMENTO E ENTREGA DO MOTORISTA
  // =========================================================================
  router.put('/motoristas/preferencias-pagamento', autenticarToken, async (req, res) => {
    try {
      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });

      const { aceita_dinheiro, aceita_cartao, aceita_pix, aceita_entrega } = req.body;

      if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
        return res.status(400).json({ erro: 'Selecione ao menos uma forma de pagamento para trabalhar.' });
      }

      const entregaFinal = typeof aceita_entrega === 'boolean' ? aceita_entrega : Boolean(mot.aceita_entrega);

      const atualizado = await sql`
        UPDATE motoristas
        SET aceita_dinheiro = ${Boolean(aceita_dinheiro)},
            aceita_cartao = ${Boolean(aceita_cartao)},
            aceita_pix = ${Boolean(aceita_pix)},
            aceita_entrega = ${entregaFinal}
        WHERE id::text = ${String(mot.id)}::text
        RETURNING aceita_dinheiro, aceita_cartao, aceita_pix, aceita_entrega;
      `;

      return res.json({
        sucesso: true,
        mensagem: 'Preferências salvas com sucesso!',
        preferencias: atualizado[0] || {}
      });
    } catch (err) {
      return res.status(500).json({ erro: 'Erro ao gravar preferências no banco.' });
    }
  });

  // =========================================================================
  // 11. ALTERNAR STATUS ONLINE / OFFLINE DO MOTORISTA (SÓ APROVADO FICA ONLINE)
  // =========================================================================
  router.put('/motoristas/meu-status-online', autenticarToken, async (req, res) => {
    try {
      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });

      const onlineExplicito = req.body?.online;
      const novoStatus = typeof onlineExplicito === 'boolean' ? onlineExplicito : !mot.status_online;

      if (novoStatus && !motoristaAprovado(mot)) {
        return res.status(403).json({ erro: 'Seu cadastro ainda está em análise. Você poderá ficar online após a aprovação.', online: false });
      }

      await sql`
        UPDATE motoristas
        SET status_online = ${novoStatus}
        WHERE id::text = ${String(mot.id)}::text;
      `;

      return res.json({ sucesso: true, online: novoStatus });
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao alterar status online.' });
    }
  });

  // =========================================================================
  // 12. CONSULTAR PERFIL DO CONDUTOR (SÓ O PRÓPRIO MOTORISTA)
  // =========================================================================
  router.get('/motoristas/perfil', autenticarToken, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) return res.status(404).json({ erro: 'Motorista não localizado.' });

      const tarifasBanco = await lerTarifasDoBanco();
      const niveisConfig = normalizarConfigNiveis(tarifasBanco);
      const nivelAtual = calcularNivelMotorista(mot.total_corridas, mot.avaliacao_media, niveisConfig);
      const taxaAtual = Number(niveisConfig[nivelAtual]?.taxa_huby ?? 15);

      return res.json({
        id: mot.id,
        nome: mot.nome,
        email: mot.email,
        telefone: mot.telefone,
        veiculo_modelo: mot.veiculo_modelo,
        veiculo_placa: mot.veiculo_placa,
        veiculo_cor: mot.veiculo_cor,
        veiculo_ano: mot.veiculo_ano,
        foto_perfil_url: mot.foto_perfil_url,
        avaliacao_media: mot.avaliacao_media,
        total_corridas: mot.total_corridas,
        saldo_carteira: mot.saldo_carteira,
        chave_pix_padrao: mot.chave_pix_padrao,
        categoria: mot.categoria || 'carro',
        status_online: Boolean(mot.status_online),
        status_aprovacao: mot.status_aprovacao || 'pendente',
        aceita_entrega: Boolean(mot.aceita_entrega),
        codigo_voz: mot.codigo_voz || 'Zank',
        aceita_dinheiro: mot.aceita_dinheiro !== false,
        aceita_cartao: mot.aceita_cartao !== false,
        aceita_pix: mot.aceita_pix !== false,
        nivel: nivelAtual,
        taxa_huby_atual: taxaAtual,
        niveis_config: niveisConfig
      });
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao carregar perfil.' });
    }
  });

  // =========================================================================
  // 13. ATUALIZAR PERFIL DO MOTORISTA (SÓ O PRÓPRIO)
  //     Placa, modelo e categoria NÃO mudam pelo app: precisam de nova análise do admin.
  // =========================================================================
  router.put('/motoristas/perfil/atualizar', autenticarToken, async (req, res) => {
    try {
      const mot = await buscarMotoristaDoToken(req.usuario);
      if (!mot) return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });

      const {
        nome, telefone, foto_perfil_url, foto_base64,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
        chave_pix_padrao, codigo_voz, categoria, aceita_entrega
      } = req.body || {};

      // Nome
      const fNome = textoLimpo(nome, 80);
      if (fNome && fNome.length < 2) {
        return res.status(400).json({ erro: 'Nome muito curto.' });
      }

      // Telefone (só números, 10 a 13 dígitos)
      let fTel = null;
      if (telefone !== undefined && String(telefone).trim() !== '') {
        const digitos = String(telefone).replace(/\D/g, '');
        if (digitos.length < 10 || digitos.length > 13) {
          return res.status(400).json({ erro: 'Telefone inválido.' });
        }
        fTel = digitos;
      }

      // Foto: só imagem (base64 jpeg/png/webp) ou link https, com limite de tamanho
      let fFoto = null;
      const fotoBruta = String(foto_perfil_url || foto_base64 || '').trim();
      if (fotoBruta) {
        const ehBase64Imagem = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(fotoBruta);
        const ehLinkHttps = /^https:\/\/[^\s"'<>]{5,500}$/.test(fotoBruta);
        if (!ehBase64Imagem && !ehLinkHttps) {
          return res.status(400).json({ erro: 'Formato de foto inválido.' });
        }
        if (fotoBruta.length > FOTO_MAX_CARACTERES) {
          return res.status(400).json({ erro: 'Foto muito grande. Use uma imagem menor.' });
        }
        fFoto = fotoBruta;
      }

      const fPix = textoLimpo(chave_pix_padrao, 120);
      const fCodVoz = textoLimpo(codigo_voz, 30);
      const fEntrega = typeof aceita_entrega === 'boolean' ? aceita_entrega : null;

      // Placa, modelo, cor, ano e categoria: ignorados aqui (só a equipe HUBy altera)
      const normalizar = (v) => String(v ?? '').trim().toUpperCase();
      const mudou = (enviado, atual) =>
        enviado !== undefined && normalizar(enviado) !== '' && normalizar(enviado) !== normalizar(atual);
      const tentouMudarVeiculo =
        mudou(veiculo_placa, mot.veiculo_placa) ||
        mudou(veiculo_modelo, mot.veiculo_modelo) ||
        mudou(veiculo_cor, mot.veiculo_cor) ||
        mudou(veiculo_ano, mot.veiculo_ano) ||
        mudou(categoria, mot.categoria);
      const atualizado = await sql`
        UPDATE motoristas
        SET
          nome = COALESCE(${fNome}, nome),
          telefone = COALESCE(${fTel}, telefone),
          foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
          chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
          codigo_voz = COALESCE(${fCodVoz}, codigo_voz),
          aceita_entrega = COALESCE(${fEntrega}, aceita_entrega)
        WHERE id::text = ${String(mot.id)}::text
        RETURNING id, nome, telefone, foto_perfil_url, veiculo_modelo, veiculo_placa,
                  veiculo_cor, veiculo_ano, chave_pix_padrao, codigo_voz, categoria, aceita_entrega;
      `;

      if ((fFoto || fNome || fTel) && mot.usuario_id) {
        try {
          await sql`
            UPDATE usuarios
            SET
              nome = COALESCE(${fNome}, nome),
              telefone = COALESCE(${fTel}, telefone),
              foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url)
            WHERE id::text = ${String(mot.usuario_id)}::text;
          `;
        } catch (eUsr) { }
      }

      return res.json({
        sucesso: true,
        motorista: atualizado[0] || {},
        aviso: tentouMudarVeiculo
          ? 'Os dados do veículo (placa, modelo, cor e ano) só podem ser alterados pela equipe HUBy. Fale com o suporte.' : undefined
      });
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao salvar dados do perfil.' });
    }
  });

  // =========================================================================
  // 14. AVALIAR CORRIDA (SÓ O PASSAGEIRO, SÓ CORRIDA CONCLUÍDA, SÓ UMA VEZ)
  // =========================================================================
  router.post('/:id/avaliar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const clienteId = String(req.usuario.id);
      const notaNum = Math.min(5, Math.max(1, parseInt(req.body?.nota, 10) || 5));
      const comentario = String(req.body?.comentario || '').trim().slice(0, 400);
      const etiquetasArr = Array.isArray(req.body?.etiquetas)
        ? req.body.etiquetas.map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 8)
        : [];

      const pedidos = await sql`
        SELECT id, motorista_id, cliente_id, status FROM pedidos
        WHERE id::text = ${String(id)}::text
        LIMIT 1;
      `;
      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Corrida não encontrada.' });
      }

      const pedido = pedidos[0];
      if (String(pedido.cliente_id) !== clienteId) {
        return res.status(403).json({ erro: 'Apenas o passageiro desta corrida pode avaliá-la.' });
      }
      if (String(pedido.status).toLowerCase() !== 'concluido') {
        return res.status(400).json({ erro: 'Apenas corridas concluídas podem ser avaliadas.' });
      }

      const jaAvaliou = await sql`
        SELECT id FROM avaliacoes WHERE pedido_id::text = ${String(id)}::text LIMIT 1;
      `;
      if (jaAvaliou.length > 0) {
        return res.status(409).json({ erro: 'Esta corrida já foi avaliada.' });
      }

      const motoristaId = pedido.motorista_id || null;

      await sql`
        INSERT INTO avaliacoes (pedido_id, cliente_id, motorista_id, nota, comentario, etiquetas)
        VALUES (${String(id)}, ${clienteId}, ${motoristaId}, ${notaNum}, ${comentario}, ${JSON.stringify(etiquetasArr)}::jsonb);
      `;

      if (motoristaId) {
        const atualizado = await sql`
          UPDATE motoristas
          SET total_avaliacoes = COALESCE(total_avaliacoes, 0) + 1,
              avaliacao_media = ROUND(
                ((COALESCE(avaliacao_media, 5.00) * COALESCE(total_avaliacoes, 0)) + ${notaNum})::numeric /
                (COALESCE(total_avaliacoes, 0) + 1),
                2
              )
          WHERE id::text = ${String(motoristaId)}::text
          RETURNING total_corridas, avaliacao_media;
        `;

        if (atualizado.length > 0) {
          const tarifasBanco = await lerTarifasDoBanco();
          const niveisConfig = normalizarConfigNiveis(tarifasBanco);
          const novoNivel = calcularNivelMotorista(
            atualizado[0].total_corridas,
            atualizado[0].avaliacao_media,
            niveisConfig
          );
          await sql`
            UPDATE motoristas
            SET nivel = ${novoNivel}
            WHERE id::text = ${String(motoristaId)}::text;
          `;
        }
      }

      return res.status(201).json({
        sucesso: true,
        nota: notaNum,
        etiquetas: etiquetasArr
      });
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao registrar avaliação.' });
    }
  });

  // =========================================================================
  // 15. BOTÃO SOS (PASSAGEIRO OU MOTORISTA DA CORRIDA)
  // =========================================================================
  router.post('/:id/sos', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT id, cliente_id, motorista_id FROM pedidos
        WHERE id::text = ${String(id)}::text LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Corrida não encontrada.' });

      const mot = await buscarMotoristaDoToken(req.usuario);
      const papel = papelNoPedido(pedidos[0], req.usuario, mot);
      if (!papel) return res.status(403).json({ erro: 'Sem acesso a esta corrida.' });

      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const coordsOk = Number.isFinite(lat) && Number.isFinite(lng);
      const relato = textoLimpo(req.body?.relato, 500)
        || `EMERGÊNCIA ACIONADA pelo ${papel}.`;
      const descricao = coordsOk ? `${relato} | GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)}` : relato;

      const usuarioRegistro = papel === 'motorista' ? String(mot.id) : String(req.usuario.id);

      const alerta = await sql`
        INSERT INTO incidentes_seguranca (pedido_id, usuario_id, tipo_alerta, descricao)
        VALUES (${String(id)}, ${usuarioRegistro}, 'sos', ${descricao})
        RETURNING id;
      `;

      if (io) {
        io.emit('alerta_sos_admin', {
          incidenteId: alerta[0].id,
          pedidoId: id,
          origem: papel,
          coords: coordsOk ? [lat, lng] : null,
          momento: new Date().toISOString()
        });
      }

      res.status(201).json({ sucesso: true, mensagem: 'Alerta SOS registrado e equipe notificada!' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao acionar alerta de segurança.' });
    }
  });

  // =========================================================================
  // 16. REPORTAR INCIDENTE (QUALQUER USUÁRIO LOGADO)
  // =========================================================================
  router.post('/incidentes', autenticarToken, async (req, res) => {
    try {
      const tipo = textoLimpo(req.body?.tipo_alerta, 50) || 'outro';
      const descricao = textoLimpo(req.body?.descricao, 1000);
      if (!descricao) return res.status(400).json({ erro: 'Descreva o ocorrido.' });

      let pedidoIdFinal = null;
      const pedidoInformado = textoLimpo(req.body?.pedido_id, 64);
      const mot = await buscarMotoristaDoToken(req.usuario);

      if (pedidoInformado) {
        const pedidos = await sql`
          SELECT id, cliente_id, motorista_id FROM pedidos
          WHERE id::text = ${pedidoInformado}::text LIMIT 1;
        `;
        if (pedidos.length > 0 && papelNoPedido(pedidos[0], req.usuario, mot)) {
          pedidoIdFinal = pedidos[0].id;
        }
      }

      const usuarioRegistro = mot ? String(mot.id) : String(req.usuario.id);

      const reg = await sql`
        INSERT INTO incidentes_seguranca (pedido_id, usuario_id, tipo_alerta, descricao)
        VALUES (${pedidoIdFinal}, ${usuarioRegistro}, ${tipo}, ${descricao})
        RETURNING id;
      `;

      res.status(201).json({ sucesso: true, id: reg[0].id, mensagem: 'Incidente registrado. A equipe vai analisar.' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao registrar incidente.' });
    }
  });

  return router;
}