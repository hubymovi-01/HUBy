import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const port = process.env.PORT || 3000;

// Chave mestra para tokens JWT
const JWT_SECRET = process.env.JWT_SECRET || 'huby_jwt_secret_key_prod_2026_xpto';

app.use(cors());
app.use(express.json());

if (!process.env.DATABASE_URL) {
  console.error('AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

const sql = neon(process.env.DATABASE_URL);

// Middleware de verificação de Token JWT Admin
function autenticarAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ erro: 'Acesso negado: Token não fornecido.' });
  }

  const token = authHeader.split(' ')[1] || authHeader;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online e Blindada', banco: 'Neon PostgreSQL' });
});

// ==========================================
// 0. AUTENTICAÇÃO ADMINISTRATIVA SEGURA
// ==========================================
app.post('/api/admin/verificar', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ sucesso: false, isAdmin: false, erro: 'E-mail não fornecido.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();

    const resultado = await sql`
      SELECT id, role FROM clientes 
      WHERE LOWER(TRIM(email)) = ${emailLimpo} 
      LIMIT 1
    `;

    if (resultado.length > 0 && resultado[0].role === 'admin') {
      const token = jwt.sign(
        { id: resultado[0].id, role: 'admin' }, 
        JWT_SECRET, 
        { expiresIn: '12h' }
      );
      return res.json({ sucesso: true, isAdmin: true, token });
    }

    return res.json({ sucesso: true, isAdmin: false });
  } catch (error) {
    console.error('Erro ao verificar admin:', error);
    res.status(500).json({ sucesso: false, erro: 'Falha interna ao verificar permissão.' });
  }
});

app.post('/api/admin/login', (req, res) => {
  const { senhaAdmin } = req.body;
  const senhaSecretaOficial = process.env.ADMIN_SECRET_KEY || 'HubyAdmin2026!';

  if (senhaAdmin === senhaSecretaOficial) {
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ sucesso: true, token });
  } else {
    res.status(401).json({ sucesso: false, erro: 'Senha de administrador inválida.' });
  }
});

// ==========================================
// 1. ROTAS DE CLIENTES
// ==========================================
app.post('/api/clientes/cadastro', async (req, res) => {
  try {
    const { id, nome, telefone, cpf, email, senha, idade, genero, emergenciaNome, emergenciaTel } = req.body;

    if (!nome || !cpf || !email || !senha) {
      return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios (nome, cpf, email e senha).' });
    }

    // Hash da senha com salt seguro
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(String(senha), salt);

    await sql`
      CREATE TABLE IF NOT EXISTS clientes (
        id VARCHAR(50) PRIMARY KEY,
        nome VARCHAR(150) NOT NULL,
        telefone VARCHAR(25),
        cpf VARCHAR(20) UNIQUE,
        email VARCHAR(150) UNIQUE,
        senha VARCHAR(150),
        idade INT,
        genero VARCHAR(30),
        emergencia_nome VARCHAR(150),
        emergencia_tel VARCHAR(25),
        role VARCHAR(30) DEFAULT 'cliente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await sql`
      INSERT INTO clientes (id, nome, telefone, cpf, email, senha, idade, genero, emergencia_nome, emergencia_tel)
      VALUES (
        ${id || 'cli_' + Date.now()}, 
        ${nome}, 
        ${telefone}, 
        ${cpf}, 
        ${email.toLowerCase().trim()}, 
        ${senhaHash}, 
        ${idade || 18}, 
        ${genero || 'nao_informar'}, 
        ${emergenciaNome || ''}, 
        ${emergenciaTel || ''}
      )
      ON CONFLICT (email) DO UPDATE 
      SET nome = EXCLUDED.nome, 
          telefone = EXCLUDED.telefone, 
          senha = EXCLUDED.senha,
          idade = EXCLUDED.idade, 
          genero = EXCLUDED.genero, 
          emergencia_nome = EXCLUDED.emergencia_nome, 
          emergencia_tel = EXCLUDED.emergencia_tel
    `;

    res.status(201).json({ sucesso: true, mensagem: 'Cliente cadastrado com segurança.' });
  } catch (error) {
    console.error('Erro no cadastro do cliente:', error);
    res.status(500).json({ erro: 'Falha ao processar cadastro.' });
  }
});

app.post('/api/clientes/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail e senha são obrigatórios.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();

    const resultado = await sql`
      SELECT id, nome, email, telefone, role, senha 
      FROM clientes 
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
      LIMIT 1
    `;

    if (resultado.length === 0) {
      return res.status(401).json({ sucesso: false, erro: 'E-mail não cadastrado.' });
    }

    const cliente = resultado[0];

    // Validação comparando hash seguro ou texto plano legado
    let senhaValida = false;
    if (cliente.senha.startsWith('$2a$') || cliente.senha.startsWith('$2b$')) {
      senhaValida = await bcrypt.compare(String(senha), cliente.senha);
    } else {
      senhaValida = cliente.senha === String(senha);
    }

    if (!senhaValida) {
      return res.status(401).json({ sucesso: false, erro: 'Credenciais incorretas.' });
    }

    const tokenCliente = jwt.sign(
      { id: cliente.id, email: cliente.email, role: cliente.role || 'cliente' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      sucesso: true,
      token: tokenCliente,
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        email: cliente.email,
        telefone: cliente.telefone,
        role: cliente.role || 'cliente'
      }
    });
  } catch (err) {
    console.error('Erro no login do cliente:', err);
    res.status(500).json({ sucesso: false, erro: 'Falha interna ao validar acesso.' });
  }
});

// ==========================================
// 2. ROTAS DE PEDIDOS
// ==========================================
app.post('/api/pedidos', async (req, res) => {
  try {
    const { id, tipo, subTipoLabel, origem, destino, distancia, preco, metodoPgto } = req.body;

    if (!id || !preco || !origem || !destino) {
      return res.status(400).json({ erro: 'Dados essenciais em falta para o pedido.' });
    }

    await sql`
      INSERT INTO pedidos (id, tipo, sub_tipo_label, origem, destino, distancia, preco, metodo_pgto, status)
      VALUES (${id}, ${tipo}, ${subTipoLabel}, ${origem}, ${destino}, ${distancia}, ${preco}, ${metodoPgto}, 'pendente')
    `;

    res.status(201).json({ sucesso: true, id });
  } catch (error) {
    console.error('Erro ao registrar pedido:', error);
    res.status(500).json({ erro: 'Falha ao registrar pedido.' });
  }
});

app.get('/api/pedidos', async (req, res) => {
  try {
    const statusFiltro = req.query.status;
    let pedidos;

    if (statusFiltro) {
      pedidos = await sql`
        SELECT id, tipo, sub_tipo_label, origem, destino, distancia, preco, metodo_pgto, status, criado_em 
        FROM pedidos 
        WHERE status = ${statusFiltro}
        ORDER BY criado_em DESC
        LIMIT 30
      `;
    } else {
      pedidos = await sql`
        SELECT id, tipo, sub_tipo_label, origem, destino, distancia, preco, metodo_pgto, status, criado_em 
        FROM pedidos 
        ORDER BY criado_em DESC
        LIMIT 50
      `;
    }
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao consultar pedidos:', error);
    res.status(500).json({ erro: 'Falha ao consultar pedidos.' });
  }
});

app.patch('/api/pedidos', async (req, res) => {
  try {
    const { id, novoStatus } = req.body;

    const statusValidos = ['pendente', 'aceito', 'a_caminho', 'em_andamento', 'concluido', 'cancelado'];
    if (!id || !statusValidos.includes(novoStatus)) {
      return res.status(400).json({ erro: 'ID ou status de corrida inválido.' });
    }

    await sql`
      UPDATE pedidos 
      SET status = ${novoStatus} 
      WHERE id = ${id}
    `;

    res.json({ sucesso: true, mensagem: `Pedido #${id} atualizado para ${novoStatus}` });
  } catch (error) {
    console.error('Erro ao atualizar pedido:', error);
    res.status(500).json({ erro: 'Falha ao atualizar pedido.' });
  }
});

