import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { sql, JWT_SECRET } from './db.js';
import { salaUsuario, salaMotorista, SALA_MOTORISTAS } from './services/salas-socket.js';

import authRoutes from './routes/auth.routes.js';
import pedidosRouter, { iniciarDespachanteAgendamentos } from './routes/pedidos.routes.js';
import adminRoutes, { lerTarifasDoBanco, extrairObjetoJSONB } from './routes/admin.routes.js';
import carteiraRoutes from './routes/carteira.routes.js';
import dinamicaRoutes from './routes/dinamica.routes.js';
import motoristaRoutes from './routes/motorista.routes.js';
import marketplaceRouter from './routes/marketplace.routes.js';
import pushRoutes from './routes/push.routes.js';
import indicacoesRoutes from './routes/indicacoes.routes.js';
import suporteRouter from './routes/suporte.routes.js';

dotenv.config();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.2
  });
  console.log('🛡️ Monitor de erros Sentry conectado e ativo.');
}

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

const origensPermitidas = new Set([
  'https://hubymovi-01.github.io',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ...(EM_PRODUCAO ? [] : [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500',
    'http://localhost:8080'
  ])
]);

const checarOrigem = (origin, callback) => {
  if (!origin || origensPermitidas.has(origin)) return callback(null, true);
  console.warn(`CORS: origem bloqueada: ${origin}`);
  return callback(null, false);
};

const corsOpcoes = {
  origin: checarOrigem,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true
};

const io = new Server(server, { cors: corsOpcoes });
app.set('io', io);

const SOCKET_EXIGE_LOGIN = process.env.SOCKET_EXIGE_LOGIN === 'true';

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (token) {
    try {
      socket.data.usuario = jwt.verify(String(token), JWT_SECRET);
    } catch (err) {
      return next(new Error('Sessão inválida.'));
    }
  } else if (SOCKET_EXIGE_LOGIN) {
    return next(new Error('Login necessário.'));
  }

  next();
});

// ============================================================================
// SOCKET: SALAS POR CORRIDA (só passageiro, motorista da corrida e admin recebem o GPS)
// ============================================================================
const SALA_ADMINS = 'admins';
const salaCorrida = (pedidoId) => `corrida:${pedidoId}`;
const STATUS_RASTREAVEIS = [
  'aceito', 'a_caminho', 'chegou_local', 'aguardando_passageiro',
  'no_local', 'motorista_no_local', 'em_andamento', 'em_viagem'
];
const INTERVALO_MIN_GPS_MS = 700;
const cacheCorridas = new Map();
const ultimaPosicaoPorCorrida = new Map();

// Limpa posições antigas a cada 5 minutos
setInterval(() => {
  const limite = Date.now() - 10 * 60 * 1000;
  for (const [id, reg] of ultimaPosicaoPorCorrida) {
    if (reg.em < limite) ultimaPosicaoPorCorrida.delete(id);
  }
}, 5 * 60 * 1000).unref();

function ehAdminSocket(usuario) {
  const role = String(usuario?.role || usuario?.funcao || '').toLowerCase();
  return role === 'admin' || role === 'administrador';
}

// Descobre (uma vez por conexão) qual motorista está neste socket
async function motoristaIdDoSocket(socket) {
  if (socket.data.motoristaId !== undefined) return socket.data.motoristaId;
  const usuario = socket.data.usuario;
  if (!usuario || String(usuario.role || '').toLowerCase() !== 'motorista') {
    socket.data.motoristaId = null;
    return null;
  }
  const ids = [usuario.id, usuario.motoristaId]
    .filter((v) => v !== undefined && v !== null && String(v).trim() !== '')
    .map(String);
  if (!ids.length) {
    socket.data.motoristaId = null;
    return null;
  }
  try {
    const rows = await sql`
      SELECT id FROM motoristas
      WHERE id::text = ANY(${ids}) OR usuario_id::text = ANY(${ids})
      LIMIT 1;
    `;
    socket.data.motoristaId = rows[0]?.id ? String(rows[0].id) : null;
  } catch (e) {
    return null;
  }
  return socket.data.motoristaId;
}

