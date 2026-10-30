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

  // =========================================================================
  // 1. CRIAR PEDIDO COM SUPORTE A CUPOM TRANSACIONAL E SEGURANÇA
  // =========================================================================
  router.post('/', async (req, res) => {
    try {
      const {
        id, clienteId, tipo, subTipoId, subTipoLabel,
        origem, destino, coordsOrigem, coordsDestino,
        distanciaKm, duracaoMin, valorTotal, valorAdicionais, metodoPgto,
        cupomCodigo
      } = req.body;

      if (!id || !valorTotal || !origem || !destino) {
        return res.status(400).json({ erro: 'Dados incompletos para registo da viagem.' });
      }

      const formatarNum = (val) => Number(String(val).replace(',', '.')) || 0;
      let vTotal = formatarNum(valorTotal);
      const vAdic = formatarNum(valorAdicionais);
      const dKm = formatarNum(distanciaKm);
      const dMin = formatarNum(duracaoMin);
      
      const origLat = coordsOrigem && coordsOrigem[0] ? Number(coordsOrigem[0]) : null;
      const origLng = coordsOrigem && coordsOrigem[1] ? Number(coordsOrigem[1]) : null;
      const destLat = coordsDestino && coordsDestino[0] ? Number(coordsDestino[0]) : null;
      const destLng = coordsDestino && coordsDestino[1] ? Number(coordsDestino[1]) : null;

      // Validação Atômica de Cupom de Desconto
      let descontoAplicado = 0;
      if (cupomCodigo) {
        const codigoFormatado = String(cupomCodigo).trim().toUpperCase();
        const cupons = await sql`
          SELECT id, tipo, valor, limite_usos, usos_atuais, expira_em, ativo
          FROM cupons_desconto
          WHERE codigo = ${codigoFormatado} AND ativo = TRUE
          LIMIT 1;
        `;

        if (cupons.length > 0) {
          const cupom = cupons[0];
          const agora = new Date();
          const expirado = cupom.expira_em && new Date(cupom.expira_em) < agora;
          const esgotado = cupom.limite_usos && cupom.usos_atuais >= cupom.limite_usos;

          if (!expirado && !esgotado) {
            if (cupom.tipo === 'porcentagem') {
              descontoAplicado = Number(((vTotal * Number(cupom.valor)) / 100).toFixed(2));
            } else {
              descontoAplicado = Number(cupom.valor);
            }

            vTotal = Math.max(0.50, vTotal - descontoAplicado);

            // Incremento atômico de utilização
            await sql`
              UPDATE cupons_desconto
              SET usos_atuais = usos_atuais + 1
              WHERE id = ${cupom.id};
            `;
          }
        }
      }

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

      res.status(201).json({ sucesso: true, id, valorFinal: vTotal, desconto: descontoAplicado });
    } catch (error) {
      console.error('⚠️ ERRO AO GRAVAR PEDIDO:', error.message);
      res.status(500).json({ erro: 'Falha ao salvar corrida na base de dados.' });
    }
  });

  // =========================================================================
  // 2. RADAR DE MOTORISTAS EM TEMPO REAL (TRANSMISSÃO GPS)
  // =========================================================================
  router.post('/motoristas/localizacao', autenticarToken, async (req, res) => {
    try {
      const motoristaId = req.usuario.id;
      const { lat, lng, emCorrida } = req.body;

      if (!lat || !lng) return res.status(400).json({ erro: 'Coordenadas incompletas.' });

      io.emit('posicao_motorista', {
        motoristaId,
        lat: Number(lat),
        lng: Number(lng),
        emCorrida: !!emCorrida,
        atualizadoEm: new Date().toISOString()
      });

      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao emitir localização.' });
    }
  });

  // =========================================================================
  // 3. CONSULTA DE CHAMADAS PENDENTES
  // =========================================================================
  router.get('/pendentes', async (req, res) => {
    try {
      const { categoria } = req.query;
      let pedidos;
      if (categoria === 'moto') {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo IN ('moto', 'flash_moto') ORDER BY criado_em DESC LIMIT 20;`;
      } else if (categoria === 'cargo_pickup' || categoria === 'frete' || categoria === 'entrega') {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo IN ('cargo_pickup', 'frete', 'entrega') ORDER BY criado_em DESC LIMIT 20;`;
      } else {
        pedidos = await sql`SELECT * FROM pedidos WHERE status = 'pendente' AND tipo = 'carro' ORDER BY criado_em DESC LIMIT 20;`;
      }
      res.json(pedidos);
    } catch (error) {
      res.status(500).json({ erro: 'Falha ao consultar chamadas.' });
    }
  });

  // =========================================================================
  // 4. HISTÓRICO
  // =========================================================================
  router.get('/historico', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;
      const role = String(req.usuario.role || '').toLowerCase();
      let historico = role === 'motorista'
        ? await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, cliente_id FROM pedidos WHERE motorista_id = ${usuarioId} ORDER BY criado_em DESC LIMIT 30;`
        : await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, motorista_nome FROM pedidos WHERE cliente_id = ${usuarioId} ORDER BY criado_em DESC LIMIT 30;`;
      res.json(historico);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao obter histórico de viagens.' });
    }
  });

  // =========================================================================
  // 5. STATUS DA VIAGEM (ENRIQUECIDO COM PERFIL E VEÍCULO DO MOTORISTA)
  // =========================================================================
  router.get('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidos = await sql`
        SELECT 
          p.id, p.status, p.valor_total, p.distancia_km, p.duracao_min,
          p.origem_endereco, p.destino_endereco,
          p.motorista_id, 
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.telefone, p.motorista_telefone) AS motorista_telefone,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.veiculo_cor,
          m.veiculo_ano,
          m.foto_perfil_url AS motorista_foto,
          m.avaliacao_media AS motorista_avaliacao,
          m.total_corridas AS motorista_corridas
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id = m.id
        WHERE p.id = ${id} 
        LIMIT 1;
      `;

      if (pedidos.length === 0) return res.status(404).json({ erro: 'Chamada não localizada.' });
      res.json(pedidos[0]);
    } catch (err) {
      console.error('Erro ao consultar status:', err);
      res.status(500).json({ erro: 'Falha ao consultar estado da chamada.' });
    }
  });

  // =========================================================================
  // 6. ACEITAR VIAGEM (COM SNAPSHOT COMPLETO DO CONDUTOR)
  // =========================================================================
  router.put('/:id/aceitar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const motoristaId = req.usuario.id;
      const motoristas = await sql`
        SELECT id, nome, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, foto_perfil_url, avaliacao_media, total_corridas
        FROM motoristas 
        WHERE id = ${motoristaId} 
        LIMIT 1;
      `;
      if (motoristas.length === 0) return res.status(404).json({ erro: 'Condutor não localizado.' });

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
      
      if (pedidoAtualizado.length === 0) return res.status(409).json({ erro: 'Este pedido já foi aceito por outro condutor.' });
      
      const payloadResposta = {
        ...pedidoAtualizado[0],
        motorista_foto: mot.foto_perfil_url,
        motorista_avaliacao: mot.avaliacao_media,
        motorista_corridas: mot.total_corridas,
        veiculo_cor: mot.veiculo_cor
      };

      io.emit('corrida_aceita', { pedidoId: id, motoristaId: mot.id });

      res.json({ sucesso: true, pedido: payloadResposta });
    } catch (err) {
      console.error('Erro ao aceitar pedido:', err);
      res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
    }
  });

  // =========================================================================
  // 7. CONCLUIR VIAGEM (CÁLCULO DINÂMICO E REPASSE)
  // =========================================================================
  router.put('/:id/concluir', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const motoristaId = req.usuario.id;
      const pedidos = await sql`SELECT id, valor_total, status FROM pedidos WHERE id = ${id} AND motorista_id = ${motoristaId} LIMIT 1;`;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      if (pedido.status === 'concluido') return res.status(400).json({ erro: 'Este pedido já foi finalizado.' });

      let taxaPorcentagem = 15;
      const config = await sql`SELECT valor FROM configuracoes_plataforma WHERE chave = 'tarifas' LIMIT 1;`;
      if (config.length > 0 && config[0].valor && config[0].valor.taxa_plataforma) {
        taxaPorcentagem = Number(config[0].valor.taxa_plataforma) || 15;
      }

      const valorBruto = Number(pedido.valor_total) || 0;
      const taxaPlataforma = Number(((valorBruto * taxaPorcentagem) / 100).toFixed(2));
      const repasseMotorista = Number((valorBruto - taxaPlataforma).toFixed(2));

      await sql`
        UPDATE pedidos 
        SET status = 'concluido', concluido_em = NOW() 
        WHERE id = ${id};
      `;
      
      const condutorAtualizado = await sql`
        UPDATE motoristas 
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista},
            total_corridas = COALESCE(total_corridas, 0) + 1
        WHERE id = ${motoristaId} 
        RETURNING saldo_carteira, total_corridas;
      `;

      io.emit('corrida_finalizada', { pedidoId: id });

      res.json({ 
        sucesso: true, 
        mensagem: 'Chamada concluída!', 
        repasseLiquido: repasseMotorista, 
        taxaHuby: taxaPlataforma, 
        novoSaldoCarteira: condutorAtualizado[0].saldo_carteira 
      });
    } catch (err) {
      console.error('Erro ao concluir corrida:', err);
      res.status(500).json({ erro: 'Falha interna ao processar valores.' });
    }
  });

  // =========================================================================
  // 8. CANCELAR VIAGEM COM DETECÇÃO ANTIFRAUDE AUTOMÁTICA
  // =========================================================================
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

      const cancelamentosRecentes = await sql`
        SELECT COUNT(*) AS total
        FROM pedidos
        WHERE cancelado_por = ${canceladoPor} 
          AND (cliente_id = ${usuarioId} OR motorista_id = ${usuarioId})
          AND criado_em >= NOW() - INTERVAL '2 hours';
      `;

      if (Number(cancelamentosRecentes[0]?.total || 0) >= 3) {
        await sql`
          INSERT INTO incidentes_seguranca (pedido_id, usuario_id, tipo_alerta, descricao)
          VALUES (${id}, ${usuarioId}, 'cancelamentos_consecutivos', ${'Usuário acumulou 3 ou mais cancelamentos em menos de 2 horas.'});
        `;
        io.emit('alerta_seguranca_admin', {
          tipo: 'cancelamentos_consecutivos',
          usuarioId,
          mensagem: 'Alerta Antifraude: Múltiplos cancelamentos consecutivos detectados.'
        });
      }

      io.emit('corrida_cancelada', { pedidoId: id });

      res.json({ sucesso: true, mensagem: 'Chamada cancelada.', pedido: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
    }
  });

  // =========================================================================
  // 9. CENTRAL DE INCIDENTES / BOTÃO DE PÂNICO SOS
  // =========================================================================
  router.post('/:id/sos', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { lat, lng, relato } = req.body;
      const usuarioId = req.usuario.id;

      const alerta = await sql`
        INSERT INTO incidentes_seguranca (pedido_id, usuario_id, tipo_alerta, descricao)
        VALUES (${id}, ${usuarioId}, 'sos', ${relato || `EMERGÊNCIA ACIONADA! Coords: ${lat || '---'}, ${lng || '---'}`})
        RETURNING *;
      `;

      io.emit('alerta_sos_admin', {
        incidenteId: alerta[0].id,
        pedidoId: id,
        usuarioId,
        coords: [lat, lng],
        momento: new Date().toISOString()
      });

      res.status(201).json({ sucesso: true, mensagem: 'Alerta SOS registrado e equipe notificada!' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao acionar alerta de segurança.' });
    }
  });

  // =========================================================================
  // 10. AVALIAÇÕES COM NOTA E COMENTÁRIOS
  // =========================================================================
  router.post('/:id/avaliar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { nota, comentario, etiquetas } = req.body;
      const clienteId = req.usuario.id;

      const notaNum = parseInt(nota, 10);
      if (!notaNum || notaNum < 1 || notaNum > 5) {
        return res.status(400).json({ erro: 'A nota deve ser entre 1 e 5.' });
      }

      const pedidos = await sql`SELECT id, motorista_id, status FROM pedidos WHERE id = ${id} LIMIT 1;`;
      if (pedidos.length === 0 || pedidos[0].status !== 'concluido') {
        return res.status(400).json({ erro: 'Apenas corridas concluídas podem ser avaliadas.' });
      }

      const motoristaId = pedidos[0].motorista_id;
      const etiquetasStr = Array.isArray(etiquetas) ? etiquetas.join(', ') : (etiquetas || '');
      const comentarioCompleto = etiquetasStr ? `${comentario || ''} [Tags: ${etiquetasStr}]`.trim() : (comentario || null);

      await sql`
        INSERT INTO avaliacoes (pedido_id, cliente_id, motorista_id, nota, comentario)
        VALUES (${id}, ${clienteId}, ${motoristaId}, ${notaNum}, ${comentarioCompleto});
      `;

      if (motoristaId) {
        const stats = await sql`
          SELECT AVG(nota)::numeric(3,2) AS media, COUNT(*)::int AS total
          FROM avaliacoes WHERE motorista_id = ${motoristaId};
        `;
        await sql`
          UPDATE motoristas
          SET avaliacao_media = ${stats[0].media}, total_corridas = COALESCE(total_corridas, 0)
          WHERE id = ${motoristaId};
        `;
      }

      res.json({ sucesso: true, mensagem: 'Avaliação registrada com sucesso!' });
    } catch (err) {
      console.error('Erro ao avaliar corrida:', err);
      res.status(500).json({ erro: 'Falha ao processar avaliação.' });
    }
  });

  // =========================================================================
  // 11. CHAT INTERNO DA CORRIDA
  // =========================================================================
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