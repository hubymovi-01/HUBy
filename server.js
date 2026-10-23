import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'huby_jwt_secret_key_prod_2026_xpto';

// 1. TRATAMENTO EXPLÍCITO DE CORS & PREFLIGHT OPTIONS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

if (!process.env.DATABASE_URL) {
  console.warn('AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

const sql = neon(process.env.DATABASE_URL);

// Middleware para validação do Token JWT
export function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });
  }

  const token = authHeader.split(' ')[1] || authHeader;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

// Sincronização inicial das tabelas no Neon PostgreSQL
async function inicializarBanco() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE,
        telefone TEXT UNIQUE,
        cpf TEXT UNIQUE,
        senha_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'cliente',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS motoristas (
        id TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT UNIQUE,
        telefone TEXT UNIQUE,
        cpf TEXT UNIQUE,
        senha_hash TEXT,
        cnh_numero TEXT NOT NULL,
        categoria TEXT DEFAULT 'carro',
        veiculo_modelo TEXT NOT NULL,
        veiculo_placa TEXT NOT NULL,
        veiculo_cor TEXT,
        saldo_carteira NUMERIC(10,2) DEFAULT 0.00,
        status_online BOOLEAN DEFAULT FALSE,
        status_aprovacao TEXT DEFAULT 'aprovado',
        motivo_recusa TEXT,
        doc_cnh_url TEXT,
        doc_crlv_url TEXT,
        avaliacao_media NUMERIC(3,2) DEFAULT 5.00,
        total_avaliacoes INT DEFAULT 0,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS pedidos (
        id TEXT PRIMARY KEY,
        cliente_id TEXT,
        motorista_id TEXT,
        motorista_nome TEXT,
        motorista_telefone TEXT,
        motorista_veiculo TEXT,
        motorista_placa TEXT,
        tipo TEXT,
        sub_tipo_id TEXT,
        sub_tipo_label TEXT,
        origem_endereco TEXT,
        destino_endereco TEXT,
        origem_lat NUMERIC,
        origem_lng NUMERIC,
        destino_lat NUMERIC,
        destino_lng NUMERIC,
        distancia_km NUMERIC,
        duracao_min NUMERIC,
        valor_total NUMERIC(10,2),
        valor_adicionais NUMERIC(10,2) DEFAULT 0.00,
        metodo_pgto TEXT,
        status TEXT DEFAULT 'pendente',
        motivo_cancelamento TEXT,
        cancelado_por TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS avaliacoes (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT NOT NULL,
        cliente_id TEXT,
        motorista_id TEXT,
        nota INT NOT NULL,
        comentario TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('Tabelas verificadas no Neon PostgreSQL.');
  } catch (e) {
    console.error('Erro na sincronização de tabelas:', e.message);
  }
}
inicializarBanco();

// Rota de verificação de integridade da API
app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online', versao: '2.0.0', banco: 'Neon PostgreSQL' });
});

// ============================================================================
// 1. AUTENTICAÇÃO UNIFICADA (PASSAGEIROS & CONDUTORES)
// ============================================================================

