import express from 'express';
import { sql, JWT_SECRET } from '../db.js';
import jwt from 'jsonwebtoken';

export function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : req.query.token;

  if (!token) return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

export default function pedidosRouter(io) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const {
        id, clienteId, tipo, subTipoId, subTipoLabel,
        origem, destino, coordsOrigem, coordsDestino,
        distanciaKm, duracaoMin, valorTotal, valorAdicionais, metodoPgto
      } = req.body;

      if (!id || !valorTotal || !origem || !destino) {
        return res.status(400).json({ erro: 'Dados incompletos para registo da viagem.' });
      }

      const formatarNum = (val) => Number(String(val).replace(',', '.')) || 0;
      const vTotal = formatarNum(valorTotal);
      const vAdic = formatarNum(valorAdicionais);
      const dKm = formatarNum(distanciaKm);
      const dMin = formatarNum(duracaoMin);
      
      const origLat = coordsOrigem && coordsOrigem[0] ? Number(coordsOrigem[0]) : null;
      const origLng = coordsOrigem && coordsOrigem[1] ? Number(coordsOrigem[1]) : null;
      const destLat = coordsDestino && coordsDestino[0] ? Number(coordsDestino[0]) : null;
      const destLng = coordsDestino && coordsDestino[1] ? Number(coordsDestino[1]) : null;

      await sql`
        INSERT INTO pedidos (
          id, cliente_id, tipo, sub_tipo_id, sub_tipo_label,
          origem_endereco, destino_endereco,
          origem_lat, origem_lng, destino_lat, destino_lng,
          distancia_km, duracao_min, valor_total, valor_adicionais,
          metodo_pgto, status
        ) VALUES (
          ${id}, ${clienteId || null}, ${tipo || 'carro'}, ${subTipoId || null}, ${subTipoLabel || 'Carro Padrão'},
          ${origem}, ${destino},
          ${origLat}, ${origLng}, ${destLat}, ${destLng},
          ${dKm}, ${dMin}, ${vTotal}, ${vAdic},
          ${metodoPgto || 'pix_app'}, 'pendente'
        )
      `;

      io.emit('nova_chamada', {
        id, clienteId, tipo, subTipoLabel, origem, destino, distanciaKm: dKm, duracaoMin: dMin, valorTotal: vTotal
      });

      res.status(201).json({ sucesso: true, id });
    } catch (error) {
      console.error('⚠️ ERRO AO GRAVAR PEDIDO:', error.message);
      res.status(500).json({ erro: 'Falha ao salvar corrida na base de dados.' });
    }
  });

  router.get('/pendentes', async (req, res) => {
    try {
      const { categoria } = req.query;
      let pedidos;
      if (categoria === 'moto') {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo IN ('moto', 'flash_moto') ORDER BY criado_em DESC LIMIT 20;`;
      } else if (categoria === 'cargo_pickup' || categoria === 'frete') {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo IN ('cargo_pickup', 'frete') ORDER BY criado_em DESC LIMIT 20;`;
      } else {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo = 'carro' ORDER BY criado_em DESC LIMIT 20;`;
      }
      res.json(pedidos);
    } catch (error) {
      res.status(500).json({ erro: 'Falha ao consultar chamadas.' });
    }
  });

  router.get('/historico', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;
      const role = req.usuario.role;
      let historico = role === 'motorista'
        ? await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, cliente_id FROM pedidos WHERE motorista_id = ${usuarioId} ORDER BY criado_em DESC LIMIT 30;`
        : await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, motorista_nome FROM pedidos WHERE cliente_id = ${usuarioId} ORDER BY criado_em DESC LIMIT 30;`;
      res.json(historico);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao obter histórico de viagens.' });
    }
  });

  router.get('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidos = await sql`SELECT id, status, motorista_id, motorista_nome, motorista_telefone, motorista_veiculo, motorista_placa, valor_total, distancia_km FROM pedidos WHERE id = ${id} LIMIT 1;`;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Chamada não localizada.' });
      res.json(pedidos[0]);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao consultar estado.' });
    }
  });

  router.put('/:id/aceitar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const motoristaId = req.usuario.id;
      const motoristas = await sql`SELECT id, nome, telefone, veiculo_modelo, veiculo_placa FROM motoristas WHERE id = ${motoristaId} LIMIT 1;`;
      if (motoristas.length === 0) return res.status(404).json({ erro: 'Condutor não localizado.' });

      const mot = motoristas[0];
      const pedidoAtualizado = await sql`
        UPDATE pedidos 
        SET status = 'aceito', motorista_id = ${mot.id}, motorista_nome = ${mot.nome}, motorista_telefone = ${mot.telefone}, motorista_veiculo = ${mot.veiculo_modelo || ''}, motorista_placa = ${mot.veiculo_placa || ''}
        WHERE id = ${id} AND status = 'pendente'
        RETURNING *;
      `;
      if (pedidoAtualizado.length === 0) return res.status(409).json({ erro: 'Este pedido já foi aceito por outro condutor.' });
      res.json({ sucesso: true, pedido: pedidoAtualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
    }
  });

  router.put('/:id/concluir', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const motoristaId = req.usuario.id;
      const pedidos = await sql`SELECT id, valor_total, status FROM pedidos WHERE id = ${id} AND motorista_id = ${motoristaId} LIMIT 1;`;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      if (pedido.status === 'concluido') return res.status(400).json({ erro: 'Este pedido já foi finalizado.' });

      const valorBruto = Number(pedido.valor_total) || 0;
      const repasseMotorista = Number((valorBruto * 0.85).toFixed(2));
      const taxaPlataforma = Number((valorBruto * 0.15).toFixed(2));

      await sql`UPDATE pedidos SET status = 'concluido' WHERE id = ${id};`;
      const condutorAtualizado = await sql`UPDATE motoristas SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista} WHERE id = ${motoristaId} RETURNING saldo_carteira;`;

      res.json({ sucesso: true, mensagem: 'Chamada concluída!', repasseLiquido: repasseMotorista, taxaHuby: taxaPlataforma, novoSaldoCarteira: condutorAtualizado[0].saldo_carteira });
    } catch (err) {
      res.status(500).json({ erro: 'Falha interna ao processar valores.' });
    }
  });

  router.put('/:id/cancelar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { motivo } = req.body;
      const usuarioId = req.usuario.id;
      const pedidos = await sql`SELECT id, status, cliente_id, motorista_id FROM pedidos WHERE id = ${id} LIMIT 1;`;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      const canceladoPor = pedido.cliente_id === usuarioId ? 'cliente' : (pedido.motorista_id === usuarioId ? 'motorista' : 'admin');
      const atualizado = await sql`UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = ${motivo || 'Cancelado'}, cancelado_por = ${canceladoPor} WHERE id = ${id} RETURNING *;`;
      res.json({ sucesso: true, mensagem: 'Chamada cancelada.', pedido: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
    }
  });

  // Chat interno
  router.post('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { mensagem } = req.body;
      const remetenteId = req.usuario.id;
      const remetenteNome = req.usuario.nome;

      if (!mensagem) return res.status(400).json({ erro: 'A mensagem não pode estar vazia.' });

      await sql`INSERT INTO mensagens_chat (pedido_id, remetente_id, remetente_nome, mensagem) VALUES (${id}, ${remetenteId}, ${remetenteNome}, ${mensagem})`;
      io.emit('nova_mensagem', { pedido_id: id });
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar o envio.' });
    }
  });

  router.get('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const mensagens = await sql`SELECT remetente_id, remetente_nome, mensagem, enviado_em FROM mensagens_chat WHERE pedido_id = ${id} ORDER BY enviado_em ASC`;
      res.json(mensagens);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao sincronizar mensagens.' });
    }
  });

  return router;
}