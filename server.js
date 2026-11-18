import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import * as Sentry from '@sentry/node';
import { sql, JWT_SECRET } from './db.js';

import authRoutes from './routes/auth.routes.js';
import usuariosRouter from './routes/usuarios.routes.js';
import pedidosRouter, { iniciarDespachanteAgendamentos } from './routes/pedidos.routes.js';
import adminRoutes, { lerTarifasDoBanco } from './routes/admin.routes.js';
import carteiraRoutes from './routes/carteira.routes.js';
import dinamicaRoutes from './routes/dinamica.routes.js';
import motoristaRoutes from './routes/motorista.routes.js';
import sociosRoutes from './routes/socios.routes.js';
import marketplaceRouter from './routes/marketplace.routes.js';
import iaRoutes from './routes/ia.routes.js';
import pushRoutes from './routes/push.routes.js';
import indicacoesRoutes from './routes/indicacoes.routes.js';
import suporteRouter from './routes/suporte.routes.js';

dotenv.config();

// ============================================================================
// 0. MONITOR DE ERROS SENTRY (ATIVADO AUTOMATICAMENTE SE SENTRY_DSN EXISTIR)
// ============================================================================
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

// ============================================================================
// 1. SEGURANÇA BÁSICA, CORS (HTTP + SOCKET.IO) E LIMITADOR DE TENTATIVAS
// ============================================================================
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

io.on('connection', (socket) => {
  console.log(`Novo utilizador conectado ao radar (Socket.IO): ${socket.id}`);

  socket.on('posicao_motorista', (dados) => {
    socket.broadcast.emit('posicao_motorista_atualizada', dados);
  });

  // Relays instantâneos entre Motorista 3D e Passageiro
  socket.on('motorista_aceitou', (dados) => {
    socket.broadcast.emit('corrida_aceita', dados);
  });

  socket.on('motorista_chegou', (dados) => {
    socket.broadcast.emit('motorista_chegou_local', dados);
  });

  socket.on('corrida_iniciada', (dados) => {
    socket.broadcast.emit('passageiro_a_bordo', dados);
  });

  socket.on('corrida_finalizada_motorista', (dados) => {
    socket.broadcast.emit('corrida_finalizada', dados);
  });

  socket.on('corrida_cancelada_motorista', (dados) => {
    socket.broadcast.emit('corrida_cancelada', { ...dados, canceladoPor: 'motorista' });
  });

  socket.on('disconnect', () => {
    console.log(`Utilizador desconectado do radar: ${socket.id}`);
  });
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

// ============================================================================
// 2. PARSERS DE DADOS (JSON E BANNERS DA GALERIA EM BASE64)
// ============================================================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================================================
// 3. SINCRONIZAÇÃO DAS TABELAS NO NEON POSTGRESQL
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
        status TEXT DEFAULT 'pendente',
        motivo_cancelamento TEXT,
        cancelado_por TEXT,
        embarque_em TIMESTAMP,
        concluido_em TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // TABELA DE PATROCINADORES E BANNERS PUBLICITÁRIOS (CONTROLO TOTAL DO ADMIN)
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
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS em_pausa BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS pausa_ate TIMESTAMP;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lat NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_lng NUMERIC;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS destino_casa_ativo BOOLEAN DEFAULT FALSE;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS embarque_em TIMESTAMP;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMP;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;

    console.log('✅ Banco de dados Neon PostgreSQL sincronizado com sucesso.');
  } catch (e) {
    console.error('Erro na sincronização de tabelas:', e.message);
  }
}
inicializarBanco();

// ============================================================================
// 4. ROTAS BASE, TARIFAS E PUBLICIDADE DE PATROCINADORES
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    status: 'HUBy API Online (Modularizada)',
    versao: '2.4.0',
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

// Middleware de validação Admin para rotas de patrocinadores
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

// 4.1. Rota pública para o passageiro carregar banners ativos (Pop-up e Vitrine)
app.get('/api/patrocinadores/ativos', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const lista = await sql`
      SELECT id, nome_empresa, titulo_oferta, categoria, descricao, cupom_codigo,
             whatsapp_link, imagem_base64, exibir_popup, prioridade
      FROM patrocinadores_banners
      WHERE ativo = TRUE
      ORDER BY prioridade DESC, id DESC;
    `;
    res.json(lista);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar patrocinadores.' });
  }
});

// 4.2. Registo de visualizações e cliques em tempo real
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

// 4.3. Rotas do Administrador Master (Listar tudo, Publicar da Galeria, Alternar Popup/Status e Excluir)
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
// 5. REGISTO DE ROTAS MODULARES
// ============================================================================
app.use(['/api/auth/login', '/api/auth/login-motorista', '/api/usuarios/login', '/api/usuarios/login-motorista'], limitarLogin);
app.use(['/api/auth/cadastro', '/api/usuarios/registo'], limitarCadastro);

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRouter || authRoutes);
app.use('/api/pedidos', pedidosRouter(io));
app.use('/api/admin', typeof adminRoutes === 'function' ? adminRoutes(io) : adminRoutes);
app.use('/api/carteira', carteiraRoutes);
app.use('/api/dinamica', dinamicaRoutes);
app.use('/api/motoristas', motoristaRoutes);
app.use('/api/motoristas-regras', motoristaRoutes);
app.use('/api/socios', sociosRoutes);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/ia', iaRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/indicacoes', indicacoesRoutes);
app.use('/api/suporte', suporteRouter);

iniciarDespachanteAgendamentos(io);

// ============================================================================
// 6. CAPTURA GLOBAL DE ERROS (SENTRY + LOG NO BANCO NEON)
// ============================================================================
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
  } catch (eLog) {}

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

// ============================================================================
// 7. INICIALIZAÇÃO DO SERVIDOR
// ============================================================================
server.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});