import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from './db.js';

import authRoutes from './routes/auth.routes.js';
import usuariosRouter from './routes/usuarios.routes.js';
import pedidosRouter from './routes/pedidos.routes.js';
import adminRoutes from './routes/admin.routes.js';
import carteiraRoutes from './routes/carteira.routes.js';
import dinamicaRoutes from './routes/dinamica.routes.js';
import motoristaRoutes from './routes/motorista.routes.js';
import sociosRoutes from './routes/socios.routes.js';
import marketplaceRouter from './routes/marketplace.routes.js';
import iaRoutes from './routes/ia.routes.js'; // 🤖 IA: Importação da nova rota

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);

// ============================================================================
// 1. SEGURANÇA BÁSICA, CORS (HTTP + SOCKET.IO) E LIMITADOR DE TENTATIVAS
// ============================================================================
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1); // O Render coloca um proxy na frente do servidor

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

  // 🚗 Repasse em tempo real do GPS do motorista para o mapa do passageiro
  socket.on('posicao_motorista', (dados) => {
    socket.broadcast.emit('posicao_motorista_atualizada', dados);
  });

  socket.on('disconnect', () => {
    console.log(`Utilizador desconectado do radar: ${socket.id}`);
  });
});

// Injeta Socket.IO nas requisições
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
// 2. PARSERS DE DADOS (JSON E FOTOS EM BASE64)
// ============================================================================
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: true }));

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

    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_ano TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_cor TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
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
// 4. ROTAS BASE E STATUS
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    status: 'HUBy API Online (Modularizada)',
    versao: '2.0.4',
    banco: 'Neon PostgreSQL'
  });
});

app.get('/api/config/tarifas', async (req, res) => {
  const padrao = {
    taxa_plataforma: 15,
    carro: { base: 6.0, km: 2.2, min: 0.30 },
    moto: { base: 4.0, km: 1.4, min: 0.20 },
    entrega: { base: 5.0, km: 1.8, min: 0.25 }
  };

  let tarifas = padrao;
  try {
    const cfg = await sql`SELECT valor FROM configuracoes_plataforma WHERE chave = 'tarifas' LIMIT 1;`;
    if (cfg[0]?.valor) tarifas = cfg[0].valor;
  } catch (err) {
    console.warn('Tarifas: usando valores padrão.', err.message);
  }

  res.json({
    ...tarifas,
    taxa_plataforma: tarifas.taxa_plataforma ?? 15,
    km_carro: tarifas.carro?.km,
    km_moto: tarifas.moto?.km,
    km_entrega: tarifas.entrega?.km,
    tarifas
  });
});

// ============================================================================
// 5. REGISTRO DE ROTAS MODULARES
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

// ============================================================================
// 6. TRATAMENTO GLOBAL DE ERROS
// ============================================================================
app.use((err, req, res, next) => {
  console.error('Erro interno do servidor:', err);
  const status = err.status || 500;
  res.status(status).json({
    erro: true,
    mensagem: status >= 500 ? 'Erro interno no servidor' : err.message
  });
});

// ============================================================================
// 7. INICIALIZAÇÃO DO SERVIDOR
// ============================================================================
server.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});