// Dono e status da corrida (guardado por 15 segundos para não pesar o banco)
async function dadosDaCorrida(pedidoIdBruto) {
  const pedidoId = String(pedidoIdBruto ?? '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(pedidoId)) return null;

  const emCache = cacheCorridas.get(pedidoId);
  if (emCache && Date.now() - emCache.em < 15000) return emCache;

  const rows = await sql`
    SELECT id, cliente_id, motorista_id, status
    FROM pedidos
    WHERE id::text = ${pedidoId}
    LIMIT 1;
  `;
  if (!rows.length) {
    cacheCorridas.delete(pedidoId);
    return null;
  }

  const dados = {
    id: String(rows[0].id),
    clienteId: rows[0].cliente_id ? String(rows[0].cliente_id) : null,
    motoristaId: rows[0].motorista_id ? String(rows[0].motorista_id) : null,
    status: String(rows[0].status || '').toLowerCase(),
    em: Date.now()
  };
  cacheCorridas.set(pedidoId, dados);
  if (cacheCorridas.size > 2000) cacheCorridas.clear();
  return dados;
}

// Ao conectar, cada um entra nas suas salas: admins, motoristas, a sua própria
// e a da corrida que estiver em andamento (assim um app reaberto continua recebendo tudo).
const STATUS_CORRIDA_ABERTA = [
  'pendente', 'aguardando', 'buscando', 'criado', 'agendado',
  ...STATUS_RASTREAVEIS
];

async function entrarNasSalasIniciais(socket) {
  const usuario = socket.data.usuario;
  if (!usuario) return; // sem login: só recebe avisos públicos (tarifas, banners)

  if (ehAdminSocket(usuario)) socket.join(SALA_ADMINS);
  if (usuario.id !== undefined && usuario.id !== null) socket.join(salaUsuario(String(usuario.id)));

  try {
    const motoristaId = await motoristaIdDoSocket(socket);
    if (motoristaId) {
      socket.join(SALA_MOTORISTAS);
      socket.join(salaMotorista(motoristaId));
    }

    const corridas = await sql`
      SELECT id FROM pedidos
      WHERE LOWER(status) = ANY(${STATUS_CORRIDA_ABERTA})
        AND (
          cliente_id::text = ${String(usuario.id ?? '')}
          OR (${motoristaId || ''} <> '' AND motorista_id::text = ${motoristaId || ''})
        )
        AND criado_em > NOW() - INTERVAL '2 days'
      ORDER BY criado_em DESC
      LIMIT 3;
    `;
    corridas.forEach((c) => socket.join(salaCorrida(String(c.id))));
  } catch (err) {
    // Se o banco falhar aqui, o app ainda recebe tudo pelo "entrar_corrida" e pelas consultas de status
  }
}

io.on('connection', (socket) => {
  entrarNasSalasIniciais(socket);

  // Passageiro ou motorista pede para acompanhar UMA corrida (o servidor confere se é dele)
  socket.on('entrar_corrida', async (dados, ack) => {
    const responder = typeof ack === 'function' ? ack : () => {};
    try {
      const usuario = socket.data.usuario;
      if (!usuario) return responder({ ok: false, erro: 'Login necessário.' });

      const pedidoId = (dados && typeof dados === 'object') ? dados.pedidoId : dados;
      const corrida = await dadosDaCorrida(pedidoId);
      if (!corrida) return responder({ ok: false, erro: 'Corrida não encontrada.' });

      const motoristaId = await motoristaIdDoSocket(socket);
      const permitido =
        ehAdminSocket(usuario) ||
        (corrida.clienteId && corrida.clienteId === String(usuario.id)) ||
        (motoristaId && corrida.motoristaId === motoristaId);

      if (!permitido) return responder({ ok: false, erro: 'Sem acesso a esta corrida.' });

      // Uma corrida por vez: sai das salas de corridas anteriores
      for (const sala of socket.rooms) {
        if (sala.startsWith('corrida:') && sala !== salaCorrida(corrida.id)) socket.leave(sala);
      }
      socket.join(salaCorrida(corrida.id));
      responder({ ok: true, status: corrida.status });

      // Quem entra agora já recebe a última posição conhecida do carro
      const ultima = ultimaPosicaoPorCorrida.get(corrida.id);
      if (ultima && Date.now() - ultima.em < 2 * 60 * 1000) {
        socket.emit('posicao_corrida', ultima.dados);
      }
    } catch (err) {
      responder({ ok: false, erro: 'Falha ao entrar na corrida.' });
    }
  });

  socket.on('sair_corrida', (dados) => {
    const pedidoId = (dados && typeof dados === 'object') ? dados.pedidoId : dados;
    if (pedidoId) socket.leave(salaCorrida(String(pedidoId)));
  });

  // GPS do motorista: só é aceito de um motorista logado, e só vai para quem pode ver
  socket.on('posicao_motorista', async (dados) => {
    try {
      const motoristaId = await motoristaIdDoSocket(socket);
      if (!motoristaId) return;

      const agora = Date.now();
      if (socket.data.ultimoGps && agora - socket.data.ultimoGps < INTERVALO_MIN_GPS_MS) return;
      socket.data.ultimoGps = agora;

      const lat = Number(dados?.lat);
      const lng = Number(dados?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      if (lat === 0 && lng === 0) return;

      const headingBruto = Number(dados?.heading);
      const velocidade = Number(dados?.velocidadeKmh);

      const pacote = {
        motoristaId,
        lat,
        lng,
        heading: Number.isFinite(headingBruto) ? ((headingBruto % 360) + 360) % 360 : 0,
        velocidadeKmh: Number.isFinite(velocidade) && velocidade >= 0 ? Math.min(velocidade, 250) : 0,
        emCorrida: Boolean(dados?.pedidoId),
        atualizadoEm: new Date(agora).toISOString()
      };

      // Radar do painel admin
      io.to(SALA_ADMINS).emit('posicao_motorista', pacote);

      // Passageiro da corrida (somente se este motorista for mesmo o da corrida)
      if (dados?.pedidoId) {
        const corrida = await dadosDaCorrida(dados.pedidoId);
        if (corrida && corrida.motoristaId === motoristaId && STATUS_RASTREAVEIS.includes(corrida.status)) {
          const paraPassageiro = { ...pacote, pedidoId: corrida.id, status: corrida.status };
          ultimaPosicaoPorCorrida.set(corrida.id, { dados: paraPassageiro, em: agora });
          io.to(salaCorrida(corrida.id)).emit('posicao_corrida', paraPassageiro);
        }
      }
    } catch (err) {
      // GPS perdido não derruba nada
    }
  });

  // "Cheguei": só o motorista da corrida consegue avisar o passageiro
  socket.on('motorista_chegou', async (dados) => {
    try {
      const motoristaId = await motoristaIdDoSocket(socket);
      if (!motoristaId) return;
      const corrida = await dadosDaCorrida(dados?.pedidoId);
      if (corrida && corrida.motoristaId === motoristaId) {
        io.to(salaCorrida(corrida.id)).emit('motorista_chegou_local', { pedidoId: corrida.id });
      }
    } catch (err) {}
  });
  // Aceite, embarque, finalização e cancelamento só saem do servidor, pelas rotas oficiais.
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors(corsOpcoes));

function criarLimitador({ janelaMs, max, mensagem }) {
  const acessos = new Map();

  setInterval(() => {
    const agora = Date.now();
    for (const [chave, reg] of acessos) {
      if (reg.reinicia <= agora) acessos.delete(chave);
    }
  }, janelaMs).unref();

  return (req, res, next) => {
    if (req.method !== 'POST') return next();

    const agora = Date.now();
    let reg = acessos.get(req.ip);
    if (!reg || reg.reinicia <= agora) {
      reg = { n: 0, reinicia: agora + janelaMs };
      acessos.set(req.ip, reg);
    }

    reg.n += 1;
    if (reg.n > max) {
      res.setHeader('Retry-After', Math.ceil((reg.reinicia - agora) / 1000));
      return res.status(429).json({ erro: mensagem });
    }
    next();
  };
}

const limitarLogin = criarLimitador({
  janelaMs: 15 * 60 * 1000,
  max: 20,
  mensagem: 'Muitas tentativas de login. Tente novamente em alguns minutos.'
});

const limitarCadastro = criarLimitador({
  janelaMs: 60 * 60 * 1000,
  max: 10,
  mensagem: 'Muitos cadastros feitos deste dispositivo. Tente novamente mais tarde.'
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================================================
// SINCRONIZAÇÃO DAS TABELAS NO NEON POSTGRESQL
// ============================================================================
async function inicializarBanco() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE,
        telefone TEXT UNIQUE,
        cpf TEXT UNIQUE,
        data_nascimento DATE,
        contato_emergencia_nome TEXT,
        contato_emergencia_tel TEXT,
        foto_perfil_url TEXT,
        senha_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'cliente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS motoristas (
        id TEXT PRIMARY KEY,
        usuario_id TEXT,
        nome TEXT NOT NULL,
        email TEXT UNIQUE,
        telefone TEXT UNIQUE,
        cpf TEXT UNIQUE,
        data_nascimento DATE,
        senha_hash TEXT,
        cnh_numero TEXT,
        categoria TEXT DEFAULT 'carro',
        veiculo_modelo TEXT,
        veiculo_placa TEXT,
        veiculo_cor TEXT,
        veiculo_ano TEXT,
        saldo_carteira NUMERIC(10,2) DEFAULT 0.00,
        status_online BOOLEAN DEFAULT FALSE,
        status_aprovacao TEXT DEFAULT 'aprovado',
        motivo_recusa TEXT,
        doc_cnh_url TEXT,
        doc_crlv_url TEXT,
        foto_perfil_url TEXT,
        chave_pix_padrao TEXT,
        codigo_voz TEXT DEFAULT 'Zank',
        avaliacao_media NUMERIC(3,2) DEFAULT 5.00,
        total_avaliacoes INT DEFAULT 0,
        total_corridas INT DEFAULT 0,
        nivel TEXT DEFAULT 'bronze',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS pedidos (
        id TEXT PRIMARY KEY,
        cliente_id TEXT,
        motorista_id TEXT,
        motorista_nome TEXT,
        motorista_telefone TEXT,
        motorista_veiculo TEXT,
        motorista_placa TEXT,
        tipo TEXT,
        sub_tipo_id TEXT,
        sub_tipo_label TEXT,
        origem_endereco TEXT,
        destino_endereco TEXT,
        origem_lat NUMERIC,
        origem_lng NUMERIC,
        destino_lat NUMERIC,
        destino_lng NUMERIC,
        distancia_km NUMERIC,
        duracao_min NUMERIC,
        valor_total NUMERIC(10,2),
        valor_adicionais NUMERIC(10,2) DEFAULT 0.00,
        metodo_pgto TEXT,
        observacao TEXT,
        cupom_codigo VARCHAR(40),
        paradas JSONB DEFAULT '[]'::jsonb,
        agendado_para TIMESTAMP WITH TIME ZONE,
        status TEXT DEFAULT 'pendente',
        motivo_cancelamento TEXT,
        cancelado_por TEXT,
        embarque_em TIMESTAMP,
        concluido_em TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS demandas_nao_atendidas (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT,
        bairro TEXT NOT NULL DEFAULT 'Centro / Não informado',
        cidade TEXT,
        origem_endereco TEXT,
        destino_endereco TEXT,
        lat NUMERIC,
        lng NUMERIC,
        dia_semana INT,
        hora_dia INT,
        faixa_horario TEXT,
        motivo TEXT DEFAULT 'sem_aceite',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT NOT NULL,
        cliente_id TEXT,
        motorista_id TEXT,
        nota INT NOT NULL,
        comentario TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS mensagens_chat (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT NOT NULL,
        remetente_id TEXT NOT NULL,
        remetente_nome TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        enviado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS configuracoes_plataforma (
        chave TEXT PRIMARY KEY,
        valor JSONB NOT NULL,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS saques_motoristas (
        id SERIAL PRIMARY KEY,
        motorista_id TEXT NOT NULL,
        motorista_nome TEXT,
        chave_pix TEXT NOT NULL,
        tipo_chave TEXT DEFAULT 'cpf',
        valor NUMERIC(10,2) NOT NULL,
        status TEXT DEFAULT 'pendente',
        comprovante_url TEXT,
        motivo_recusa TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        solicitado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        pago_em TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS cupons_desconto (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(30) UNIQUE NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'fixo',
        valor NUMERIC(10, 2) NOT NULL,
        limite_usos INTEGER DEFAULT 100,
        usos_atuais INTEGER DEFAULT 0,
        expira_em TIMESTAMP WITH TIME ZONE,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS notificacoes_globais (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(120) NOT NULL,
        mensagem TEXT NOT NULL,
        publico VARCHAR(20) NOT NULL DEFAULT 'todos',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS incidentes_seguranca (
        id SERIAL PRIMARY KEY,
        pedido_id VARCHAR(50),
        usuario_id TEXT,
        tipo_alerta VARCHAR(50) NOT NULL,
        descricao TEXT,
        resolvido BOOLEAN DEFAULT FALSE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS zonas_risco (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        nivel_risco VARCHAR(20) DEFAULT 'alto',
        raio_metros INT DEFAULT 500,
        lat NUMERIC NOT NULL,
        lng NUMERIC NOT NULL,
        horario_inicio TIME DEFAULT '20:00:00',
        horario_fim TIME DEFAULT '05:00:00',
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS logs_erros_sistema (
        id SERIAL PRIMARY KEY,
        origem VARCHAR(40) DEFAULT 'backend',
        rota VARCHAR(150),
        mensagem TEXT NOT NULL,
        stack TEXT,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS patrocinadores_banners (
        id SERIAL PRIMARY KEY,
        nome_empresa TEXT NOT NULL,
        titulo_oferta TEXT NOT NULL,
        categoria TEXT DEFAULT 'destaque',
        descricao TEXT,
        cupom_codigo TEXT,
        whatsapp_link TEXT,
        imagem_base64 TEXT NOT NULL,
        exibir_popup BOOLEAN DEFAULT TRUE,
        prioridade INT DEFAULT 1,
        ativo BOOLEAN DEFAULT TRUE,
        visualizacoes INT DEFAULT 0,
        cliques INT DEFAULT 0,
        plano TEXT,
        valor_pago NUMERIC(10,2) DEFAULT 0.00,
        pix_txid TEXT,
        expira_em TIMESTAMP WITH TIME ZONE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_ano TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_cor TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS codigo_voz TEXT DEFAULT 'Zank';`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS total_corridas INT DEFAULT 0;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS nivel TEXT DEFAULT 'bronze';`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS em_pausa BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS pausa_ate TIMESTAMP;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lat NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lng NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_ativo BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS embarque_em TIMESTAMP;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMP;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS observacao TEXT;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cupom_codigo VARCHAR(40);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paradas JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;
    await sql`ALTER TABLE patrocinadores_banners ADD COLUMN IF NOT EXISTS plano TEXT;`;
    await sql`ALTER TABLE patrocinadores_banners ADD COLUMN IF NOT EXISTS valor_pago NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE patrocinadores_banners ADD COLUMN IF NOT EXISTS pix_txid TEXT;`;
    await sql`ALTER TABLE patrocinadores_banners ADD COLUMN IF NOT EXISTS expira_em TIMESTAMP WITH TIME ZONE;`;

    console.log('✅ Banco de dados Neon PostgreSQL sincronizado com sucesso.');
  } catch (e) {
    console.error('Erro na sincronização de tabelas:', e.message);
  }
}
inicializarBanco();

// ============================================================================
// ROTAS BASE, TARIFAS E PUBLICIDADE DE PATROCINADORES
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    status: 'HUBy API Online (Conta Corporativa)',
    versao: '2.5.0',
    sentryAtivo: Boolean(process.env.SENTRY_DSN),
    banco: 'Neon PostgreSQL'
  });
});

app.get('/api/config/tarifas', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const tarifas = await lerTarifasDoBanco();

  res.json({
    ...tarifas,
    taxa_plataforma: tarifas.taxa_plataforma ?? 15,
    km_carro: tarifas.carro?.km,
    km_moto: tarifas.moto?.km,
    km_entrega: tarifas.entrega?.km,
    tarifas
  });
});

function autenticarAdminLocal(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ erro: 'Token não fornecido.' });
  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const role = String(decoded.role || decoded.funcao || '').toLowerCase();
    if (role !== 'admin' && role !== 'administrador') {
      return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
    }
    req.usuario = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  }
}

async function obterTokenMercadoPagoBackend() {
  if (process.env.MP_ACCESS_TOKEN) return process.env.MP_ACCESS_TOKEN;
  try {
    const rows = await sql`
      SELECT valor::text AS valor_txt FROM configuracoes_plataforma
      WHERE chave = 'gateway_mercadopago' LIMIT 1;
    `;
    const gw = extrairObjetoJSONB(rows[0]?.valor_txt, {});
    return gw.access_token || '';
  } catch (e) {
    return '';
  }
}

app.get('/api/patrocinadores/ativos', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const lista = await sql`
      SELECT id, nome_empresa, titulo_oferta, categoria, descricao, cupom_codigo,
             whatsapp_link, imagem_base64, exibir_popup, prioridade
      FROM patrocinadores_banners
      WHERE ativo = TRUE
        AND (expira_em IS NULL OR expira_em > CURRENT_TIMESTAMP)
      ORDER BY prioridade DESC, id DESC;
    `;
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar patrocinadores.' });
  }
});

// Portal externo (anuncie.html): cria banner pendente e gera PIX no Mercado Pago
app.post('/api/patrocinadores/checkout-pix', async (req, res) => {
  try {
    const {
      plano = 'mensal_vip',
      nome_empresa,
      titulo_oferta,
      categoria = 'destaque',
      descricao = '',
      cupom_codigo = '',
      whatsapp_link = '',
      imagem_base64
    } = req.body || {};

    if (!nome_empresa || !titulo_oferta || !imagem_base64) {
      return res.status(400).json({ erro: 'Preencha o nome da empresa, o título da oferta e a arte do banner.' });
    }

    const ehVip = String(plano).toLowerCase() === 'mensal_vip';
    const valorPlano = ehVip ? 150.00 : 90.00;
    const exibirPopup = ehVip;
    const prioridade = ehVip ? 10 : 5;

    const [criado] = await sql`
      INSERT INTO patrocinadores_banners (
        nome_empresa, titulo_oferta, categoria, descricao, cupom_codigo,
        whatsapp_link, imagem_base64, exibir_popup, prioridade, ativo,
        plano, valor_pago
      ) VALUES (
        ${String(nome_empresa).trim()},
        ${String(titulo_oferta).trim()},
        ${String(categoria).trim()},
        ${String(descricao).trim()},
        ${String(cupom_codigo).trim().toUpperCase()},
        ${String(whatsapp_link).trim()},
        ${imagem_base64},
        ${exibirPopup},
        ${prioridade},
        FALSE,
        ${ehVip ? 'mensal_vip' : 'mensal_vitrine'},
        ${valorPlano}
      )
      RETURNING id;
    `;

    const bannerId = criado.id;
    const referenciaBanner = `banner_${bannerId}`;

    const accessToken = await obterTokenMercadoPagoBackend();
    if (!accessToken) {
      return res.status(500).json({ erro: 'Gateway PIX não configurado no servidor.' });
    }

    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);
    const notificationUrl = `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`;

    const mpRes = await payment.create({
      body: {
        transaction_amount: valorPlano,
        description: `HUBy Parceiros - ${String(nome_empresa).trim()} (#${referenciaBanner})`,
        external_reference: referenciaBanner,
        payment_method_id: 'pix',
        notification_url: notificationUrl,
        payer: {
          email: 'parceiros@huby.app.br',
          first_name: String(nome_empresa).trim().slice(0, 40),
          last_name: 'HUBy'
        }
      }
    });

    const pixInfo = mpRes.point_of_interaction?.transaction_data;
    const txid = String(mpRes.id);

    if (!pixInfo?.qr_code) {
      return res.status(500).json({ erro: 'Não foi possível gerar o código PIX.' });
    }

    await sql`UPDATE patrocinadores_banners SET pix_txid = ${txid} WHERE id = ${bannerId};`;

    try {
      await sql`
        INSERT INTO cobrancas_pix (txid, transacao_id, pedido_id, valor, status, pix_copia_cola, qr_code, qr_code_base64)
        VALUES (${txid}, ${txid}, ${referenciaBanner}, ${valorPlano}, 'pendente', ${pixInfo.qr_code}, ${pixInfo.qr_code}, ${pixInfo.qr_code_base64});
      `;
    } catch (ePix) { }

    return res.json({
      sucesso: true,
      banner_id: bannerId,
      txid,
      valor: valorPlano,
      qr_code: pixInfo.qr_code,
      qr_code_base64: pixInfo.qr_code_base64
    });
  } catch (err) {
    console.error('Erro em POST /api/patrocinadores/checkout-pix:', err);
    return res.status(500).json({ erro: 'Falha ao gerar PIX para o anúncio.' });
  }
});

// Consulta de status do banner no portal anuncie.html
app.get('/api/patrocinadores/status/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ erro: 'ID inválido.' });
    }

    const rows = await sql`
      SELECT id, ativo, pix_txid, valor_pago, expira_em
      FROM patrocinadores_banners
      WHERE id = ${id}
      LIMIT 1;
    `;
    if (!rows.length) return res.status(404).json({ erro: 'Banner não encontrado.' });

    const banner = rows[0];
    if (!banner.ativo && banner.pix_txid) {
      const accessToken = await obterTokenMercadoPagoBackend();
      if (accessToken) {
        try {
          const client = new MercadoPagoConfig({ accessToken });
          const payment = new Payment(client);
          const info = await payment.get({ id: String(banner.pix_txid) });
          if (info?.status === 'approved') {
            const [ativado] = await sql`
              UPDATE patrocinadores_banners
              SET ativo = TRUE,
                  expira_em = COALESCE(expira_em, CURRENT_TIMESTAMP + INTERVAL '30 days')
              WHERE id = ${id}
              RETURNING id, ativo, pix_txid, valor_pago, expira_em;
            `;
            io.emit('patrocinadores_atualizados', { bannerId: id, ativo: true });
            return res.json(ativado || banner);
          }
        } catch (eMp) { }
      }
    }

    return res.json(banner);
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao verificar status do banner.' });
  }
});

