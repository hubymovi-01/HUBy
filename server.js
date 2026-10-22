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

// CORS configurado para aceitar requisições locais do Live Server
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

if (!process.env.DATABASE_URL) {
  console.warn('AVISO: DATABASE_URL não definida nas variáveis de ambiente.');
}

const sql = neon(process.env.DATABASE_URL);

// Middleware para validar tokens JWT
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

// Rota de verificação de integridade da API
app.get('/', (req, res) => {
  res.json({ status: 'HUBy API Online', versao: '2.0.0', banco: 'Neon PostgreSQL' });
});

// ============================================================================
// 1. AUTENTICAÇÃO UNIFICADA: PASSAGEIROS E ADMINISTRADORES
// ============================================================================

// Registo de Passageiro
app.post('/api/auth/cadastro', async (req, res) => {
  try {
    const { nome, email, telefone, cpf, senha } = req.body;

    if (!nome || !email || !telefone || !senha) {
      return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(String(senha), salt);

    const resultado = await sql`
      INSERT INTO usuarios (nome, email, telefone, cpf, senha_hash, role)
      VALUES (
        ${nome.trim()},
        ${emailLimpo},
        ${telefone.trim()},
        ${cpf ? String(cpf).replace(/\D/g, '') : null},
        ${senhaHash},
        'cliente'
      )
      RETURNING id, nome, email, telefone, role;
    `;

    const utilizadorCriado = resultado[0];
    const token = jwt.sign(
      { id: utilizadorCriado.id, email: utilizadorCriado.email, role: utilizadorCriado.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      sucesso: true,
      token,
      usuario: utilizadorCriado
    });
  } catch (err) {
    console.error('Erro no registo de utilizador:', err);
    if (err.message && err.message.includes('unique constraint')) {
      return res.status(409).json({ erro: 'Este e-mail ou CPF já se encontra registado.' });
    }
    res.status(500).json({ erro: 'Falha ao concluir registo na base de dados.' });
  }
});

// Login Unificado (Passageiro ou Admin)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Indique o e-mail e a palavra-passe.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();

    const resultado = await sql`
      SELECT id, nome, email, telefone, role, senha_hash
      FROM usuarios
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
      LIMIT 1;
    `;

    if (resultado.length === 0) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const utilizador = resultado[0];
    const senhaCorreta = await bcrypt.compare(String(senha), utilizador.senha_hash);

    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { id: utilizador.id, email: utilizador.email, role: utilizador.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      sucesso: true,
      token,
      usuario: {
        id: utilizador.id,
        nome: utilizador.nome,
        email: utilizador.email,
        telefone: utilizador.telefone,
        role: utilizador.role
      }
    });
  } catch (err) {
    console.error('Erro no login de utilizador:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
  }
});

// ============================================================================
// 2. AUTENTICAÇÃO E GESTÃO DE PARCEIROS / CONDUTORES
// ============================================================================

// Login do Condutor (via CNH e Matrícula/Placa)
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
      { expiresIn: '7d' }
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

// Consultar saldo e resumo financeiro do parceiro
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
    console.error('Erro ao consultar saldo do parceiro:', err);
    res.status(500).json({ erro: 'Falha ao obter saldo da carteira.' });
  }
});

// ============================================================================
// 3. ROTAS DE PEDIDOS (ROTAS ESTÁTICAS PRIMEIRO)
// ============================================================================

// Criar Pedido
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
    res.status(500).json({ erro: 'Falha ao guardar corrida na base de dados.' });
  }
});

// Listar Pedidos Pendentes (Radar de condutores)
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

// Histórico de Viagens (Passageiro ou Motorista) - DEVE FICAR ANTES DE /:id
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
// 4. ROTAS DE PEDIDOS DINÂMICAS (COM PARÂMETRO :id)
// ============================================================================

// Polling de Status da chamada pelo passageiro
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

// Motorista aceita a chamada
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
      return res.status(409).json({ erro: 'Este pedido já foi aceite por outro condutor ou cancelado.' });
    }

    res.json({ sucesso: true, pedido: pedidoAtualizado[0] });
  } catch (err) {
    console.error('Erro ao aceitar chamada:', err);
    res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
  }
});

// Concluir Corrida e creditar 85% para o parceiro
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
      return res.status(400).json({ erro: 'Este pedido já foi finalizado anteriormente.' });
    }

    const valorBruto = Number(pedido.valor_total) || 0;
    const repasseMotorista = Number((valorBruto * 0.85).toFixed(2));
    const taxaPlataforma = Number((valorBruto * 0.15).toFixed(2));

    await sql`
      UPDATE pedidos 
      SET status = 'concluido'
      WHERE id = ${id};
    `;

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
    console.error('Erro ao concluir corrida e liquidar repasse:', err);
    res.status(500).json({ erro: 'Falha interna ao concluir e processar valores.' });
  }
});

