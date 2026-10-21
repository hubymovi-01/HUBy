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

// ==========================================
// 0. AUTENTICAÇÃO ADMINISTRATIVA SEGURA VIA BANCO
// ==========================================
app.post('/api/admin/verificar', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail não fornecido.' });
    }

    // Consulta na base de dados Neon se o cargo deste e-mail é admin
    const resultado = await sql`
      SELECT role FROM clientes WHERE email = ${email.trim().toLowerCase()} LIMIT 1
    `;

    if (resultado.length > 0 && resultado[0].role === 'admin') {
      res.json({ sucesso: true, isAdmin: true, token: 'token_admin_autorizado_998877' });
    } else {
      res.status(403).json({ sucesso: false, isAdmin: false, erro: 'Acesso negado.' });
    }
  } catch (error) {
    console.error('Erro ao verificar permissão de admin:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// Rota de login por senha administrativa (opcional caso queira manter as duas opções)
app.post('/api/admin/login', (req, res) => {
  const { senhaAdmin } = req.body;
  const senhaSecretaOficial = process.env.ADMIN_SECRET_KEY || 'HubyAdmin2026!';

  if (senhaAdmin === senhaSecretaOficial) {
    res.json({ sucesso: true, token: 'token_admin_autorizado_998877' });
  } else {
    res.status(401).json({ sucesso: false, erro: 'Senha de administrador inválida.' });
  }
});

// ==========================================
// 1. ROTAS DE CLIENTES (Cadastro & Perfis)
// ==========================================
app.post('/api/clientes/cadastro', async (req, res) => {
  try {
    const { id, nome, telefone, cpf, email, idade, genero, emergenciaNome, emergenciaTel } = req.body;

    if (!nome || !cpf || !email) {
      return res.status(400).json({ erro: 'Dados obrigatórios em falta para o cadastro do cliente.' });
    }

    // Cria a tabela de clientes com suporte a role (perfil) se não existir
    await sql`
      CREATE TABLE IF NOT EXISTS clientes (
        id VARCHAR(50) PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        telefone VARCHAR(25),
        cpf VARCHAR(20) UNIQUE,
        email VARCHAR(150) UNIQUE,
        idade INT,
        genero VARCHAR(30),
        emergencia_nome VARCHAR(150),
        emergencia_tel VARCHAR(25),
        role VARCHAR(30) DEFAULT 'cliente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Insere ou atualiza o cliente na base de dados Neon
    await sql`
      INSERT INTO clientes (id, nome, telefone, cpf, email, idade, genero, emergencia_nome, emergencia_tel)
      VALUES (${id || 'cli_' + Date.now()}, ${nome}, ${telefone}, ${cpf}, ${email.toLowerCase().trim()}, ${idade || 18}, ${genero || 'nao_informar'}, ${emergenciaNome || ''}, ${emergenciaTel || ''})
      ON CONFLICT (email) DO UPDATE 
      SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, idade = EXCLUDED.idade, genero = EXCLUDED.genero, emergencia_nome = EXCLUDED.emergencia_nome, emergencia_tel = EXCLUDED.emergencia_tel
    `;

    res.status(201).json({ sucesso: true, mensagem: 'Cliente cadastrado com sucesso no Neon.' });
  } catch (error) {
    console.error('Erro ao guardar cliente no Neon:', error);
    res.status(500).json({ erro: error.message });
  }
});

// ==========================================
// 2. ROTAS DE PEDIDOS (Cliente & Motorista)
// ==========================================

// Inserir novo pedido (Cliente chama corrida/frete)
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

// Listar pedidos (Motorista consulta radar ou Admin visualiza tudo)
app.get('/api/pedidos', async (req, res) => {
  try {
    const statusFiltro = req.query.status;
    let pedidos;

    if (statusFiltro) {
      pedidos = await sql`
        SELECT * FROM pedidos 
        WHERE status = ${statusFiltro}
        ORDER BY criado_em DESC
        LIMIT 25
      `;
    } else {
      pedidos = await sql`
        SELECT * FROM pedidos 
        ORDER BY criado_em DESC
        LIMIT 50
      `;
    }
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao consultar pedidos:', error);
    res.status(500).json({ erro: error.message });
  }
});

// Atualizar estado do pedido (Motorista aceita ou rejeita)
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

// ==========================================
// 3. ROTAS DE MOTORISTAS (Cadastro & Admin)
// ==========================================

// Cadastrar novo motorista parceiro
app.post('/api/motoristas/cadastro', async (req, res) => {
  try {
    const {
      nome, telefone, cpf, cnhNumero,
      categoria, veiculoModelo, veiculoPlaca, veiculoCor,
      fotoCnhUrl, fotoVeiculoUrl
    } = req.body;

    const resultado = await sql`
      INSERT INTO motoristas (
        nome, telefone, cpf, cnh_numero, categoria,
        veiculo_modelo, veiculo_placa, veiculo_cor,
        foto_cnh_url, foto_veiculo_url, status_online, status_aprovacao
      ) VALUES (
        ${nome}, ${telefone}, ${cpf}, ${cnhNumero}, ${categoria},
        ${veiculoModelo}, ${veiculoPlaca.toUpperCase()}, ${veiculoCor},
        ${fotoCnhUrl || ''}, ${fotoVeiculoUrl || ''}, TRUE, 'pendente'
      )
      RETURNING id, nome, categoria, veiculo_modelo, status_aprovacao;
    `;

    res.status(201).json({ sucesso: true, motorista: resultado[0] });
  } catch (err) {
    console.error('Erro no cadastro de motorista:', err);
    res.status(500).json({ erro: 'Falha ao realizar cadastro do motorista: ' + err.message });
  }
});

// Listar motoristas pendentes para o painel administrativo
app.get('/api/motoristas', async (req, res) => {
  try {
    const motoristas = await sql`
      SELECT * FROM motoristas 
      ORDER BY criado_em DESC
    `;
    res.json(motoristas);
  } catch (error) {
    console.error('Erro ao listar motoristas:', error);
    res.status(500).json({ erro: error.message });
  }
});

// Aprovar motorista pelo painel administrativo
app.post('/api/motoristas/aprovar', async (req, res) => {
  try {
    const { id } = req.body;
    await sql`
      UPDATE motoristas 
      SET status_aprovacao = 'aprovado' 
      WHERE id = ${id}
    `;
    res.json({ sucesso: true, mensagem: 'Motorista aprovado com sucesso.' });
  } catch (error) {
    console.error('Erro ao aprovar motorista:', error);
    res.status(500).json({ erro: error.message });
  }
});

app.listen(port, () => {
  console.log(`Servidor HUBy ativo na porta ${port}`);
});