app.post('/api/patrocinadores/:id/interacao', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tipo = req.body?.tipo === 'clique' ? 'clique' : 'view';
    if (tipo === 'clique') {
      await sql`UPDATE patrocinadores_banners SET cliques = COALESCE(cliques, 0) + 1 WHERE id = ${id};`;
    } else {
      await sql`UPDATE patrocinadores_banners SET visualizacoes = COALESCE(visualizacoes, 0) + 1 WHERE id = ${id};`;
    }
    res.json({ sucesso: true });
  } catch (err) {
    res.json({ sucesso: false });
  }
});

app.get('/api/patrocinadores/admin', autenticarAdminLocal, async (req, res) => {
  try {
    const lista = await sql`
      SELECT * FROM patrocinadores_banners
      ORDER BY ativo DESC, prioridade DESC, id DESC;
    `;
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao listar patrocinadores no painel.' });
  }
});

app.post('/api/patrocinadores/admin', autenticarAdminLocal, async (req, res) => {
  try {
    const {
      nome_empresa,
      titulo_oferta,
      categoria = 'destaque',
      descricao = '',
      cupom_codigo = '',
      whatsapp_link = '',
      imagem_base64,
      exibir_popup = true,
      prioridade = 1
    } = req.body || {};

    if (!nome_empresa || !titulo_oferta || !imagem_base64) {
      return res.status(400).json({ erro: 'Envie o nome da empresa, título e a imagem do banner da galeria.' });
    }

    const [novo] = await sql`
      INSERT INTO patrocinadores_banners (
        nome_empresa, titulo_oferta, categoria, descricao, cupom_codigo,
        whatsapp_link, imagem_base64, exibir_popup, prioridade, ativo
      ) VALUES (
        ${String(nome_empresa).trim()},
        ${String(titulo_oferta).trim()},
        ${String(categoria).trim()},
        ${String(descricao).trim()},
        ${String(cupom_codigo).trim().toUpperCase()},
        ${String(whatsapp_link).trim()},
        ${imagem_base64},
        ${Boolean(exibir_popup)},
        ${Number(prioridade) || 1},
        TRUE
      )
      RETURNING *;
    `;

    io.emit('patrocinadores_atualizados');
    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao publicar banner do patrocinador.' });
  }
});

