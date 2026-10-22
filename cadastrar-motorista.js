import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function criarMotoristaTeste() {
  try {
    // Garante a tabela antes de inserir
    await sql`
      CREATE TABLE IF NOT EXISTS motoristas (
        id VARCHAR(60) PRIMARY KEY DEFAULT 'drv_' || replace(gen_random_uuid()::text, '-', ''),
        nome VARCHAR(150) NOT NULL,
        telefone VARCHAR(25) NOT NULL,
        cnh_numero VARCHAR(30) UNIQUE NOT NULL,
        categoria VARCHAR(30) NOT NULL,
        veiculo_modelo VARCHAR(100) NOT NULL,
        veiculo_placa VARCHAR(15) UNIQUE NOT NULL,
        status_online BOOLEAN DEFAULT FALSE,
        saldo_carteira NUMERIC(10, 2) DEFAULT 0.00,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Insere ou atualiza o motorista de teste
    await sql`
      INSERT INTO motoristas (nome, telefone, cnh_numero, categoria, veiculo_modelo, veiculo_placa, status_online, saldo_carteira)
      VALUES (
        'Carlos Silva (Parceiro)',
        '(11) 98888-8888',
        '12345678900',
        'carro',
        'Chevrolet Onix Preto',
        'ABC1D23',
        TRUE,
        150.00
      )
      ON CONFLICT (cnh_numero) DO UPDATE
      SET veiculo_placa = 'ABC1D23';
    `;

    console.log('✅ Motorista gravado no Neon com sucesso!');
    console.log('👉 CNH: 12345678900');
    console.log('👉 Placa: ABC1D23');
  } catch (err) {
    console.error('❌ Erro:', err);
  } finally {
    process.exit();
  }
}

criarMotoristaTeste();