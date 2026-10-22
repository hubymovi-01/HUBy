import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function gerarAdmin() {
  try {
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash('admin123', salt);

    await sql`
      INSERT INTO usuarios (nome, email, telefone, cpf, senha_hash, role)
      VALUES (
        'Administrador HUBy',
        'admin@huby.com',
        '(11) 99999-9999',
        '00000000000',
        ${senhaHash},
        'admin'
      )
      ON CONFLICT (email) DO UPDATE 
      SET senha_hash = ${senhaHash}, role = 'admin';
    `;

    console.log('✅ Usuário admin configurado com sucesso! Senha: admin123');
  } catch (error) {
    console.error('❌ Erro ao configurar admin:', error);
  } finally {
    process.exit();
  }
}

gerarAdmin();