app.put('/api/patrocinadores/admin/:id/toggle-ativo', autenticarAdminLocal, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [atualizado] = await sql`
      UPDATE patrocinadores_banners
      SET ativo = NOT ativo
      WHERE id = ${id}
      RETURNING id, ativo;
    `;
    io.emit('patrocinadores_atualizados');
    res.json(atualizado);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao alterar status do banner.' });
  }
});

app.put('/api/patrocinadores/admin/:id/toggle-popup', autenticarAdminLocal, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [atualizado] = await sql`
      UPDATE patrocinadores_banners
      SET exibir_popup = NOT exibir_popup
      WHERE id = ${id}
      RETURNING id, exibir_popup;
    `;
    io.emit('patrocinadores_atualizados');
    res.json(atualizado);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao alterar destaque no Pop-up.' });
  }
});

app.delete('/api/patrocinadores/admin/:id', autenticarAdminLocal, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await sql`DELETE FROM patrocinadores_banners WHERE id = ${id};`;
    io.emit('patrocinadores_atualizados');
    res.json({ sucesso: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover patrocinador.' });
  }
});

// ============================================================================
// REGISTO DE ROTAS MODULARES (SEM DIVISÃO DE SÓCIOS)
// ============================================================================
app.use([
  '/api/auth/login', '/api/auth/login-motorista', '/api/usuarios/login', '/api/usuarios/login-motorista',
   '/api/auth/esqueci-senha', '/api/auth/redefinir-senha', '/api/usuarios/esqueci-senha', '/api/usuarios/redefinir-senha',
  '/api/auth/excluir-conta', '/api/usuarios/excluir-conta'
], limitarLogin);

