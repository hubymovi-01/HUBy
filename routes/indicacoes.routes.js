// routes/indicacoes.routes.js - Programa Indique e Ganhe HUBy (Bônus Bilateral Passageiro & Motorista)
import express from 'express';
import crypto from 'crypto';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

const BONUS_INDICADOR = 5.00;
const DESCONTO_INDICADO = 5.00;

export async function garantirEstruturaIndicacoes() {
  try {
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_indicacao VARCHAR(20) UNIQUE;`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS indicado_por_codigo VARCHAR(20);`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS saldo_bonus NUMERIC(10,2) DEFAULT 0.00;`;

    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS codigo_indicacao VARCHAR(20) UNIQUE;`;
    await sql`ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS indicado_por_codigo VARCHAR(20);`;

    await sql`
      CREATE TABLE IF NOT EXISTS indicacoes_huby (
        id SERIAL PRIMARY KEY,
        indicador_id TEXT NOT NULL,
        indicador_role VARCHAR(20) NOT NULL,
        indicador_nome VARCHAR(120),
        indicado_id TEXT NOT NULL UNIQUE,
        indicado_nome VARCHAR(120),
        codigo_usado VARCHAR(20) NOT NULL,
        valor_bonus_indicador NUMERIC(10,2) DEFAULT 5.00,
        valor_desconto_indicado NUMERIC(10,2) DEFAULT 5.00,
        status VARCHAR(20) DEFAULT 'pendente',
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        pago_em TIMESTAMP WITH TIME ZONE
      );
    `;
  } catch (err) {
    console.warn('Aviso ao sincronizar tabelas de indicações:', err.message);
  }
}
garantirEstruturaIndicacoes();

export async function obterOuGerarCodigoUsuario(usuarioId, role = 'cliente') {
  await garantirEstruturaIndicacoes();
  const ehMot = String(role).toLowerCase() === 'motorista';

  if (ehMot) {
    const reg = await sql`SELECT id, nome, codigo_indicacao FROM motoristas WHERE id::text = ${String(usuarioId)}::text OR usuario_id::text = ${String(usuarioId)}::text LIMIT 1;`;
    if (!reg.length) return null;
    if (reg[0].codigo_indicacao) return reg[0].codigo_indicacao;

    const novoCod = `HUBY-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    await sql`UPDATE motoristas SET codigo_indicacao = ${novoCod} WHERE id = ${reg[0].id};`;
    await sql`UPDATE usuarios SET codigo_indicacao = ${novoCod} WHERE id::text = ${String(usuarioId)}::text;`.catch(() => {});
    return novoCod;
  } else {
    const reg = await sql`SELECT id, nome, codigo_indicacao FROM usuarios WHERE id::text = ${String(usuarioId)}::text LIMIT 1;`;
    if (!reg.length) return null;
    if (reg[0].codigo_indicacao) return reg[0].codigo_indicacao;

    const novoCod = `HUBY-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    await sql`UPDATE usuarios SET codigo_indicacao = ${novoCod} WHERE id = ${reg[0].id};`;
    return novoCod;
  }
}

export async function registrarIndicacaoNoCadastro({ novoUsuarioId, novoUsuarioNome, codigoConvite }) {
  if (!codigoConvite) return;
  try {
    await garantirEstruturaIndicacoes();
    const codLimpo = String(codigoConvite).trim().toUpperCase();

    let indicadorId = null;
    let indicadorRole = 'cliente';
    let indicadorNome = '';

    const mot = await sql`SELECT id, nome FROM motoristas WHERE UPPER(codigo_indicacao) = ${codLimpo} LIMIT 1;`;
    if (mot.length) {
      indicadorId = String(mot[0].id);
      indicadorRole = 'motorista';
      indicadorNome = mot[0].nome;
    } else {
      const usr = await sql`SELECT id, nome, role FROM usuarios WHERE UPPER(codigo_indicacao) = ${codLimpo} LIMIT 1;`;
      if (usr.length) {
        indicadorId = String(usr[0].id);
        indicadorRole = String(usr[0].role || 'cliente');
        indicadorNome = usr[0].nome;
      }
    }

    if (!indicadorId || indicadorId === String(novoUsuarioId)) return;

    await sql`
      INSERT INTO indicacoes_huby (
        indicador_id, indicador_role, indicador_nome,
        indicado_id, indicado_nome, codigo_usado,
        valor_bonus_indicador, valor_desconto_indicado, status
      ) VALUES (
        ${indicadorId}, ${indicadorRole}, ${indicadorNome},
        ${String(novoUsuarioId)}, ${novoUsuarioNome}, ${codLimpo},
        ${BONUS_INDICADOR}, ${DESCONTO_INDICADO}, 'pendente'
      )
      ON CONFLICT (indicado_id) DO NOTHING;
    `;
  } catch (err) {
    console.warn('Erro ao vincular indicação:', err.message);
  }
}

export async function liquidarBonusIndicacaoPrimeiraCorrida(clienteId) {
  if (!clienteId) return;
  try {
    await garantirEstruturaIndicacoes();
    const pend = await sql`
      SELECT * FROM indicacoes_huby
      WHERE indicado_id = ${String(clienteId)} AND status = 'pendente'
      LIMIT 1;
    `;
    if (!pend.length) return;

    const ind = pend[0];
    const bonus = Number(ind.valor_bonus_indicador || BONUS_INDICADOR);

    const marcada = await sql`
      UPDATE indicacoes_huby
      SET status = 'pago', pago_em = CURRENT_TIMESTAMP
      WHERE id = ${ind.id} AND status = 'pendente'
      RETURNING id;
    `;
    if (!marcada.length) return;

    if (ind.indicador_role === 'motorista') {
      await sql`
        UPDATE motoristas
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${bonus}
        WHERE id::text = ${ind.indicador_id}::text OR usuario_id::text = ${ind.indicador_id}::text;
      `;
    } else {
      await sql`
        UPDATE usuarios
        SET saldo_bonus = COALESCE(saldo_bonus, 0) + ${bonus}
        WHERE id::text = ${ind.indicador_id}::text;
      `;
    }
  } catch (err) {
    console.warn('Erro ao liquidar bônus de indicação:', err.message);
  }
}

router.get('/meu-codigo', autenticarToken, async (req, res) => {
  try {
    const usuarioId = String(req.usuario.id);
    const role = String(req.usuario.role || 'cliente');
    const codigo = await obterOuGerarCodigoUsuario(usuarioId, role);

    const indicados = await sql`
      SELECT id, indicado_nome, valor_bonus_indicador, status, criado_em, pago_em
      FROM indicacoes_huby
      WHERE indicador_id = ${usuarioId}
      ORDER BY criado_em DESC
      LIMIT 30;
    `;

    const totalGanho = indicados
      .filter(i => i.status === 'pago')
      .reduce((acc, i) => acc + Number(i.valor_bonus_indicador || 0), 0);

    let saldoBonusCliente = 0;
    if (role !== 'motorista') {
      const u = await sql`SELECT COALESCE(saldo_bonus, 0) AS sb FROM usuarios WHERE id::text = ${usuarioId}::text LIMIT 1;`;
      saldoBonusCliente = Number(u[0]?.sb || 0);
    }

    res.json({
      sucesso: true,
      codigo,
      bonusPorIndicacao: BONUS_INDICADOR,
      descontoAmigo: DESCONTO_INDICADO,
      totalGanho,
      saldoBonusCliente,
      indicados
    });
  } catch (err) {
    res.status(500).json({ erro: 'Falha ao carregar programa Indique e Ganhe.' });
  }
});

export default router;