import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, JWT_SECRET } from '../db.js';

const router = express.Router();

function validarNumeroCPF(cpf) {
  cpf = String(cpf).replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf.charAt(i), 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.charAt(9), 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf.charAt(i), 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  return resto === parseInt(cpf.charAt(10), 10);
}

function validarNumeroCNH(cnh) {
  return String(cnh).replace(/\D/g, '').length === 11;
}

function calcularIdade(dataNascStr) {
  if (!dataNascStr) return 0;
  const hoje = new Date();
  const nasc = new Date(dataNascStr);
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

const processarCadastro = async (req, res) => {
  try {
    const {
      nome, email, telefone, cpf, senha, role = 'cliente',
      dataNascimento, contatoEmergenciaNome, contatoEmergenciaTelefone,
      cnh, categoria, categoria_veiculo,
      veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
      doc_cnh_url, doc_crlv_url 
    } = req.body;

    if (!nome || !senha || (!email && !telefone)) {
      return res.status(400).json({ erro: 'Preencha os campos obrigatórios (Nome, Senha e Contato).' });
    }

    const emailLimpo = email ? String(email).trim().toLowerCase() : null;
    const telLimpo = telefone ? String(telefone).replace(/\D/g, '') : null;
    const cpfLimpo = cpf ? String(cpf).replace(/\D/g, '') : null;

    if (cpfLimpo && !validarNumeroCPF(cpfLimpo)) {
      return res.status(400).json({ erro: 'Número de CPF inválido.' });
    }

    if (dataNascimento && calcularIdade(dataNascimento) < 18) {
      return res.status(400).json({ erro: 'Cadastro negado: É obrigatório ser maior de 18 anos.' });
    }

    const dataNascSql = dataNascimento ? String(dataNascimento).slice(0, 10) : null;
    const salt = await bcrypt.genSalt(10);
    const senhaHash = await bcrypt.hash(String(senha), salt);

    if (role === 'motorista') {
      const cnhLimpa = String(cnh || '').replace(/\D/g, '');
      if (!cnhLimpa || !validarNumeroCNH(cnhLimpa)) {
        return res.status(400).json({ erro: 'Informe um número de CNH válido com 11 dígitos.' });
      }
      if (!veiculo_placa || !veiculo_modelo) {
        return res.status(400).json({ erro: 'Preencha o modelo e a placa do veículo.' });
      }

      const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      const corLimpa = veiculo_cor ? String(veiculo_cor).trim() : 'Não informada';
      const anoLimpo = veiculo_ano ? String(veiculo_ano).trim() : '2022';
      const catFinal = categoria || categoria_veiculo || 'carro';
      const novoId = 'mot_' + Date.now().toString(36);

      // Insere na tabela motoristas já com Modelo, Placa Mercosul, Cor e Ano
      const resultado = await sql`
        INSERT INTO motoristas (
          id, usuario_id, nome, email, telefone, cpf, data_nascimento, senha_hash,
          cnh_numero, categoria, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
          saldo_carteira, status_aprovacao, avaliacao_media, total_corridas,
          doc_cnh_url, doc_crlv_url
        ) VALUES (
          ${novoId}, ${novoId}, ${nome.trim()}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
          ${dataNascSql}, ${senhaHash},
          ${cnhLimpa}, ${catFinal}, ${veiculo_modelo.trim()}, ${placaLimpa}, ${corLimpa}, ${anoLimpo},
          0.00, 'aprovado', 5.00, 0,
          ${doc_cnh_url || null}, ${doc_crlv_url || null}
        )
        RETURNING id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano, categoria;
      `;

      // Insere simultaneamente na tabela usuarios para manter login unificado
      await sql`
        INSERT INTO usuarios (
          id, nome, email, telefone, cpf, data_nascimento, senha_hash, role
        ) VALUES (
          ${novoId}, ${nome.trim()}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo}, ${dataNascSql}, ${senhaHash}, 'motorista'
        )
        ON CONFLICT (id) DO NOTHING;
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

    // Fluxo de Cadastro de PASSAGEIRO (Cliente)
    const novoId = 'usr_' + Date.now().toString(36);
    const resultado = await sql`
      INSERT INTO usuarios (
        id, nome, email, telefone, cpf, data_nascimento,
        contato_emergencia_nome, contato_emergencia_tel,
        senha_hash, role
      ) VALUES (
        ${novoId}, ${nome.trim()}, ${emailLimpo}, ${telLimpo}, ${cpfLimpo},
        ${dataNascSql},
        ${contatoEmergenciaNome ? String(contatoEmergenciaNome).trim() : null},
        ${contatoEmergenciaTelefone ? String(contatoEmergenciaTelefone).trim() : null},
        ${senhaHash}, 'cliente'
      )
      RETURNING id, nome, email, telefone, role;
    `;

    const utilizadorCriado = resultado[0];
    const token = jwt.sign(
      { id: utilizadorCriado.id, nome: utilizadorCriado.nome, role: 'cliente' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ sucesso: true, token, usuario: utilizadorCriado });
  } catch (err) {
    console.error('ERRO DETALHADO NO CADASTRO:', err);
    if (err.message && (err.message.includes('unique constraint') || err.message.includes('conflito'))) {
      return res.status(409).json({ erro: 'Este e-mail, telefone ou CPF já está registrado.' });
    }
    res.status(500).json({ erro: `Erro no Banco: ${err.message}` });
  }
};

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

    if (perfilDesejado === 'motorista') {
      const motoristas = await sql`
        SELECT * FROM motoristas
        WHERE LOWER(TRIM(email)) = ${idLimpo}
           OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
           OR (cnh_numero IS NOT NULL AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
        LIMIT 1;
      `;

      if (motoristas.length === 0) return res.status(404).json({ erro: 'Condutor parceiro não localizado.' });

      const mot = motoristas[0];
      const senhaValida = await bcrypt.compare(String(senha), mot.senha_hash);
      if (!senhaValida) return res.status(401).json({ erro: 'Palavra-passe incorreta.' });

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
          id: mot.id, nome: mot.nome, email: mot.email, telefone: mot.telefone,
          role: 'motorista', veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`, saldo: mot.saldo_carteira
        }
      });
    }

    const usuarios = await sql`
      SELECT * FROM usuarios
      WHERE LOWER(TRIM(email)) = ${idLimpo}
         OR (telefone IS NOT NULL AND regexp_replace(telefone, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
         OR (cpf IS NOT NULL AND regexp_replace(cpf, '\\D', '', 'g') = ${idNumeros} AND ${idNumeros} != '')
      LIMIT 1;
    `;

    if (usuarios.length === 0) return res.status(404).json({ erro: 'Utilizador não localizado.' });

    const usr = usuarios[0];
    const senhaValida = await bcrypt.compare(String(senha), usr.senha_hash);
    if (!senhaValida) return res.status(401).json({ erro: 'Palavra-passe incorreta.' });

    const token = jwt.sign(
      { id: usr.id, nome: usr.nome, email: usr.email, role: usr.role },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ sucesso: true, token, usuario: { id: usr.id, nome: usr.nome, email: usr.email, telefone: usr.telefone, role: usr.role } });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais.' });
  }
};

