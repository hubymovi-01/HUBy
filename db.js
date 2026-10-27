// db.js
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.warn('AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

export const sql = neon(process.env.DATABASE_URL);
export const JWT_SECRET = process.env.JWT_SECRET || 'huby_jwt_secret_key_prod_2026_xpto';