// Handler de Cadastro Unificado (atende /api/auth/cadastro e /api/usuarios/cadastro)
const processarCadastro = async (req, res) => {
  try {
    const {
      nome, email, telefone, cpf, senha, role = 'cliente',
      cnh, veiculo_modelo, veiculo_placa, categoria_veiculo
    } = req.body;

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, Senha e Contato).' });
    }

    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).trim() : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(String(senha), salt);

    if (role === 'motorista') {
      if (!cnh || !veiculo_placa || !veiculo_modelo) {
        return res.status(400).json({ erro: 'Para parceiros condutores, informe CNH, Modelo e Placa.' });
      }

      const cnhLimpa = String(cnh).replace(/\D/g, '');
      const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const novoId = 'mot_' + Date.now().toString(36);

      const resultado = await sql`
        INSERT INTO motoristas (
          id, nome, email, telefone, cpf, senha_hash,
          cnh_numero, categoria, veiculo_modelo, veiculo_placa, status_aprovacao
        ) VALUES (
          ${novoId}, ${nome.trim()}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${senhaHash},
          ${cnhLimpa}, ${categoria_veiculo || 'carro'}, ${veiculo_modelo.trim()}, ${placaLimpa}, 'aprovado'
        )
        RETURNING id, nome, email, telefone, veiculo_modelo, veiculo_placa;
      `;

      const motoristaCriado = resultado[0];
      const token = jwt.sign(
        { id: motoristaCriado.id, nome: motoristaCriado.nome, role: 'motorista' },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.status(201).json({
        sucesso: true,
        token,
        usuario: { ...motoristaCriado, role: 'motorista' }
      });
    }

    // Registo de Passageiro
    const novoId = 'usr_' + Date.now().toString(36);
    const resultado = await sql`
      INSERT INTO usuarios (id, nome, email, telefone, cpf, senha_hash, role)
      VALUES (${novoId}, ${nome.trim()}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${senhaHash}, 'cliente')
      RETURNING id, nome, email, telefone, role;
    `;

    const utilizadorCriado = resultado[0];
    const token = jwt.sign(
      { id: utilizadorCriado.id, email: utilizadorCriado.email, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({
      sucesso: true,
      token,
      usuario: utilizadorCriado
    });
  } catch (err) {
    console.error('Erro no registo:', err);
    if (err.message && err.message.includes('unique constraint')) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está registado.' });
    }
    res.status(500).json({ erro: 'Falha ao concluir registo na base de dados.' });
  }
};

app.post('/api/auth/cadastro', processarCadastro);
app.post('/api/usuarios/cadastro', processarCadastro);