router.post('/cadastro', processarCadastro);
router.post('/login', processarLogin);

// LOGIN EXCLUSIVO DE MOTORISTA (Sem senha, validação via CNH e Placa)
router.post('/login-motorista', async (req, res) => {
  try {
    const { email, cnh, veiculo_placa } = req.body;
    if (!email || !cnh || !veiculo_placa) return res.status(400).json({ erro: 'Preencha o E-mail, CNH e Placa.' });

    const emailLimpo = String(email).trim().toLowerCase();
    const cnhLimpa = String(cnh).replace(/\D/g, '');
    const placaLimpa = String(veiculo_placa).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    const motoristas = await sql`
      SELECT * FROM motoristas
      WHERE LOWER(TRIM(email)) = ${emailLimpo}
        AND regexp_replace(cnh_numero, '\\D', '', 'g') = ${cnhLimpa}
        AND UPPER(TRIM(veiculo_placa)) = ${placaLimpa}
      LIMIT 1;
    `;

    if (motoristas.length === 0) return res.status(404).json({ erro: 'Nenhum veículo encontrado com estas credenciais.' });

    const mot = motoristas[0];
    await sql`UPDATE motoristas SET status_online = TRUE WHERE id = ${mot.id};`;

    const token = jwt.sign(
      { id: mot.id, nome: mot.nome, role: 'motorista', categoria: mot.categoria },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      sucesso: true, 
      token,
      usuario: { 
        id: mot.id, 
        nome: mot.nome, 
        email: mot.email, 
        telefone: mot.telefone, 
        role: 'motorista', 
        veiculo: `${mot.veiculo_modelo} (${mot.veiculo_placa})`,
        veiculo_modelo: mot.veiculo_modelo,
        veiculo_placa: mot.veiculo_placa,
        veiculo_cor: mot.veiculo_cor,
        veiculo_ano: mot.veiculo_ano,
        saldo: mot.saldo_carteira 
      }
    });
  } catch (err) {
    console.error('Erro no login do motorista:', err);
    res.status(500).json({ erro: 'Falha interna ao validar credenciais do veículo.' });
  }
});

