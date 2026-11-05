import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { sql, JWT_SECRET } from './db.js';

import authRoutes from './routes/auth.routes.js';
import pedidosRouter from './routes/pedidos.routes.js';
import adminRoutes from './routes/admin.routes.js';
import carteiraRoutes from './routes/carteira.routes.js';
import dinamicaRoutes from './routes/dinamica.routes.js';
import motoristaRoutes from './routes/motorista.routes.js';
import sociosRoutes from './routes/socios.routes.js';
import marketplaceRouter from './routes/marketplace.routes.js';

const app = express();
const port = process.env.PORT || 3000;
const server = createServer(app);
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// O Render fica atrás de um proxy: necessário para o limite de tentativas ver o IP real
app.set('trust proxy', 1);

// Aceita router pronto ou função "fábrica" que devolve o router
const montar = (modulo, ...args) => (modulo && modulo.stack ? modulo : modulo(...args));

// ============================================================================
// 1. CORS (HTTP + SOCKET.IO) - só origens permitidas
// ============================================================================
const origensPermitidas = new Set([
  'https://hubymovi-01.github.io',
  ...(process.env.ORIGENS_PERMITIDAS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ...(EM_PRODUCAO
    ? []
    : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500', 'http://localhost:8080'])
]);

const checarOrigem = (origin, callback) => {
  // Sem origin = app instalado, Mercado Pago (webhook), ferramentas de teste
  if (!origin || origensPermitidas.has(origin)) return callback(null, true);
  return callback(null, false);
};

const opcoesCors = {
  origin: checarOrigem,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: true
};

// ============================================================================
// 2. SOCKET.IO
// ============================================================================
const io = new Server(server, { cors: opcoesCors });

// Token é opcional (o rastreio público não tem login). Token inválido = visitante.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token) {
    try {
      socket.data.usuario = jwt.verify(String(token), JWT_SECRET);
    } catch (e) {
      socket.data.usuario = null;
    }
  }
  next();
});

io.on('connection', (socket) => {
  const u = socket.data.usuario;
  if (u) {
    socket.join(`usuario:${u.id}`);
    if (u.motoristaId) socket.join(`usuario:${u.motoristaId}`);
    socket.join(`papel:${String(u.role || '').toLowerCase()}`);
  }

  // Quem acompanha uma corrida entra só na sala dela
  socket.on('acompanhar_corrida', (pedidoId) => {
    if (typeof pedidoId === 'string' && pedidoId.length > 0 && pedidoId.length <= 64) {
      socket.join(`corrida:${pedidoId}`);
    }
  });
});

app.set('io', io);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ============================================================================
// 3. SEGURANÇA E PARSERS
// ============================================================================
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(opcoesCors));
app.options('*', cors(opcoesCors));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Limite geral por IP
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um instante.' }
}));

// Limite rígido para login e cadastro (barra tentativa em massa)
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});
app.use(
  [
    '/api/auth/login',
    '/api/auth/login-motorista',
    '/api/auth/cadastro',
    '/api/usuarios/login',
    '/api/usuarios/login-motorista',
    '/api/usuarios/cadastro'
  ],
  limitadorLogin
);

// ============================================================================
// 4. SINCRONIZAÇÃO DAS TABELAS NO NEON POSTGRESQL
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

    // Colunas adicionais de apoio
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
// 5. ROTAS BASE E STATUS
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    status: 'HUBy API Online (Modularizada)',
    versao: '2.1.0'
  });
});

app.get('/api/config/tarifas', (req, res) => {
  res.json({
    taxa_plataforma: 15,
    km_carro: 2.5,
    km_moto: 1.8,
    km_entrega: 2.0
  });
});

// ============================================================================
// 6. REGISTRO DE ROTAS MODULARES
// ============================================================================
app.use('/api/auth', authRoutes);
// Compatibilidade: as telas antigas ainda chamam /api/usuarios/... (agora usa o login seguro com bcrypt)
app.use('/api/usuarios', authRoutes);
app.use('/api/pedidos', montar(pedidosRouter, io));
app.use('/api/admin', montar(adminRoutes, io));
app.use('/api/carteira', carteiraRoutes);
app.use('/api/dinamica', dinamicaRoutes);
app.use('/api/motoristas', motoristaRoutes);
app.use('/api/motoristas-regras', motoristaRoutes);
app.use('/api/socios', montar(sociosRoutes));
app.use('/api/marketplace', marketplaceRouter);

// ============================================================================
// 7. TRATAMENTO GLOBAL DE ERROS
// ============================================================================
app.use((err, req, res, next) => {
  console.error('Erro interno do servidor:', err);
  const status = err.status || 500;
  const msg = status >= 500 ? 'Erro interno no servidor.' : err.message;
  res.status(status).json({ erro: msg, mensagem: msg });
});

// ============================================================================
// 8. INICIALIZAÇÃO DO SERVIDOR
// ============================================================================
server.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});