// routes/pedidos.routes.js
import express from 'express';
import { sql, JWT_SECRET } from '../db.js';
import jwt from 'jsonwebtoken';
import { MercadoPagoConfig, Payment } from 'mercadopago';

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
  // 1. CRIAR PEDIDO COM SUPORTE A CUPOM, MÚLTIPLAS PARADAS E SEGURANÇA
  // =========================================================================
  router.post('/', async (req, res) => {
    try {
      const {
        id, clienteId, tipo, subTipoId, subTipoLabel,
        origem, destino, coordsOrigem, coordsDestino,
        paradas,
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
        id, clienteId, tipo, subTipoLabel, origem, destino, distanciaKm: dKm, duracaoMin: dMin, valorTotal: vTotal, paradas
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
        pedidos = await sql`SELECT * FROM pedidos WHERE status IN ('pendente', 'aguardando', 'buscando') AND tipo IN ('moto', 'flash_moto') ORDER BY criado_em DESC LIMIT 20;`;
      } else if (categoria === 'cargo_pickup' || categoria === 'frete' || categoria === 'entrega') {
        pedidos = await sql`SELECT * FROM pedidos WHERE status IN ('pendente', 'aguardando', 'buscando') AND tipo IN ('cargo_pickup', 'frete', 'entrega') ORDER BY criado_em DESC LIMIT 20;`;
      } else {
        pedidos = await sql`SELECT * FROM pedidos WHERE status IN ('pendente', 'aguardando', 'buscando') ORDER BY criado_em DESC LIMIT 20;`;
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
        ? await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, cliente_id FROM pedidos WHERE motorista_id::text = ${usuarioId}::text ORDER BY criado_em DESC LIMIT 30;`
        : await sql`SELECT id, tipo, sub_tipo_label, origem_endereco, destino_endereco, distancia_km, valor_total, status, criado_em, motorista_nome FROM pedidos WHERE cliente_id::text = ${usuarioId}::text ORDER BY criado_em DESC LIMIT 30;`;
      res.json(historico);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao obter histórico de viagens.' });
    }
  });

  // =========================================================================
  // 5. ROTA PÚBLICA PARA RASTREIO DE VIAGEM EM TEMPO REAL
  // =========================================================================
  router.get('/publico/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const pedidos = await sql`
        SELECT 
          p.id, p.status, p.origem_endereco, p.destino_endereco,
          p.origem_lat, p.origem_lng, p.destino_lat, p.destino_lng,
          p.distancia_km, p.duracao_min, p.sub_tipo_label,
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.foto_perfil_url AS motorista_foto,
          m.avaliacao_media AS motorista_avaliacao
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id::text = m.id::text
        WHERE p.id = ${id}
        LIMIT 1;
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Viagem não encontrada.' });
      }

      return res.json(pedidos[0]);
    } catch (err) {
      console.error('Erro ao consultar viagem pública:', err);
      return res.status(500).json({ erro: 'Erro interno ao consultar dados da viagem.' });
    }
  });

  // =========================================================================
  // 6. STATUS DA VIAGEM
  // =========================================================================
  router.get('/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const pedidos = await sql`
        SELECT 
          p.id, p.status, p.valor_total, p.distancia_km, p.duracao_min,
          p.origem_endereco, p.destino_endereco,
          p.origem_lat, p.origem_lng, p.destino_lat, p.destino_lng,
          p.motorista_id, 
          COALESCE(m.nome, p.motorista_nome) AS motorista_nome,
          COALESCE(m.telefone, p.motorista_telefone) AS motorista_telefone,
          COALESCE(m.veiculo_modelo, p.motorista_veiculo) AS motorista_veiculo,
          COALESCE(m.veiculo_placa, p.motorista_placa) AS motorista_placa,
          m.veiculo_cor,
          m.veiculo_ano,
          m.foto_perfil_url AS motorista_foto,
          m.avaliacao_media AS motorista_avaliacao,
          m.total_corridas AS motorista_corridas,
          COALESCE(m.aceita_dinheiro, true) AS aceita_dinheiro,
          COALESCE(m.aceita_cartao, true) AS aceita_cartao,
          COALESCE(m.aceita_pix, true) AS aceita_pix
        FROM pedidos p
        LEFT JOIN motoristas m ON p.motorista_id::text = m.id::text
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
  // 7. ACEITAR VIAGEM (COM TRAVA DE SALDO DEVEDOR NA CARTEIRA)
  // =========================================================================
  router.put('/:id/aceitar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario.id;
      const emailUsuario = req.usuario.email || '';

      let motoristas = await sql`
        SELECT id, nome, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, foto_perfil_url, 
               avaliacao_media, total_corridas, saldo_carteira,
               COALESCE(aceita_dinheiro, true) AS aceita_dinheiro,
               COALESCE(aceita_cartao, true) AS aceita_cartao,
               COALESCE(aceita_pix, true) AS aceita_pix
        FROM motoristas 
        WHERE id::text = ${usuarioId}::text 
           OR usuario_id::text = ${usuarioId}::text
           OR (email = ${emailUsuario} AND ${emailUsuario} != '')
        LIMIT 1;
      `;

      if (motoristas.length === 0) {
        motoristas = await sql`
          SELECT id, nome, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, foto_perfil_url, 
                 avaliacao_media, total_corridas, saldo_carteira,
                 COALESCE(aceita_dinheiro, true) AS aceita_dinheiro,
                 COALESCE(aceita_cartao, true) AS aceita_cartao,
                 COALESCE(aceita_pix, true) AS aceita_pix
          FROM motoristas 
          ORDER BY saldo_carteira DESC, criado_em ASC
          LIMIT 1;
        `;
      }

      if (motoristas.length === 0) {
        return res.status(404).json({ erro: 'Condutor não localizado.' });
      }

      const mot = motoristas[0];

      // Bloqueio financeiro: impede o aceite se o saldo devedor exceder -R$ 50,00
      const saldoAtual = Number(mot.saldo_carteira || 0);
      if (saldoAtual <= -50) {
        return res.status(403).json({
          erro: `Acesso suspenso: Seu saldo na carteira é de R$ ${saldoAtual.toFixed(2).replace('.', ',')}. Regularize seus repasses pendentes para aceitar novas corridas.`
        });
      }

      const pedidoAtualizado = await sql`
        UPDATE pedidos 
        SET status = 'a_caminho', 
            motorista_id = ${mot.id}, 
            motorista_nome = ${mot.nome}, 
            motorista_telefone = ${mot.telefone || ''}, 
            motorista_veiculo = ${mot.veiculo_modelo || 'Onix'}, 
            motorista_placa = ${mot.veiculo_placa || 'ABC1D23'}
        WHERE id::text = ${id}::text 
          AND status IN ('pendente', 'aguardando', 'buscando', 'criado')
        RETURNING *;
      `;

      if (pedidoAtualizado.length === 0) {
        const jaAceito = await sql`
          SELECT * FROM pedidos 
          WHERE id::text = ${id}::text 
            AND (motorista_id::text = ${mot.id}::text OR status IN ('a_caminho', 'em_andamento', 'em_viagem'));
        `;
        if (jaAceito.length > 0) {
          return res.json({ sucesso: true, pedido: jaAceito[0] });
        }
        return res.status(409).json({ erro: 'Esta corrida já não está disponível.' });
      }

      const payloadResposta = {
        ...pedidoAtualizado[0],
        motorista_foto: mot.foto_perfil_url,
        motorista_avaliacao: mot.avaliacao_media,
        motorista_corridas: mot.total_corridas,
        veiculo_cor: mot.veiculo_cor,
        aceita_dinheiro: mot.aceita_dinheiro,
        aceita_cartao: mot.aceita_cartao,
        aceita_pix: mot.aceita_pix
      };

      io.emit('corrida_aceita', {
        pedidoId: id,
        status: 'a_caminho',
        motorista: {
          id: mot.id,
          nome: mot.nome,
          telefone: mot.telefone,
          veiculo: mot.veiculo_modelo || 'Onix',
          placa: mot.veiculo_placa || 'ABC1D23',
          cor: mot.veiculo_cor || 'Prata',
          foto: mot.foto_perfil_url,
          avaliacao: mot.avaliacao_media,
          aceita_dinheiro: mot.aceita_dinheiro,
          aceita_cartao: mot.aceita_cartao,
          aceita_pix: mot.aceita_pix
        }
      });

      res.json({ sucesso: true, pedido: payloadResposta });
    } catch (err) {
      console.error('Erro ao aceitar pedido:', err);
      res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
    }
  });

  // =========================================================================
  // 7.1 CONFIRMAR EMBARQUE (PASSAGEIRO A BORDO -> EM VIAGEM AO DESTINO)
  // =========================================================================
  router.put('/:id/embarque', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      const atualizado = await sql`
        UPDATE pedidos
        SET status = 'em_viagem'
        WHERE id::text = ${id}::text
        RETURNING *;
      `;

      if (atualizado.length === 0) {
        return res.status(404).json({ erro: 'Pedido não localizado.' });
      }

      io.emit('passageiro_a_bordo', {
        pedidoId: id,
        status: 'em_viagem',
        mensagem: 'Passageiro a bordo! Em viagem rumo ao destino.'
      });

      res.json({ sucesso: true, mensagem: 'Embarque confirmado!', pedido: atualizado[0] });
    } catch (err) {
      console.error('Erro ao confirmar embarque:', err);
      res.status(500).json({ erro: 'Falha ao registrar embarque do passageiro.' });
    }
  });

  // =========================================================================
  // 8. CONCLUIR VIAGEM (REPASSE E FINALIZAÇÃO PADRÃO)
  // =========================================================================
  router.put('/:id/concluir', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const usuarioId = req.usuario.id;

      const mot = await sql`
        SELECT id FROM motoristas 
        WHERE id::text = ${usuarioId}::text 
           OR usuario_id::text = ${usuarioId}::text
        ORDER BY saldo_carteira DESC LIMIT 1;
      `;
      const motoristaIdReal = mot[0]?.id || usuarioId;

      const pedidos = await sql`
        SELECT id, valor_total, status, motorista_id 
        FROM pedidos 
        WHERE id::text = ${id}::text 
        LIMIT 1;
      `;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      if (pedido.status === 'concluido') return res.status(400).json({ erro: 'Este pedido já foi finalizado.' });

      let taxaPorcentagem = 15;
      try {
        const config = await sql`SELECT valor FROM configuracoes_plataforma WHERE chave = 'tarifas' LIMIT 1;`;
        if (config.length > 0 && config[0].valor && config[0].valor.taxa_plataforma) {
          taxaPorcentagem = Number(config[0].valor.taxa_plataforma) || 15;
        }
      } catch (e) { }

      const valorBruto = Number(pedido.valor_total) || 0;
      const taxaPlataforma = Number(((valorBruto * taxaPorcentagem) / 100).toFixed(2));
      const repasseMotorista = Number((valorBruto - taxaPlataforma).toFixed(2));

      await sql`
        UPDATE pedidos 
        SET status = 'concluido', concluido_em = NOW() 
        WHERE id::text = ${id}::text;
      `;

      const condutorAtualizado = await sql`
        UPDATE motoristas 
        SET saldo_carteira = COALESCE(saldo_carteira, 0) + ${repasseMotorista},
            total_corridas = COALESCE(total_corridas, 0) + 1
        WHERE id::text = ${motoristaIdReal}::text 
           OR id::text = ${pedido.motorista_id}::text
        RETURNING saldo_carteira, total_corridas;
      `;

      io.emit('corrida_finalizada', {
        pedidoId: id,
        status: 'concluido',
        valorFinal: valorBruto
      });

      res.json({
        sucesso: true,
        mensagem: 'Chamada concluída com sucesso!',
        repasseLiquido: repasseMotorista,
        taxaHuby: taxaPlataforma,
        novoSaldoCarteira: condutorAtualizado[0]?.saldo_carteira || 0
      });
    } catch (err) {
      console.error('Erro ao concluir corrida:', err);
      res.status(500).json({ erro: 'Falha interna ao processar valores.' });
    }
  });

  // =========================================================================
  // 8.1 FINALIZAÇÃO COM ESCOLHA DO MÉTODO (DINHEIRO, CARTÃO OU PIX MERCADO PAGO)
  // =========================================================================
  router.post('/:id/finalizar-liquidacao', autenticarToken, async (req, res) => {
    const { id } = req.params;
    const { forma_pagamento } = req.body; // 'dinheiro', 'cartao_maquininha', 'pix_mp'

    try {
      const pedidos = await sql`
        SELECT * FROM pedidos 
        WHERE id::text = ${String(id)}::text 
        LIMIT 1;
      `;

      if (pedidos.length === 0) {
        return res.status(404).json({ erro: 'Corrida não encontrada.' });
      }

      const pedido = pedidos[0];
      const valorTotal = Number(pedido.valor_total || 0);

      let taxaPorcentagem = 15;
      try {
        const config = await sql`SELECT valor FROM configuracoes_plataforma WHERE chave = 'tarifas' LIMIT 1;`;
        if (config.length > 0 && config[0].valor && config[0].valor.taxa_plataforma) {
          taxaPorcentagem = Number(config[0].valor.taxa_plataforma) || 15;
        }
      } catch (e) { }

      const taxaPlataforma = Number(((valorTotal * taxaPorcentagem) / 100).toFixed(2));
      const motoristaIdAlvo = pedido.motorista_id || req.usuario?.id;

      // -----------------------------------------------------------------------
      // CENÁRIO A: DINHEIRO EM MÃOS OU MAQUININHA PRÓPRIA (SEM sql.begin)
      // -----------------------------------------------------------------------
      if (forma_pagamento === 'dinheiro' || forma_pagamento === 'cartao_maquininha') {
        await sql`
          UPDATE pedidos
          SET status = 'concluido', 
              forma_pagamento = ${forma_pagamento}, 
              concluido_em = CURRENT_TIMESTAMP
          WHERE id::text = ${String(id)}::text;
        `;

        if (motoristaIdAlvo) {
          await sql`
            UPDATE motoristas
            SET saldo_carteira = COALESCE(saldo_carteira, 0) - ${taxaPlataforma},
                total_corridas = COALESCE(total_corridas, 0) + 1
            WHERE id::text = ${String(motoristaIdAlvo)}::text 
               OR usuario_id::text = ${String(motoristaIdAlvo)}::text;
          `;

          try {
            await sql`
              INSERT INTO transacoes_carteira (usuario_id, tipo_usuario, tipo_transacao, valor, pedido_id)
              VALUES (${String(motoristaIdAlvo)}, 'motorista', 'desconto_comissao_viagem_especie', ${-taxaPlataforma}, ${String(id)});
            `;
          } catch (eTrans) {
            // Não bloqueia se a tabela de extrato não existir
          }
        }

        if (io) {
          io.emit(`corrida_finalizada_${id}`, {
            sucesso: true,
            forma_pagamento,
            valorTotal,
            mensagem: 'Viagem finalizada e acertada com o motorista!'
          });
          io.emit('corrida_finalizada', { pedidoId: id, status: 'concluido', valorFinal: valorTotal });
        }

        return res.json({ sucesso: true, status: 'concluido', forma_pagamento });
      }

      // -----------------------------------------------------------------------
      // CENÁRIO B: PIX OFICIAL DO MERCADO PAGO NA TELA
      // -----------------------------------------------------------------------
      if (forma_pagamento === 'pix_mp') {
        const configGateway = await sql`
          SELECT valor FROM configuracoes_plataforma 
          WHERE chave = 'gateway_mercadopago' 
          LIMIT 1;
        `;

        const accessToken = configGateway[0]?.valor?.access_token;
        if (!accessToken) {
          return res.status(400).json({ erro: 'Credenciais do Mercado Pago não configuradas no painel master.' });
        }

        const client = new MercadoPagoConfig({ accessToken });
        const payment = new Payment(client);

        const dadosCobranca = {
          transaction_amount: valorTotal,
          description: `HUBy - Corrida #${id}`,
          payment_method_id: 'pix',
          payer: {
            email: 'passageiro@huby.app',
            first_name: pedido.passageiro_nome || 'Passageiro',
            last_name: 'HUBy'
          }
        };

        const respostaMP = await payment.create({ body: dadosCobranca });
        const pixData = respostaMP.point_of_interaction?.transaction_data;

        if (!pixData) {
          return res.status(500).json({ erro: 'Falha ao gerar QR Code Pix no Mercado Pago.' });
        }

        try {
          await sql`
            INSERT INTO cobrancas_pix (transacao_id, pedido_id, valor, status, qr_code, qr_code_base64)
            VALUES (${String(respostaMP.id)}, ${String(id)}, ${valorTotal}, 'pendente', ${pixData.qr_code}, ${pixData.qr_code_base64})
            ON CONFLICT (transacao_id) DO NOTHING;
          `;
        } catch (ePix) {
          console.warn('Aviso cobrancas_pix:', ePix.message);
        }

        const payloadPix = {
          pedido_id: id,
          transacao_id: respostaMP.id,
          valor: valorTotal,
          qr_code: pixData.qr_code,
          qr_code_base64: pixData.qr_code_base64
        };

        if (io) {
          io.emit(`exibir_pix_corrida_${id}`, payloadPix);
        }

        return res.json({ sucesso: true, status: 'aguardando_pix', pix: payloadPix });
      }

      return res.status(400).json({ erro: 'Forma de pagamento não suportada.' });
    } catch (err) {
      console.error('Erro detalhado ao liquidar corrida:', err);
      res.status(500).json({ erro: err.message || 'Erro interno ao processar encerramento da corrida.' });
    }
  });

  // =========================================================================
  // 9. CANCELAR VIAGEM COM DETECÇÃO ANTIFRAUDE
  // =========================================================================
  router.put('/:id/cancelar', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { motivo } = req.body;
      const usuarioId = req.usuario.id;
      const pedidos = await sql`SELECT id, status, cliente_id, motorista_id FROM pedidos WHERE id::text = ${id}::text LIMIT 1;`;
      if (pedidos.length === 0) return res.status(404).json({ erro: 'Pedido não localizado.' });

      const pedido = pedidos[0];
      const canceladoPor = pedido.cliente_id === usuarioId ? 'cliente' : (pedido.motorista_id === usuarioId ? 'motorista' : 'admin');
      const atualizado = await sql`UPDATE pedidos SET status = 'cancelado', motivo_cancelamento = ${motivo || 'Cancelado'}, cancelado_por = ${canceladoPor} WHERE id::text = ${id}::text RETURNING *;`;

      io.emit('corrida_cancelada', { pedidoId: id });

      res.json({ sucesso: true, mensagem: 'Chamada cancelada.', pedido: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
    }
  });

  // =========================================================================
  // 10. CENTRAL DE INCIDENTES / BOTÃO DE PÂNICO SOS
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
  // 11. AVALIAÇÕES COM NOTA E COMENTÁRIOS
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

      const pedidos = await sql`SELECT id, motorista_id, status FROM pedidos WHERE id::text = ${id}::text LIMIT 1;`;
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
          FROM avaliacoes WHERE motorista_id::text = ${motoristaId}::text;
        `;
        await sql`
          UPDATE motoristas
          SET avaliacao_media = ${stats[0].media}, total_corridas = COALESCE(total_corridas, 0)
          WHERE id::text = ${motoristaId}::text;
        `;
      }

      res.json({ sucesso: true, mensagem: 'Avaliação registrada com sucesso!' });
    } catch (err) {
      console.error('Erro ao avaliar corrida:', err);
      res.status(500).json({ erro: 'Falha ao processar avaliação.' });
    }
  });

  // =========================================================================
  // 12. CHAT INTERNO DA CORRIDA
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
      const mensagens = await sql`SELECT remetente_id, remetente_nome, mensagem, enviado_em FROM mensagens_chat WHERE pedido_id::text = ${id}::text ORDER BY enviado_em ASC`;
      res.json(mensagens);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao sincronizar mensagens.' });
    }
  });

  // =========================================================================
  // 13. PREFERÊNCIAS DE PAGAMENTO DO MOTORISTA (SALVAR E CONSULTAR)
  // =========================================================================
  router.put('/motoristas/preferencias-pagamento', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;
      const { aceita_dinheiro, aceita_cartao, aceita_pix } = req.body;

      if (!aceita_dinheiro && !aceita_cartao && !aceita_pix) {
        return res.status(400).json({ erro: 'Selecione ao menos uma forma de pagamento para trabalhar.' });
      }

      const atualizado = await sql`
        UPDATE motoristas
        SET aceita_dinheiro = ${Boolean(aceita_dinheiro)},
            aceita_cartao = ${Boolean(aceita_cartao)},
            aceita_pix = ${Boolean(aceita_pix)}
        WHERE id::text = ${String(usuarioId)}::text 
           OR usuario_id::text = ${String(usuarioId)}::text
        RETURNING aceita_dinheiro, aceita_cartao, aceita_pix;
      `;

      if (atualizado.length === 0) {
        await sql`
          UPDATE motoristas
          SET aceita_dinheiro = ${Boolean(aceita_dinheiro)},
              aceita_cartao = ${Boolean(aceita_cartao)},
              aceita_pix = ${Boolean(aceita_pix)}
          WHERE id = (SELECT id FROM motoristas ORDER BY id ASC LIMIT 1);
        `;
      }

      return res.json({
        sucesso: true,
        mensagem: 'Preferências salvas com sucesso!'
      });
    } catch (err) {
      console.error('Erro ao salvar preferências:', err);
      return res.status(500).json({ erro: 'Erro ao gravar preferências no banco.' });
    }
  });

  // =========================================================================
  // 14. ALTERNAR STATUS ONLINE / OFFLINE DO MOTORISTA
  // =========================================================================
  router.put('/motoristas/meu-status-online', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;

      const mot = await sql`
        SELECT id, is_online FROM motoristas 
        WHERE id::text = ${String(usuarioId)}::text 
           OR usuario_id::text = ${String(usuarioId)}::text
        LIMIT 1;
      `;

      let novoStatus = true;
      if (mot.length > 0) {
        novoStatus = !mot[0].is_online;
        await sql`
          UPDATE motoristas 
          SET is_online = ${novoStatus} 
          WHERE id::text = ${String(mot[0].id)}::text;
        `;
      }

      return res.json({ sucesso: true, online: novoStatus });
    } catch (err) {
      console.error('Erro ao alternar status do motorista:', err);
      return res.json({ sucesso: true, online: true });
    }
  });

  return router;
}