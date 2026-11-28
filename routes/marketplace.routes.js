// routes/marketplace.routes.js - HUBy Clube & Parcerias
import express from 'express';
import { sql } from '../db.js';
import { autenticarToken } from './pedidos.routes.js';

const router = express.Router();

// Middleware: validação de Admin para as rotas de gestão
function verificarAdmin(req, res, next) {
  const role = String(req.usuario?.role || req.usuario?.funcao || '').toLowerCase();
  if (role !== 'admin' && role !== 'administrador') {
    return res.status(403).json({ erro: 'Acesso restrito à administração.' });
  }
  next();
}

const COLUNAS_NECESSARIAS = [
  'id', 'categoria', 'titulo', 'empresa_nome', 'descricao', 'preco_original', 'preco_parceiro',
  'desconto_percentual', 'imagem_url', 'whatsapp_contato', 'endereco', 'ativo', 'criado_em'
];

// Inicialização segura da tabela no banco Neon.
// O banco tinha uma versão antiga da tabela, sem algumas colunas (ex.: empresa_nome).
// - Tabela antiga e VAZIA: é recriada no formato certo.
// - Tabela antiga COM itens: só ganha as colunas que faltam (nada é apagado).
async function inicializarMarketplace() {
  try {
    const colunas = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'marketplace_parceiros';
    `;
    const existentes = new Set(colunas.map((c) => c.column_name));
    const faltando = COLUNAS_NECESSARIAS.filter((c) => !existentes.has(c));

    if (existentes.size > 0 && faltando.length > 0) {
      const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM marketplace_parceiros;`;
      if (Number(total) === 0) {
        await sql`DROP TABLE marketplace_parceiros;`;
        console.log('Marketplace: tabela antiga (vazia) recriada no formato novo.');
      } else {
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'oficina';`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS titulo VARCHAR(120);`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS empresa_nome VARCHAR(100);`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS descricao TEXT DEFAULT '';`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS preco_original NUMERIC(10,2);`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS preco_parceiro NUMERIC(10,2) DEFAULT 0;`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS desconto_percentual INT DEFAULT 0;`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS imagem_url TEXT;`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS whatsapp_contato VARCHAR(20);`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS endereco TEXT;`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;`;
        await sql`ALTER TABLE marketplace_parceiros ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;`;
        console.log('Marketplace: colunas que faltavam foram adicionadas.');
      }
    }

    await sql`
      CREATE TABLE IF NOT EXISTS marketplace_parceiros (
        id SERIAL PRIMARY KEY,
        categoria VARCHAR(50) NOT NULL,
        titulo VARCHAR(120) NOT NULL,
        empresa_nome VARCHAR(100) NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        preco_original NUMERIC(10,2),
        preco_parceiro NUMERIC(10,2) NOT NULL DEFAULT 0,
        desconto_percentual INT DEFAULT 0,
        imagem_url TEXT,
        whatsapp_contato VARCHAR(20) NOT NULL,
        endereco TEXT,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    // Sem itens de exemplo: parceiros de mentira (com WhatsApp falso) enganariam os motoristas.
    // Cadastre os parceiros reais pelo painel admin.
  } catch (err) {
    console.warn('Aviso ao preparar a tabela do marketplace:', err.message);
  }
}
inicializarMarketplace();

// Função auxiliar para formatar números que vêm como string do Postgres
const formatarItens = (itens) => {
  return itens.map(i => ({
    ...i,
    preco_original: Number(i.preco_original || 0),
    preco_parceiro: Number(i.preco_parceiro || 0),
    desconto_percentual: Number(i.desconto_percentual || 0)
  }));
};

function idValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ============================================================================
// ROTAS PÚBLICAS (Aplicativo do Motorista)
// ============================================================================

// Listagem dos itens/benefícios para os motoristas
router.get('/itens', autenticarToken, async (req, res) => {
  try {
    const categoria = String(req.query.categoria || '').trim().slice(0, 50);
    let itens;

    if (categoria && categoria !== 'todos') {
      itens = await sql`
        SELECT * FROM marketplace_parceiros
        WHERE ativo = TRUE AND categoria = ${categoria}
        ORDER BY id ASC;
      `;
    } else {
      itens = await sql`
        SELECT * FROM marketplace_parceiros
        WHERE ativo = TRUE
        ORDER BY id ASC;
      `;
    }

    return res.json(formatarItens(itens || []));
  } catch (err) {
    console.error('Erro ao buscar marketplace:', err);
    return res.status(500).json({ erro: 'Falha ao buscar itens da loja.' });
  }
});

// ============================================================================
// ROTAS ADMINISTRATIVAS (Painel Master)
// ============================================================================

// Listar TUDO (incluindo desativados) para o admin
router.get('/admin/itens', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const itens = await sql`SELECT * FROM marketplace_parceiros ORDER BY criado_em DESC;`;
    return res.json(formatarItens(itens || []));
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao listar marketplace.' });
  }
});