// ==========================================
// 3. ROTAS DE MOTORISTAS
// ==========================================
app.post('/api/motoristas/login', async (req, res) => {
  try {
    const { cnh, placa } = req.body;

    if (!cnh || !placa) {
      return res.status(400).json({ sucesso: false, erro: 'Informe CNH e Placa.' });
    }

    const cnhLimpa = String(cnh).replace(/\D/g, '').trim();
    const placaLimpa = String(placa).replace(/[^A-Za-z0-9]/g, '').trim().toUpperCase();

    const resultado = await sql`
      SELECT id, nome, categoria, veiculo_placa, veiculo_modelo, status_aprovacao
      FROM motoristas
      WHERE REPLACE(cnh_numero, ' ', '') = ${cnhLimpa}
        AND UPPER(REPLACE(veiculo_placa, '-', '')) = ${placaLimpa}
      LIMIT 1
    `;

    if (resultado.length === 0) {
      return res.status(401).json({ sucesso: false, erro: 'Dados de motorista não localizados.' });
    }

    const motorista = resultado[0];

    const tokenMotorista = jwt.sign(
      { id: motorista.id, role: 'motorista' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token: tokenMotorista,
      motorista: {
        id: motorista.id,
        nome: motorista.nome,
        categoria: motorista.categoria || 'carro',
        placa: motorista.veiculo_placa,
        modelo: motorista.veiculo_modelo,
        statusAprovacao: motorista.status_aprovacao
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ sucesso: false, erro: 'Falha na validação de credenciais.' });
  }
});

app.post('/api/motoristas/cadastro', async (req, res) => {
  try {
    const {
      nome, telefone, cpf, cnhNumero,
      categoria, veiculoModelo, veiculoPlaca, veiculoCor,
      fotoCnhUrl, fotoVeiculoUrl
    } = req.body;

    if (!nome || !cnhNumero || !veiculoPlaca) {
      return res.status(400).json({ erro: 'Nome, CNH e Placa são obrigatórios.' });
    }

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
    res.status(500).json({ erro: 'Falha ao processar cadastro de condutor.' });
  }
});

// Listagem de motoristas restrita a administradores autenticados
app.get('/api/motoristas', autenticarAdmin, async (req, res) => {
  try {
    const motoristas = await sql`
      SELECT id, nome, telefone, categoria, veiculo_modelo, veiculo_placa, veiculo_cor, status_aprovacao, criado_em 
      FROM motoristas 
      ORDER BY criado_em DESC
    `;
    res.json(motoristas);
  } catch (error) {
    console.error('Erro ao listar motoristas:', error);
    res.status(500).json({ erro: 'Erro ao listar parceiros.' });
  }
});

// Aprovação de motorista restrita a administradores autenticados
app.post('/api/motoristas/aprovar', autenticarAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ erro: 'ID do motorista não fornecido.' });

    await sql`
      UPDATE motoristas 
      SET status_aprovacao = 'aprovado' 
      WHERE id = ${id}
    `;
    res.json({ sucesso: true, mensagem: 'Motorista aprovado com sucesso.' });
  } catch (error) {
    console.error('Erro ao aprovar motorista:', error);
    res.status(500).json({ erro: 'Falha ao aprovar cadastro.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor HUBy ativo e protegido na porta ${port}`);
});