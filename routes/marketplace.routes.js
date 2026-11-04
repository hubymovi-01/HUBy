// routes/marketplace.routes.js - HUBy Clube & Parcerias
import express from 'express';
import { sql } from '../db.js';

const router = express.Router();

// Inicialização segura da tabela no banco Neon
async function inicializarMarketplace() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS marketplace_parceiros (
        id SERIAL PRIMARY KEY,
        categoria VARCHAR(50) NOT NULL,
        titulo VARCHAR(120) NOT NULL,
        empresa_nome VARCHAR(100) NOT NULL,
        descricao TEXT NOT NULL,
        preco_original NUMERIC(10,2),
        preco_parceiro NUMERIC(10,2) NOT NULL,
        desconto_percentual INT DEFAULT 0,
        imagem_url TEXT,
        whatsapp_contato VARCHAR(20) NOT NULL,
        endereco TEXT,
        ativo BOOLEAN DEFAULT TRUE,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    const qtd = await sql`SELECT COUNT(*)::int AS total FROM marketplace_parceiros;`;
    if (qtd && qtd[0] && qtd[0].total === 0) {
      await sql`
        INSERT INTO marketplace_parceiros 
          (categoria, titulo, empresa_nome, descricao, preco_original, preco_parceiro, desconto_percentual, imagem_url, whatsapp_contato, endereco)
        VALUES
          ('adesivos', 'Kit Oficial Adesivo HUBy + QR Code', 'HUBy Design', 'Kit de identificação para vidro e laterais. Ganhe prioridade de chamadas!', 120.00, 49.90, 58, 'https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=400&q=80', '5589999999999', 'Centro - São João do Piauí'),
          ('oficina', 'Troca de Óleo + Filtro + Checkup Geral', 'Auto Center Parceiro', 'Revisão com óleo sintético e desconto para condutores ativos.', 190.00, 139.90, 26, 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?auto=format&fit=crop&w=400&q=80', '5589999999999', 'Av. Cândido Coelho'),
          ('guincho', 'Socorro Mecânico & Reboque 24h', 'Guincho Ágil', 'Atendimento emergencial na cidade e região com tarifa exclusiva HUBy.', 200.00, 120.00, 40, 'https://images.unsplash.com/photo-1580273916550-e323be2ae537?auto=format&fit=crop&w=400&q=80', '5589999999999', 'Base Central');
      `;
    }
  } catch (err) {
    console.warn('Tabela marketplace já sincronizada:', err.message);
  }
}
inicializarMarketplace();

// Rota de listagem pública dos itens/benefícios
router.get('/itens', async (req, res) => {
  try {
    const { categoria } = req.query;
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
    return res.json(itens || []);
  } catch (err) {
    console.error('Erro ao buscar marketplace:', err);
    return res.status(500).json({ erro: 'Falha ao buscar itens da loja.' });
  }
});

export default router;