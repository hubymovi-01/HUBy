// db.js - Conexão Neon Serverless e Configurações Globais
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

// ============================================================================
// BANCO DE DADOS
// ============================================================================
if (!process.env.DATABASE_URL) {
  console.error('❌ ERRO: DATABASE_URL não definida nas variáveis de ambiente.');
  process.exit(1);
}

export const sql = neon(process.env.DATABASE_URL);

// ============================================================================
// CHAVE SECRETA DO LOGIN (JWT) - CORRIGIDA E BLINDADA
// ============================================================================
// A chave de login vem SEMPRE do Render (variável JWT_SECRET, com 32+ caracteres).
// Sem ela o servidor não liga: uma chave escrita aqui ficaria pública no GitHub.
// (Os logins continuam valendo depois de reiniciar, porque a chave do Render é sempre a mesma.)
const segredoJwt = process.env.JWT_SECRET;
if (!segredoJwt || segredoJwt.length < 32) {
  throw new Error('JWT_SECRET ausente ou curto (mínimo 32 caracteres). Configure no Render e no .env.local.');
}
export const JWT_SECRET = segredoJwt;
// ============================================================================
// ESTRUTURA BASE (colunas de apoio)
// ============================================================================
async function inicializarEstruturaBase() {
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

    console.log('✅ Conexão Neon validada. JWT fixado com sucesso.');
  } catch (err) {
    console.warn('Aviso na verificação de tabelas base:', err.message);
  }
}

inicializarEstruturaBase();