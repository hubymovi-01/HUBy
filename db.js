// db.js - Conexão Neon Serverless e Configurações Globais
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.warn('⚠️ AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

// Instância SQL serverless otimizada para requisições rápidas e escaláveis
export const sql = neon(process.env.DATABASE_URL);
export const JWT_SECRET = process.env.JWT_SECRET || 'huby_jwt_secret_key_prod_2026_xpto';

// Inicialização segura de suporte a colunas e tabelas essenciais
async function inicializarEstruturaBase() {
  if (!process.env.DATABASE_URL) return;

  try {
    // 1. Garante colunas de suporte do motorista (veículo, destino e pausas)
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

    // 2. Garante coluna de horário de embarque na tabela de pedidos
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