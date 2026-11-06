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
// Lógica atualizada: Lê a chave do Render. Se falhar ou estiver ausente, 
// usa uma chave fixa e longa em vez de gerar uma aleatória.
// Isto impede que o Render invalide os tokens ao reiniciar a instância gratuita.
export const JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  ? process.env.JWT_SECRET
  : 'huby_chave_fixa_de_seguranca_absoluta_2026_para_nao_cair_sessao_nunca_mais';

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