// Criar nova parceria/benefício
router.post('/admin/itens', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const {
      categoria,
      titulo,
      empresa_nome,
      descricao,
      preco_original,
      preco_parceiro,
      imagem_url,
      whatsapp_contato,
      endereco
    } = req.body || {};

    const tituloLimpo = String(titulo || '').trim().slice(0, 120);
    const empresaLimpa = String(empresa_nome || '').trim().slice(0, 100);
    const whatsSeguro = String(whatsapp_contato || '').replace(/\D/g, '').slice(0, 13);

    if (!tituloLimpo || !empresaLimpa || !whatsSeguro) {
      return res.status(400).json({ erro: 'Título, empresa e WhatsApp são obrigatórios.' });
    }
    if (whatsSeguro.length < 10) {
      return res.status(400).json({ erro: 'WhatsApp inválido. Use DDD + número (ex.: 89999999999).' });
    }

    const precoOrigNum = Math.max(0, Number(String(preco_original ?? '').replace(',', '.')) || 0);
    const precoParcNum = Math.max(0, Number(String(preco_parceiro ?? '').replace(',', '.')) || 0);

    let desconto = 0;
    if (precoOrigNum > 0 && precoParcNum < precoOrigNum) {
      desconto = Math.round(((precoOrigNum - precoParcNum) / precoOrigNum) * 100);
    }

    // Imagem: só link https (ou nenhuma)
    const imgBruta = String(imagem_url || '').trim();
    if (imgBruta && !/^https:\/\/[^\s"'<>]{5,500}$/.test(imgBruta)) {
      return res.status(400).json({ erro: 'A imagem precisa ser um link que comece com https://' });
    }
    const imgSegura = imgBruta || null;

    const endSeguro = String(endereco || '').trim().slice(0, 200) || 'Atendimento Local';
    const catSegura = String(categoria || 'oficina').trim().toLowerCase().slice(0, 50) || 'oficina';
    const descSegura = String(descricao || '').trim().slice(0, 1000);

    const novo = await sql`
      INSERT INTO marketplace_parceiros
        (categoria, titulo, empresa_nome, descricao, preco_original, preco_parceiro, desconto_percentual, imagem_url, whatsapp_contato, endereco)
      VALUES
        (${catSegura}, ${tituloLimpo}, ${empresaLimpa}, ${descSegura}, ${precoOrigNum}, ${precoParcNum}, ${desconto}, ${imgSegura}, ${whatsSeguro}, ${endSeguro})
      RETURNING *;
    `;
    res.status(201).json({ sucesso: true, item: formatarItens(novo)[0] });
  } catch (err) {
    console.error('Erro ao cadastrar parceria:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar novo item no banco de dados.' });
  }
});

// Ocultar/Exibir item
router.put('/admin/itens/:id/toggle', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Item inválido.' });

    const atualizado = await sql`
      UPDATE marketplace_parceiros SET ativo = NOT ativo WHERE id = ${id} RETURNING id, ativo;
    `;
    if (!atualizado.length) return res.status(404).json({ erro: 'Item não encontrado.' });
    res.json({ sucesso: true, item: atualizado[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao alternar status do item.' });
  }
});

// Remover benefício
router.delete('/admin/itens/:id', autenticarToken, verificarAdmin, async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ erro: 'Item inválido.' });

    await sql`DELETE FROM marketplace_parceiros WHERE id = ${id};`;
    res.json({ sucesso: true, mensagem: 'Item excluído com sucesso.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao deletar item.' });
  }
});

export default router;