import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Verifica se a variável de ligação existe
if (!process.env.DATABASE_URL) {
  console.error('AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

const sql = neon(process.env.DATABASE_URL);

// Teste de integridade do servidor
app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online', banco: 'Neon PostgreSQL' });
});

// 1. Inserir novo pedido (Cliente chama corrida/frete)
app.post('/api/pedidos', async (req, res) => {
  try {
    const { id, tipo, subTipoLabel, origem, destino, distancia, preco, metodoPgto } = req.body;

    if (!id || !preco) {
      return res.status(400).json({ erro: 'Dados incompletos para criação do pedido.' });
    }

    await sql`
      INSERT INTO pedidos (id, tipo, sub_tipo_label, origem, destino, distancia, preco, metodo_pgto, status)
      VALUES (${id}, ${tipo}, ${subTipoLabel}, ${origem}, ${destino}, ${distancia}, ${preco}, ${metodoPgto}, 'pendente')
    `;

    res.status(201).json({ sucesso: true, id });
  } catch (error) {
    console.error('Erro ao guardar pedido no Neon:', error);
    res.status(500).json({ erro: error.message });
  }
});

// 2. Listar pedidos pendentes (Motorista consulta radar)
app.get('/api/pedidos', async (req, res) => {
  try {
    const statusFiltro = req.query.status || 'pendente';
    const pedidos = await sql`
      SELECT * FROM pedidos 
      WHERE status = ${statusFiltro}
      ORDER BY criado_em DESC
      LIMIT 25
    `;
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao consultar pedidos:', error);
    res.status(500).json({ erro: error.message });
  }
});

// 3. Atualizar estado do pedido (Motorista aceita ou rejeita)
app.patch('/api/pedidos', async (req, res) => {
  try {
    const { id, novoStatus } = req.body;

    if (!id || !novoStatus) {
      return res.status(400).json({ erro: 'ID e novoStatus são obrigatórios.' });
    }

    await sql`
      UPDATE pedidos 
      SET status = ${novoStatus} 
      WHERE id = ${id}
    `;

    res.json({ sucesso: true, mensagem: `Pedido #${id} alterado para ${novoStatus}` });
  } catch (error) {
    console.error('Erro ao atualizar pedido:', error);
    res.status(500).json({ erro: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});
// POST /api/motoristas/cadastro
app.post('/api/motoristas/cadastro', async (req, res) => {
  try {
    const {
      nome, telefone, cpf, cnhNumero,
      categoria, veiculoModelo, veiculoPlaca, veiculoCor,
      fotoCnhUrl, fotoVeiculoUrl
    } = req.body;

    const query = `
      INSERT INTO motoristas (
        nome, telefone, cpf, cnh_numero, categoria,
        veiculo_modelo, veiculo_placa, veiculo_cor,
        foto_cnh_url, foto_veiculo_url, status_online
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
      RETURNING id, nome, categoria, veiculo_modelo, status_aprovacao;
    `;

    const valores = [
      nome, telefone, cpf, cnhNumero,
      categoria, veiculoModelo, veiculoPlaca.toUpperCase(), veiculoCor,
      fotoCnhUrl || '', fotoVeiculoUrl || ''
    ];

    const resultado = await pool.query(query, valores);
    res.status(201).json({ sucesso: true, motorista: resultado.rows[0] });
  } catch (err) {
    console.error('Erro no cadastro de motorista:', err);
    res.status(500).json({ erro: 'Falha ao realizar cadastro do motorista' });
  }
});