// Cancelamento Inteligente de Chamada (Cliente, Motorista ou Admin)
app.put('/api/pedidos/:id/cancelar', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const usuarioId = req.usuario.id;
    const usuarioRole = req.usuario.role;

    const pedidos = await sql`
      SELECT id, status, cliente_id, motorista_id 
      FROM pedidos 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (pedidos.length === 0) {
      return res.status(404).json({ erro: 'Pedido não localizado.' });
    }

    const pedido = pedidos[0];

    if (['concluido', 'cancelado'].includes(pedido.status)) {
      return res.status(400).json({ erro: `O pedido já se encontra com status '${pedido.status}'.` });
    }

    const ehDono = pedido.cliente_id === usuarioId;
    const ehCondutor = pedido.motorista_id === usuarioId;
    const ehAdmin = usuarioRole === 'admin';

    if (!ehDono && !ehCondutor && !ehAdmin) {
      return res.status(403).json({ erro: 'Sem autorização para cancelar esta corrida.' });
    }

    const canceladoPor = ehDono ? 'cliente' : (ehCondutor ? 'motorista' : 'admin');

    const atualizado = await sql`
      UPDATE pedidos 
      SET status = 'cancelado',
          motivo_cancelamento = ${motivo || 'Cancelado pelo utilizador'},
          cancelado_por = ${canceladoPor}
      WHERE id = ${id}
      RETURNING *;
    `;

    res.json({
      sucesso: true,
      mensagem: 'Chamada cancelada com sucesso.',
      pedido: atualizado[0]
    });
  } catch (err) {
    console.error('Erro ao cancelar chamada:', err);
    res.status(500).json({ erro: 'Falha interna ao processar cancelamento.' });
  }
});

// ============================================================================
// 5. PAINEL ADMINISTRATIVO E MÉTRICAS
// ============================================================================

app.get('/api/admin/metricas', autenticarToken, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso reservado exclusivamente à administração.' });
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
// INICIALIZAÇÃO DO SERVIDOR (SEMPRE NA ÚLTIMA LINHA)
// ============================================================================
app.listen(port, () => {
  console.log(`Servidor HUBy 2.0 ativo na porta ${port}`);
});
// ============================================================================
// 7. GESTÃO DE DOCUMENTOS, AUDITORIA ADMIN E AVALIAÇÕES
// ============================================================================

// 7.1 Motorista envia documentos (URLs ou base64)
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

// 7.2 Administrador aprova ou recusa motorista
app.put('/api/admin/motoristas/:id/triagem', autenticarToken, async (req, res) => {
  try {
    if (req.usuario.role !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito à administração.' });
    }

    const { id } = req.params;
    const { acao, motivo } = req.body; // acao: 'aprovar' ou 'recusar'

    if (!['aprovar', 'recusar'].includes(acao)) {
      return res.status(400).json({ erro: 'Ação inválida. Utilize aprovar ou recusar.' });
    }

    const novoStatus = acao === 'aprovar' ? 'aprovado' : 'recusado';
    const motivoRecusa = acao === 'recusar' ? (motivo || 'Documentação em desacordo com as regras.') : null;

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
    console.error('Erro na triagem de motorista:', err);
    res.status(500).json({ erro: 'Falha ao processar triagem.' });
  }
});

// 7.3 Passageiro avalia a corrida (1 a 5 estrelas)
app.post('/api/pedidos/:id/avaliar', autenticarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nota, comentario } = req.body;
    const clienteId = req.usuario.id;

    const notaNum = parseInt(nota, 10);
    if (!notaNum || notaNum < 1 || notaNum > 5) {
      return res.status(400).json({ erro: 'A nota deve ser um número inteiro de 1 a 5.' });
    }

    // Busca o pedido para resgatar o condutor
    const pedidos = await sql`
      SELECT id, motorista_id, status FROM pedidos WHERE id = ${id} LIMIT 1;
    `;

    if (pedidos.length === 0) {
      return res.status(404).json({ erro: 'Corrida não encontrada.' });
    }

    const pedido = pedidos[0];
    if (pedido.status !== 'concluido') {
      return res.status(400).json({ erro: 'Apenas corridas concluídas podem ser avaliadas.' });
    }

    // Registra avaliação
    await sql`
      INSERT INTO avaliacoes (pedido_id, cliente_id, motorista_id, nota, comentario)
      VALUES (${id}, ${clienteId}, ${pedido.motorista_id}, ${notaNum}, ${comentario || null});
    `;

    // Recalcula média do condutor
    if (pedido.motorista_id) {
      const stats = await sql`
        SELECT AVG(nota)::numeric(3,2) AS media, COUNT(*)::int AS total
        FROM avaliacoes
        WHERE motorista_id = ${pedido.motorista_id};
      `;

      await sql`
        UPDATE motoristas
        SET avaliacao_media = ${stats[0].media},
            total_avaliacoes = ${stats[0].total}
        WHERE id = ${pedido.motorista_id};
      `;
    }

    res.json({ sucesso: true, mensagem: 'Avaliação registrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao avaliar corrida:', err);
    res.status(500).json({ erro: 'Falha ao processar avaliação.' });
  }
});