import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function inserirMotorista() {
  try {
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
    console.log('✅ Motorista de teste gravado no Neon com sucesso!');
    console.log('CNH: 12345678900 | Placa: ABC1D23');
  } catch (err) {
    console.error('❌ Erro ao gravar motorista:', err);
  } finally {
    process.exit();
  }
}

inserirMotorista();