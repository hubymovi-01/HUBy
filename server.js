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

// Configuração ampla de CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));

if (!process.env.DATABASE_URL) {
  console.warn('AVISO CRÍTICO: DATABASE_URL não definida nas variáveis de ambiente.');
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

// Inicialização automática das tabelas essenciais no Neon
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

    console.log('Tabelas sincronizadas no Neon PostgreSQL.');
  } catch (e) {
    console.error('Aviso ao sincronizar tabelas:', e.message);
  }
}
inicializarBanco();

// Verificação de saúde da API
app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online', versao: '2.0.0', banco: 'Neon PostgreSQL' });
});

// ============================================================================
// 1. AUTENTICAÇÃO UNIFICADA: PASSAGEIROS & MOTORISTAS
// ============================================================================

// CADASTRO (Atende /api/usuarios/cadastro e /api/auth/cadastro)
const handlerCadastro = async (req, res) => {
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
        return res.status(400).json({ erro: 'Para motorista parceiro, informe CNH, Modelo e Placa.' });
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

    // Cadastro de Passageiro
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
    console.error('Erro no registo de utilizador:', err);
    if (err.message && err.message.includes('unique constraint')) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está cadastrado.' });
    }
    res.status(500).json({ erro: 'Falha ao concluir registo na base de dados.' });
  }
};

app.post('/api/usuarios/cadastro', handlerCadastro);
app.post('/api/auth/cadastro', handlerCadastro);

// LOGIN (Atende /api/usuarios/login e /api/auth/login)
const handlerLogin = async (req, res) => {
  try {
    const identificador = req.body.identificador || req.body.emailOuTelefone || req.body.email;
    const senha = req.body.senha;
    const perfilDesejado = req.body.perfilDesejado || 'cliente';

    if (!identificador || !senha) {
      return res.status(400).json({ erro: 'Indique seu acesso (E-mail, Telefone ou CPF) e a senha.' });
    }

    const idLimpo = String(identificador).trim().toLowerCase();
    const idNumeros = String(identificador).replace(/\D/g, '');

    // 1. Se estiver tentando logar na aba de Motorista
    if (perfilDesejado === 'motorista') {
      const motoristas = await sql`
        SELECT * FROM motoristas
        WHERE LOWER(TRIM(email)) = ${idLimpo}
           OR regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros}
           OR regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros}
           OR regexp_replace(cnh_numero, '\\D', '', 'g') = ${idNumeros}
        LIMIT 1;
      `;

      if (motoristas.length === 0) {
        return res.status(404).json({ erro: 'Condutor não encontrado. Verifique os dados ou crie sua conta de parceiro.' });
      }

      const mot = motoristas[0];
      const senhaValida = await bcrypt.compare(String(senha), mot.senha_hash);
      if (!senhaValida) {
        return res.status(401).json({ erro: 'Senha incorreta.' });
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

    // 2. Login de Passageiro / Admin
    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros}
         OR regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros}
      LIMIT 1;
    `;

    if (usuarios.length === 0) {
      return res.status(404).json({ erro: 'Usuário não cadastrado.' });
    }

    const usr = usuarios[0];
    const senhaValida = await bcrypt.compare(String(senha), usr.senha_hash);
    if (!senhaValida) {
      return res.status(401).json({ erro: 'Senha incorreta.' });
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

app.post('/api/usuarios/login', handlerLogin);
app.post('/api/auth/login', handlerLogin);

// ============================================================================
// 2. PARCEIROS & ROTAS DE SALDO
// ============================================================================

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
// 3. ROTAS DE PEDIDOS (ROTAS ESTÁTICAS ANTES DE /:id)
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
// 4. ROTAS DE PEDIDOS COM PARÂMETRO DINÂMICO (:id)
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
// 5. AVALIAÇÕES E DOCUMENTOS
// ============================================================================

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
// 6. PAINEL ADMINISTRATIVO
// ============================================================================

app.get('/api/admin/metricas', autenticarToken, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso reservado à administração.' });
    }

    const stats = await sql`
      SELECT COUNT(id) AS total_corridas, COALESCE(SUM(valor_total), 0) AS faturamento
      FROM pedidos WHERE status = 'concluido';
    `;

    res.json({
      faturamentoBruto: Number(stats[0].faturamento || 0),
      totalCorridas: Number(stats[0].total_corridas || 0)
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro nas métricas.' });
  }
});

// ============================================================================
// INICIALIZAÇÃO DO SERVIDOR (ÚLTIMA LINHA OBRIGATÓRIA)
// ============================================================================
app.listen(port, () => {
  console.log(`Servidor HUBy 2.0 ativo na porta ${port}`);
});