// ./api/pedidos.js
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Configuração de cabeçalhos CORS para permitir chamadas do próprio app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verifica se a variável de conexão está definida
  if (!process.env.DATABASE_URL) {
    return res.status(500).json({ erro: 'DATABASE_URL não configurada no ambiente.' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // 1. CRIAR NOVO PEDIDO (Cliente chama corrida)
    if (req.method === 'POST') {
      const { id, tipo, subTipoLabel, origem, destino, distancia, preco, metodoPgto } = req.body;

      if (!id || !preco) {
        return res.status(400).json({ erro: 'Dados incompletos para criação do pedido.' });
      }

      await sql`
        INSERT INTO pedidos (id, tipo, sub_tipo_label, origem, destino, distancia, preco, metodo_pgto, status)
        VALUES (${id}, ${tipo}, ${subTipoLabel}, ${origem}, ${destino}, ${distancia}, ${preco}, ${metodoPgto}, 'pendente')
      `;

      return res.status(201).json({ sucesso: true, mensagem: 'Pedido registado no Neon com sucesso!' });
    }

    // 2. LISTAR PEDIDOS ATIVOS (Motorista ou Admin a carregar fila)
    if (req.method === 'GET') {
      const statusFiltro = req.query.status || 'pendente';
      const resultados = await sql`
        SELECT * FROM pedidos 
        WHERE status = ${statusFiltro}
        ORDER BY criado_em DESC
        LIMIT 20
      `;

      return res.status(200).json(resultados);
    }

    // 3. ATUALIZAR STATUS (Motorista aceita ou rejeita pedido)
    if (req.method === 'PATCH') {
      const { id, novoStatus } = req.body;

      if (!id || !novoStatus) {
        return res.status(400).json({ erro: 'ID e novo status são obrigatórios.' });
      }

      await sql`
        UPDATE pedidos
        SET status = ${novoStatus}
        WHERE id = ${id}
      `;

      return res.status(200).json({ sucesso: true, mensagem: `Pedido #${id} atualizado para ${novoStatus}` });
    }

    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro na rota /api/pedidos:', error);
    return res.status(500).json({ erro: 'Erro interno ao consultar o Neon Database.', detalhes: error.message });
  }
}