// Handler de Login Unificado (atende /api/auth/login e /api/usuarios/login)
const processarLogin = async (req, res) => {
  try {
    const identificador = req.body.identificador || req.body.emailOuTelefone || req.body.email;
    const senha = req.body.senha;
    const perfilDesejado = req.body.perfilDesejado || 'cliente';

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Indique os dados de acesso e a palavra-passe.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

    // Login de Condutor Parceiro
    if (perfilDesejado === 'motorista') {
      const motoristas = await sql`
        SELECT * FROM motoristas
        WHERE LOWER(TRIM(email)) = ${idLimpo}
           OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cnh_numero IS NOT NULL AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
        LIMIT 1;
      `;

      if (motoristas.length === 0) {
        return res.status(404).json({ erro: 'Condutor parceiro não localizado.' });
      }

      const mot = motoristas[0];
      const senhaValida = await bcrypt.compare(String(senha), mot.senha_hash);
      if (!senhaValida) {
        return res.status(401).json({ erro: 'Palavra-passe incorreta.' });
      }

      await sql`UPDATE motoristas SET status_online = TRUE WHERE id = ${mot.id};`;

      const token = jwt.sign(
        { id: mot.id, nome: mot.nome, role: 'motorista', categoria: mot.categoria },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      return res.json({
        sucesso: true,
        token,
        usuario: {
          id: mot.id,
          nome: mot.nome,
          email: mot.email,
          telefone: mot.telefone,
          role: 'motorista',
          veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`,
          saldo: mot.saldo_carteira
        }
      });
    }

    // Login de Passageiro / Admin
    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
         OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
      LIMIT 1;
    `;

    if (usuarios.length === 0) {
      return res.status(404).json({ erro: 'Utilizador não localizado.' });
    }

    const usr = usuarios[0];
    const senhaValida = await bcrypt.compare(String(senha), usr.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Palavra-passe incorreta.' });
    }

    const token = jwt.sign(
      { id: usr.id, nome: usr.nome, email: usr.email, role: usr.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: usr.id,
        nome: usr.nome,
        email: usr.email,
        telefone: usr.telefone,
        role: usr.role
      }
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
  }
};

app.post('/api/auth/login', processarLogin);
app.post('/api/usuarios/login', processarLogin);

// Login Legado do Condutor (via CNH e Placa direta)
app.post('/api/motoristas/login', async (req, res) => {
  try {
    const cnh = req.body.cnh || req.body.cnh_numero;
    const placa = req.body.placa || req.body.veiculo_placa;

    if (!cnh || !placa) {
      return res.status(400).json({ erro: 'Indique a CNH e a matrícula/placa do veículo.' });
    }

    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const resultado = await sql`
      SELECT id, nome, categoria, veiculo_modelo, veiculo_placa, saldo_carteira
      FROM motoristas
      WHERE regexp_replace(cnh_numero, '\\D', '', 'g') = ${cnhLimpa}
        AND UPPER(regexp_replace(veiculo_placa, '[^a-zA-Z0-9]', '', 'g')) = ${placaLimpa}
      LIMIT 1;
    `;

    if (resultado.length === 0) {
      return res.status(401).json({ erro: 'CNH ou Placa não localizados.' });
    }

    const motorista = resultado[0];
    await sql`UPDATE motoristas SET status_online = TRUE WHERE id = ${motorista.id};`;

    const token = jwt.sign(
      { id: motorista.id, role: 'motorista', categoria: motorista.categoria },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true,
      token,
      motorista: {
        id: motorista.id,
        nome: motorista.nome,
        categoria: motorista.categoria,
        veiculo: `${motorista.veiculo_modelo} (${motorista.veiculo_placa})`,
        saldo: motorista.saldo_carteira
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar condutor.' });
  }
});

// Consultar saldo da carteira do condutor
app.get('/api/motoristas/meu-saldo', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;
    const motorista = await sql`
      SELECT id, nome, saldo_carteira, status_online
      FROM motoristas
      WHERE id = ${motoristaId}
      LIMIT 1;
    `;

    if (motorista.length === 0) {
      return res.status(404).json({ erro: 'Condutor não localizado.' });
    }

    res.json(motorista[0]);
  } catch (err) {
    console.error('Erro ao consultar saldo:', err);
    res.status(500).json({ erro: 'Falha ao obter saldo da carteira.' });
  }
});

// ============================================================================
// 2. GESTÃO DE PEDIDOS (ROTAS ESTÁTICAS)
// ============================================================================

app.post('/api/pedidos', async (req, res) => {
  try {
    const {
      id, clienteId, tipo, subTipoId, subTipoLabel,
      origem, destino, coordsOrigem, coordsDestino,
      distanciaKm, duracaoMin, valorTotal, valorAdicionais, metodoPgto
    } = req.body;

    if (!id || !valorTotal || !origem || !destino) {
      return res.status(400).json({ erro: 'Dados incompletos para registo da viagem.' });
    }

    await sql`
      INSERT INTO pedidos (
        id, cliente_id, tipo, sub_tipo_id, sub_tipo_label,
        origem_endereco, destino_endereco,
        origem_lat, origem_lng, destino_lat, destino_lng,
        distancia_km, duracao_min, valor_total, valor_adicionais,
        metodo_pgto, status
      ) VALUES (
        ${id}, ${clienteId || null}, ${tipo}, ${subTipoId}, ${subTipoLabel},
        ${origem}, ${destino},
        ${coordsOrigem ? coordsOrigem[0] : null}, ${coordsOrigem ? coordsOrigem[1] : null},
        ${coordsDestino ? coordsDestino[0] : null}, ${coordsDestino ? coordsDestino[1] : null},
        ${distanciaKm}, ${duracaoMin}, ${valorTotal}, ${valorAdicionais || 0},
        ${metodoPgto || 'pix_app'}, 'pendente'
      )
    `;

    res.status(201).json({ sucesso: true, id });
  } catch (error) {
    console.error('Erro ao registar pedido:', error);
    res.status(500).json({ erro: 'Falha ao salvar corrida na base de dados.' });
  }
});

app.get('/api/pedidos/pendentes', async (req, res) => {
  try {
    const pedidos = await sql`
      SELECT * FROM pedidos 
      WHERE status = 'pendente' 
      ORDER BY criado_em DESC 
      LIMIT 20
    `;
    res.json(pedidos);
  } catch (error) {
    console.error('Erro ao consultar pedidos pendentes:', error);
    res.status(500).json({ erro: 'Falha ao consultar chamadas.' });
  }
});

app.get('/api/pedidos/historico', autenticarToken, async (req, res) => {
  try {
    const usuarioId = req.usuario.id;
    const role = req.usuario.role;

    let historico;
    if (role === 'motorista') {
      historico = await sql`
        SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, 
               distancia_km, valor_total, status, criado_em
        FROM pedidos
        WHERE motorista_id = ${usuarioId}
        ORDER BY criado_em DESC
        LIMIT 30;
      `;
    } else {
      historico = await sql`
        SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, 
               distancia_km, valor_total, status, criado_em, motorista_nome
        FROM pedidos
        WHERE cliente_id = ${usuarioId}
        ORDER BY criado_em DESC
        LIMIT 30;
      `;
    }

    res.json(historico);
  } catch (err) {
    console.error('Erro ao consultar histórico:', err);
    res.status(500).json({ erro: 'Falha ao obter histórico de viagens.' });
  }
});

// ============================================================================
// 3. PEDIDOS DINÂMICOS (:id)
// ============================================================================

app.get('/api/pedidos/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const pedidos = await sql`
      SELECT id, status, motorista_id, motorista_nome, motorista_telefone, 
             motorista_veiculo, motorista_placa, valor_total, distancia_km
      FROM pedidos 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (pedidos.length === 0) {
      return res.status(404).json({ erro: 'Chamada não localizada.' });
    }

    res.json(pedidos[0]);
  } catch (err) {
    console.error('Erro ao verificar estado da chamada:', err);
    res.status(500).json({ erro: 'Falha ao consultar estado.' });
  }
});

app.put('/api/pedidos/:id/aceitar', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const motoristaId = req.usuario.id;

    const motoristas = await sql`
      SELECT id, nome, telefone, veiculo_modelo, veiculo_placa 
      FROM motoristas 
      WHERE id = ${motoristaId} 
      LIMIT 1;
    `;

    if (motoristas.length === 0) {
      return res.status(404).json({ erro: 'Condutor não localizado.' });
    }

    const mot = motoristas[0];
    const pedidoAtualizado = await sql`
      UPDATE pedidos 
      SET status = 'aceito',
          motorista_id = ${mot.id},
          motorista_nome = ${mot.nome},
          motorista_telefone = ${mot.telefone},
          motorista_veiculo = ${mot.veiculo_modelo || ''},
          motorista_placa = ${mot.veiculo_placa || ''}
      WHERE id = ${id} AND status = 'pendente'
      RETURNING *;
    `;

    if (pedidoAtualizado.length === 0) {
      return res.status(409).json({ erro: 'Este pedido já foi aceito por outro condutor ou cancelado.' });
    }

    res.json({ sucesso: true, pedido: pedidoAtualizado[0] });
  } catch (err) {
    console.error('Erro ao aceitar chamada:', err);
    res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
  }
});

app.put('/api/pedidos/:id/concluir', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const motoristaId = req.usuario.id;

    const pedidos = await sql`
      SELECT id, valor_total, status 
      FROM pedidos 
      WHERE id = ${id} AND motorista_id = ${motoristaId}
      LIMIT 1;
    `;

    if (pedidos.length === 0) {
      return res.status(404).json({ erro: 'Pedido não localizado ou não atribuído a este parceiro.' });
    }

    const pedido = pedidos[0];
    if (pedido.status === 'concluido') {
      return res.status(400).json({ erro: 'Este pedido já foi finalizado.' });
    }

    const valorBruto = Number(pedido.valor_total) || 0;
    const repasseMotorista = Number((valorBruto * 0.85).toFixed(2));
    const taxaPlataforma = Number((valorBruto * 0.15).toFixed(2));

    await sql`UPDATE pedidos SET status = 'concluido' WHERE id = ${id};`;

    const condutorAtualizado = await sql`
      UPDATE motoristas 
      SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista}
      WHERE id = ${motoristaId}
      RETURNING saldo_carteira;
    `;

    res.json({
      sucesso: true,
      mensagem: 'Chamada concluída com sucesso!',
      repasseLiquido: repasseMotorista,
      taxaHuby: taxaPlataforma,
      novoSaldoCarteira: condutorAtualizado[0].saldo_carteira
    });
  } catch (err) {
    console.error('Erro ao concluir corrida:', err);
    res.status(500).json({ erro: 'Falha interna ao processar valores.' });
  }
});

