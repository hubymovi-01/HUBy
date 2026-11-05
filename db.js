// db.js - Conexão Neon Serverless e Configurações Globais
import dotenv from 'dotenv';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

dotenv.config();

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

export const sql = neon(process.env.DATABASE_URL);

// JWT_SECRET: sem chave fixa no código.
let segredo = process.env.JWT_SECRET;
if (!segredo || segredo.length < 32) {
  if (EM_PRODUCAO) {
    throw new Error('JWT_SECRET ausente ou curta (mínimo 32 caracteres). Defina no Render.');
  }
  segredo = crypto.randomBytes(48).toString('hex');
  console.warn('⚠️ JWT_SECRET não definida: usando chave temporária (só para desenvolvimento).');
}
export const JWT_SECRET = segredo;

// Inicialização segura de suporte a colunas e tabelas essenciais
async function inicializarEstruturaBase() {
  if (!process.env.DATABASE_URL) return;

  try {
    await sql`
      ALTER TABLE motoristas 
        ADD COLUMN IF NOT EXISTS destino_casa_lat NUMERIC,
        ADD COLUMN IF NOT EXISTS destino_casa_lng NUMERIC,
        ADD COLUMN IF NOT EXISTS destino_casa_ativo BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS em_pausa BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS pausa_ate TIMESTAMP,
        ADD COLUMN IF NOT EXISTS chave_pix_padrao TEXT,
        ADD COLUMN IF NOT EXISTS veiculo_ano TEXT,
        ADD COLUMN IF NOT EXISTS veiculo_cor TEXT;
    `;

    await sql`
      ALTER TABLE pedidos 
        ADD COLUMN IF NOT EXISTS embarque_em TIMESTAMP;
    `;

    console.log('✅ Conexão Neon validada e colunas de suporte sincronizadas com sucesso.');
  } catch (err) {
    console.warn('Aviso na verificação de tabelas base:', err.message);
  }
}

inicializarEstruturaBase();