app.use([
  '/api/auth/cadastro', '/api/auth/registo', '/api/usuarios/cadastro', '/api/usuarios/registo',
  '/api/auth/enviar-codigo', '/api/auth/verificar-codigo', '/api/usuarios/enviar-codigo', '/api/usuarios/verificar-codigo'
], limitarCadastro);
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', authRoutes); // nome antigo: aponta para as mesmas rotas seguras
app.use('/api/pedidos', pedidosRouter(io));
app.use('/api/admin', typeof adminRoutes === 'function' ? adminRoutes(io) : adminRoutes);
app.use('/api/carteira', carteiraRoutes);
app.use('/api/dinamica', dinamicaRoutes);
app.use('/api/motoristas', motoristaRoutes);
app.use('/api/motoristas-regras', motoristaRoutes);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/push', pushRoutes);
app.use('/api/indicacoes', indicacoesRoutes);
app.use('/api/suporte', suporteRouter);

// IA temporariamente pausada para estabilização do lançamento
app.all('/api/ia{/*path}', (req, res) => {
  res.status(503).json({
    ativo: false,
    erro: 'Assistente de IA temporariamente pausado para estabilização do aplicativo.'
  });
});

iniciarDespachanteAgendamentos(io);

if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(async (err, req, res, next) => {
  console.error('Erro interno do servidor:', err);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  try {
    await sql`
      INSERT INTO logs_erros_sistema (origem, rota, mensagem, stack)
      VALUES ('backend', ${String(req.originalUrl || '').slice(0, 140)}, ${String(err.message || 'Erro desconhecido').slice(0, 500)}, ${String(err.stack || '').slice(0, 2000)});
    `;
  } catch (eLog) { }

  const status = err.status || 500;
  res.status(status).json({
    erro: true,
    mensagem: status >= 500 ? 'Erro interno no servidor' : err.message
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  if (process.env.SENTRY_DSN) Sentry.captureException(reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
});

server.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});