// ============================================================================
// ROTAS DE PERFIL
// ============================================================================

router.get('/perfil', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ erro: 'Não autorizado.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    let user;

    if (payload.role === 'motorista') {
      user = await sql`
        SELECT id, nome, email, telefone, COALESCE(foto_perfil_url, foto_url) AS foto_url,
               veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano
        FROM motoristas WHERE id::text = ${payload.id}::text LIMIT 1;
      `;
    } else {
      user = await sql`
        SELECT id, nome, email, telefone, COALESCE(foto_perfil_url, foto_url) AS foto_url 
        FROM usuarios WHERE id::text = ${payload.id}::text LIMIT 1;
      `;
    }
    
    if (user.length === 0) return res.status(404).json({ erro: 'Utilizador não encontrado.' });
    res.json(user[0]);
  } catch (err) {
    res.status(401).json({ erro: 'Sessão inválida.' });
  }
});

router.put('/perfil', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.split(' ')[1] : null;
  if (!token) return res.status(401).json({ erro: 'Não autorizado.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { nome, foto_url } = req.body; 
    let atualizado;

    if (payload.role === 'motorista') {
      atualizado = await sql`
        UPDATE motoristas
        SET nome = COALESCE(${nome || null}, nome), 
            foto_perfil_url = COALESCE(${foto_url || null}, foto_perfil_url),
            foto_url = COALESCE(${foto_url || null}, foto_url)
        WHERE id::text = ${payload.id}::text
        RETURNING id, nome, email, telefone, foto_perfil_url, veiculo_modelo, veiculo_placa;
      `;
    } else {
      atualizado = await sql`
        UPDATE usuarios
        SET nome = COALESCE(${nome || null}, nome), 
            foto_perfil_url = COALESCE(${foto_url || null}, foto_perfil_url),
            foto_url = COALESCE(${foto_url || null}, foto_url)
        WHERE id::text = ${payload.id}::text
        RETURNING id, nome, email, telefone, foto_perfil_url;
      `;
    }

    res.json({ sucesso: true, mensagem: 'Perfil atualizado com sucesso!', usuario: atualizado[0] });
  } catch (err) {
    console.error('ERRO CRÍTICO AO ATUALIZAR PERFIL:', err);
    res.status(500).json({ erro: `Erro ao salvar alterações: ${err.message}` });
  }
});

export default router;