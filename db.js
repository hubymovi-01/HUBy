// db.js - Conexão Neon Serverless e Configurações Globais
import dotenv from 'dotenv';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';

dotenv.config();

const EM_PRODUCAO = process.env.NODE_ENV === 'production';

// ============================================================================
// BANCO DE DADOS
// ============================================================================
if (!process.env.DATABASE_URL) {
  // Sem banco o sistema não funciona: melhor parar com uma mensagem clara
  console.error('❌ ERRO: DATABASE_URL não definida nas variáveis de ambiente.');
  process.exit(1);
}

export const sql = neon(process.env.DATABASE_URL);

// ============================================================================
// CHAVE SECRETA DO LOGIN (JWT)
// Nunca escreva a chave aqui no código. Ela vem só das variáveis de ambiente.
// ============================================================================
function obterJwtSecret() {
  const segredo = process.env.JWT_SECRET;

  if (segredo && segredo.length >= 32) {
    return segredo;
  }

  if (EM_PRODUCAO) {
    // Em produção, sem uma chave forte o servidor não sobe
    console.error('❌ ERRO: JWT_SECRET ausente ou curta (mínimo 32 caracteres) em produção.');
    process.exit(1);
  }

  // Só em desenvolvimento: chave aleatória temporária (os logins caem ao reiniciar)
  console.warn('⚠️ AVISO: JWT_SECRET não definida. Usando chave temporária de desenvolvimento.');
  return crypto.randomBytes(48).toString('hex');
}

export const JWT_SECRET = obterJwtSecret();

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

    console.log('✅ Conexão Neon validada e colunas de suporte sincronizadas com sucesso.');
  } catch (err) {
    console.warn('Aviso na verificação de tabelas base:', err.message);
  }
}

inicializarEstruturaBase();