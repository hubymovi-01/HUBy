import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { sql } from './db.js';
import authRoutes from './routes/auth.routes.js';
import pedidosRouter from './routes/pedidos.routes.js';
import adminRoutes from './routes/admin.routes.js';
import carteiraRoutes from './routes/carteira.routes.js';
import dinamicaRoutes from './routes/dinamica.routes.js';
import motoristaRoutes from './routes/motorista.routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

io.on('connection', (socket) => {
  console.log(`Novo utilizador conectado ao radar (Socket.IO): ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Utilizador desconectado do radar: ${socket.id}`);
  });
});

// 1. CONFIGURAÇÃO DE CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization']
}));

// 2. PARSERS DE JSON COM SUPORTE A FOTOS GRANDES (ANTES DAS ROTAS)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Inicialização automática das tabelas no Neon PostgreSQL
async function inicializarBanco() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE, telefone TEXT UNIQUE,
        cpf TEXT UNIQUE, data_nascimento DATE, contato_emergencia_nome TEXT, contato_emergencia_tel TEXT,
        senha_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'cliente', criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS motoristas (
        id TEXT PRIMARY KEY, usuario_id TEXT, nome TEXT NOT NULL, email TEXT UNIQUE, telefone TEXT UNIQUE,
        cpf TEXT UNIQUE, data_nascimento DATE, senha_hash TEXT, cnh_numero TEXT,
        categoria TEXT DEFAULT 'carro', veiculo_modelo TEXT, veiculo_placa TEXT,
        veiculo_cor TEXT, veiculo_ano TEXT, saldo_carteira NUMERIC(10,2) DEFAULT 0.00, status_online BOOLEAN DEFAULT FALSE,
        status_aprovacao TEXT DEFAULT 'aprovado', motivo_recusa TEXT, doc_cnh_url TEXT, doc_crlv_url TEXT,
        foto_perfil_url TEXT, chave_pix_padrao TEXT,
        avaliacao_media NUMERIC(3,2) DEFAULT 5.00, total_avaliacoes INT DEFAULT 0, total_corridas INT DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS pedidos (
        id TEXT PRIMARY KEY, cliente_id TEXT, motorista_id TEXT, motorista_nome TEXT, motorista_telefone TEXT,
        motorista_veiculo TEXT, motorista_placa TEXT, tipo TEXT, sub_tipo_id TEXT, sub_tipo_label TEXT,
        origem_endereco TEXT, destino_endereco TEXT, origem_lat NUMERIC, origem_lng NUMERIC,
        destino_lat NUMERIC, destino_lng NUMERIC, distancia_km NUMERIC, duracao_min NUMERIC,
        valor_total NUMERIC(10,2), valor_adicionais NUMERIC(10,2) DEFAULT 0.00, metodo_pgto TEXT,
        status TEXT DEFAULT 'pendente', motivo_cancelamento TEXT, cancelado_por TEXT, concluido_em TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id SERIAL PRIMARY KEY, pedido_id TEXT NOT NULL, cliente_id TEXT, motorista_id TEXT,
        nota INT NOT NULL, comentario TEXT, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS mensagens_chat (
        id SERIAL PRIMARY KEY, pedido_id TEXT NOT NULL, remetente_id TEXT NOT NULL,
        remetente_nome TEXT NOT NULL, mensagem TEXT NOT NULL, enviado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS configuracoes_plataforma (
        chave TEXT PRIMARY KEY, valor JSONB NOT NULL, atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS saques_motoristas (
        id SERIAL PRIMARY KEY, motorista_id TEXT NOT NULL, motorista_nome TEXT,
        chave_pix TEXT NOT NULL, tipo_chave TEXT DEFAULT 'cpf', valor NUMERIC(10,2) NOT NULL,
        status TEXT DEFAULT 'pendente', comprovante_url TEXT, motivo_recusa TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, solicitado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP, pago_em TIMESTAMP
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

    // Garante colunas adicionais em tabelas já existentes
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_ano TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS veiculo_cor TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS total_corridas INT DEFAULT 0;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS concluido_em TIMESTAMP;`;
    await sql`ALTER TABLE saques_motoristas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS foto_perfil_url TEXT;`;

    console.log('Tabelas sincronizadas no Neon PostgreSQL.');
  } catch (e) {
    console.error('Erro na sincronização de tabelas:', e.message);
  }
}
inicializarBanco();

app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online (Modularizada)', versao: '2.0.3', banco: 'Neon PostgreSQL' });
});

app.get('/api/config/tarifas', (req, res) => {
  res.json({}); 
});

// REGISTRO DE ROTAS MODULARES
app.use('/api/auth', authRoutes);
app.use('/api/usuarios', authRoutes); 
app.use('/api/pedidos', pedidosRouter(io));
app.use('/api/admin', typeof adminRoutes === 'function' ? adminRoutes(io) : adminRoutes);
app.use('/api/carteira', carteiraRoutes);
app.use('/api/dinamica', dinamicaRoutes);

// Suporta tanto /api/motoristas quanto /api/motoristas-regras
app.use('/api/motoristas', motoristaRoutes);
app.use('/api/motoristas-regras', motoristaRoutes);

server.listen(port, () => {
  console.log(`Servidor HUBy modularizado ativo na porta ${port}`);
});