app.put('/api/pedidos/:id/cancelar', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.usuario.id;
    const usuarioRole = req.usuario.role;

    const pedidos = await sql`
      SELECT id, status, cliente_id, motorista_id FROM pedidos WHERE id = ${id} LIMIT 1;
    `;

    if (pedidos.length === 0) {
      return res.status(404).json({ erro: 'Pedido não localizado.' });
    }

    const pedido = pedidos[0];
    if (['concluido', 'cancelado'].includes(pedido.status)) {
      return res.status(400).json({ erro: `O pedido já se encontra como '${pedido.status}'.` });
    }

    const canceladoPor = pedido.cliente_id === usuarioId ? 'cliente' : (pedido.motorista_id === usuarioId ? 'motorista' : 'admin');

    const atualizado = await sql`
      UPDATE pedidos 
      SET status = 'cancelado',
          motivo_cancelamento = ${motivo || 'Cancelado pelo usuário'},
          cancelado_por = ${canceladoPor}
      WHERE id = ${id}
      RETURNING *;
    `;

    res.json({ sucesso: true, mensagem: 'Chamada cancelada.', pedido: atualizado[0] });
  } catch (err) {
    console.error('Erro ao cancelar chamada:', err);
    res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
  }
});

// ============================================================================
// 4. DOCUMENTOS, TRIAGEM E AVALIAÇÕES
// ============================================================================

app.post('/api/motoristas/documentos', autenticarToken, async (req, res) => {
  try {
    const motoristaId = req.usuario.id;
    const { docCnh, docCrlv } = req.body;

    if (!docCnh || !docCrlv) {
      return res.status(400).json({ erro: 'Forneça a foto da CNH e do CRLV.' });
    }

    const atualizado = await sql`
      UPDATE motoristas
      SET doc_cnh_url = ${docCnh},
          doc_crlv_url = ${docCrlv},
          status_aprovacao = 'pendente',
          motivo_recusa = NULL
      WHERE id = ${motoristaId}
      RETURNING id, nome, status_aprovacao;
    `;

    res.json({
      sucesso: true,
      mensagem: 'Documentos submetidos para análise da equipe HUBy.',
      motorista: atualizado[0]
    });
  } catch (err) {
    console.error('Erro no upload de documentos:', err);
    res.status(500).json({ erro: 'Falha ao registrar documentos.' });
  }
});

app.put('/api/admin/motoristas/:id/triagem', autenticarToken, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito à administração.' });
    }

    const { id } = req.params;
    const { acao, motivo } = req.body;

    if (!['aprovar', 'recusar'].includes(acao)) {
      return res.status(400).json({ erro: 'Ação inválida. Utilize aprovar ou recusar.' });
    }

    const novoStatus = acao === 'aprovar' ? 'aprovado' : 'recusado';
    const motivoRecusa = acao === 'recusar' ? (motivo || 'Documentação em desacordo.') : null;

    const mot = await sql`
      UPDATE motoristas
      SET status_aprovacao = ${novoStatus},
          motivo_recusa = ${motivoRecusa}
      WHERE id = ${id}
      RETURNING id, nome, status_aprovacao, motivo_recusa;
    `;

    if (mot.length === 0) {
      return res.status(404).json({ erro: 'Motorista não encontrado.' });
    }

    res.json({ sucesso: true, motorista: mot[0] });
  } catch (err) {
    console.error('Erro na triagem:', err);
    res.status(500).json({ erro: 'Falha ao processar triagem.' });
  }
});

app.post('/api/pedidos/:id/avaliar', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nota, comentario } = req.body;
    const clienteId = req.usuario.id;

    const notaNum = parseInt(nota, 10);
    if (!notaNum || notaNum < 1 || notaNum > 5) {
      return res.status(400).json({ erro: 'A nota deve ser entre 1 e 5.' });
    }

    const pedidos = await sql`SELECT id, motorista_id, status FROM pedidos WHERE id = ${id} LIMIT 1;`;
    if (pedidos.length === 0 || pedidos[0].status !== 'concluido') {
      return res.status(400).json({ erro: 'Apenas corridas concluídas podem ser avaliadas.' });
    }

    await sql`
      INSERT INTO avaliacoes (pedido_id, cliente_id, motorista_id, nota, comentario)
      VALUES (${id}, ${clienteId}, ${pedidos[0].motorista_id}, ${notaNum}, ${comentario || null});
    `;

    if (pedidos[0].motorista_id) {
      const stats = await sql`
        SELECT AVG(nota)::numeric(3,2) AS media, COUNT(*)::int AS total
        FROM avaliacoes WHERE motorista_id = ${pedidos[0].motorista_id};
      `;
      await sql`
        UPDATE motoristas
        SET avaliacao_media = ${stats[0].media}, total_avaliacoes = ${stats[0].total}
        WHERE id = ${pedidos[0].motorista_id};
      `;
    }

    res.json({ sucesso: true, mensagem: 'Avaliação registrada!' });
  } catch (err) {
    console.error('Erro ao avaliar corrida:', err);
    res.status(500).json({ erro: 'Falha ao processar avaliação.' });
  }
});

// ============================================================================
// 5. PAINEL ADMINISTRATIVO & MÉTRICAS
// ============================================================================

app.get('/api/admin/metricas', autenticarToken, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso reservado à administração.' });
    }

    const statsFinanceiro = await sql`
      SELECT 
        COUNT(id) AS total_corridas_concluidas,
        COALESCE(SUM(valor_total), 0) AS faturamento_bruto
      FROM pedidos
      WHERE status = 'concluido';
    `;

    const faturamentoBruto = Number(statsFinanceiro[0].faturamento_bruto || 0);
    const receitaPlataforma = Number((faturamentoBruto * 0.15).toFixed(2));
    const repasseMotoristas = Number((faturamentoBruto * 0.85).toFixed(2));

    const statsUsuarios = await sql`
      SELECT 
        (SELECT COUNT(*) FROM motoristas WHERE status_aprovacao = 'aprovado') AS motoristas_ativos,
        (SELECT COUNT(*) FROM usuarios WHERE role = 'cliente') AS total_clientes,
        (SELECT COUNT(*) FROM pedidos WHERE status = 'pendente') AS chamadas_em_aberto;
    `;

    const ultimasChamadas = await sql`
      SELECT id, status, sub_tipo_label, valor_total, distancia_km, criado_em, motorista_nome
      FROM pedidos
      ORDER BY criado_em DESC
      LIMIT 15;
    `;

    res.json({
      faturamentoBruto,
      receitaPlataforma,
      repasseMotoristas,
      totalCorridas: Number(statsFinanceiro[0].total_corridas_concluidas || 0),
      motoristasAtivos: Number(statsUsuarios[0].motoristas_ativos || 0),
      totalClientes: Number(statsUsuarios[0].total_clientes || 0),
      chamadasEmAberto: Number(statsUsuarios[0].chamadas_em_aberto || 0),
      ultimasChamadas
    });
  } catch (err) {
    console.error('Erro nas métricas admin:', err);
    res.status(500).json({ erro: 'Falha ao extrair métricas do sistema.' });
  }
});

// ============================================================================
// INICIALIZAÇÃO DO SERVIDOR (NA ÚLTIMA LINHA)
// ============================================================================
app.listen(port, () => {
  console.log(`Servidor HUBy 2.0 ativo na porta ${port}`);
});