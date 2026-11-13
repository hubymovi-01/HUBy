// routes/pedidos.routes.js - Gestão Completa de Pedidos HUBy Sincronizada com Tarifas do Banco
import express from 'express';
import { sql, JWT_SECRET } from '../db.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { lerTarifasDoBanco, extrairObjetoJSONB } from './admin.routes.js';

export function autenticarToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader ? (authHeader.split(' ')[1] || authHeader) : req.query.token;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ erro: 'Acesso negado: token não fornecido.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão expirada ou token inválido.' });
  }
}

async function inicializarColunasPedidos() {
  try {
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pgto VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS sub_tipo_id VARCHAR(50);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS sub_tipo_label VARCHAR(100);`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_adicionais NUMERIC(10,2) DEFAULT 0.00;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS paradas JSONB DEFAULT '[]'::jsonb;`;
    await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_txid TEXT;`;

    await sql`
      CREATE TABLE IF NOT EXISTS mensagens_chat (
        id SERIAL PRIMARY KEY,
        pedido_id TEXT NOT NULL,
        remetente_id TEXT NOT NULL,
        remetente_nome VARCHAR(100),
        mensagem TEXT NOT NULL,
        criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
  } catch (e) {
    console.warn('Aviso: Verificação de colunas de pedidos:', e.message);
  }
}
inicializarColunasPedidos();

function ehAdminToken(usuario) {
  const role = String(usuario?.role || usuario?.funcao || '').toLowerCase();
  return role === 'admin' || role === 'administrador';
}

function ehMotoristaToken(usuario) {
  return String(usuario?.role || '').toLowerCase() === 'motorista';
}

export default function pedidosRouter(io) {
  const router = express.Router();

  // =========================================================================
  // 1. CRIAR PEDIDO (COM CÁLCULO OFICIAL PELAS TARIFAS DO BANCO)
  // =========================================================================
  router.post('/', autenticarToken, async (req, res) => {
    let cupomReservadoId = null;
    try {
      const {
        id, tipo, subTipoId, sub_tipo_id, subTipoLabel, sub_tipo_label,
        origem, destino, origem_endereco, destino_endereco,
        coordsOrigem, coordsDestino, origem_lat, origem_lng, destino_lat, destino_lng,
        paradas,
        distanciaKm, distancia_km, duracaoMin, duracao_min,
        valorAdicionais, valor_adicionais,
        metodoPgto, metodo_pagamento, forma_pagamento,
        cupomCodigo
      } = req.body;

      const clienteId = String(req.usuario.id);

      const endOrigem = origem_endereco || origem;
      const endDestino = destino_endereco || destino;

      if (!endOrigem || !endDestino) {
        return res.status(400).json({ erro: 'Dados incompletos para registo da viagem.' });
      }

      const idPedido = (typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id))
        ? id
        : 'ped_' + crypto.randomBytes(8).toString('hex');

      const formatarNum = (val) => Number(String(val ?? '').replace(',', '.')) || 0;
      const vAdic = formatarNum(valor_adicionais !== undefined ? valor_adicionais : valorAdicionais);
      const dKm = Math.max(0.2, formatarNum(distancia_km !== undefined ? distancia_km : distanciaKm));
      const dMin = Math.max(2, formatarNum(duracao_min !== undefined ? duracao_min : duracaoMin));

      const origLat = Number(origem_lat !== undefined ? origem_lat : coordsOrigem?.[0]);
      const origLng = Number(origem_lng !== undefined ? origem_lng : coordsOrigem?.[1]);
      const destLat = Number(destino_lat !== undefined ? destino_lat : coordsDestino?.[0]);
      const destLng = Number(destino_lng !== undefined ? destino_lng : coordsDestino?.[1]);

      const coordsOk = [origLat, origLng, destLat, destLng].every(Number.isFinite)
        && Math.abs(origLat) <= 90 && Math.abs(destLat) <= 90
        && Math.abs(origLng) <= 180 && Math.abs(destLng) <= 180;

      if (!coordsOk) {
        return res.status(400).json({ erro: 'Defina a origem e o destino no mapa.' });
      }

      const tarifasBanco = await lerTarifasDoBanco();
      const catChave = String(sub_tipo_id || subTipoId || tipo || 'carro').toLowerCase();
      const cfgCat = tarifasBanco[catChave === 'flash' ? 'entrega' : catChave] || tarifasBanco.carro;

      const qtdParadas = Array.isArray(paradas) ? paradas.length : 0;
      const valorCalculadoServidor = Number((
        Number(cfgCat.base || 0) +
        (dKm * Number(cfgCat.km || 0)) +
        (qtdParadas * 2.50) +
        vAdic
      ).toFixed(2));

      let vTotal = Math.max(0.50, valorCalculadoServidor);

      let descontoAplicado = 0;
      if (cupomCodigo) {
        const codigoFormatado = String(cupomCodigo).trim().toUpperCase();
        const cupons = await sql`
          SELECT id, tipo, valor, expira_em
          FROM cupons_desconto
          WHERE codigo = ${codigoFormatado} AND ativo = TRUE
          LIMIT 1;
        `;

        if (cupons.length > 0) {
          const cupom = cupons[0];
          const expirado = cupom.expira_em && new Date(cupom.expira_em) < new Date();

          if (!expirado) {
            const desconto = cupom.tipo === 'porcentagem'
              ? Number(((vTotal * Math.min(Number(cupom.valor), 100)) / 100).toFixed(2))
              : Number(cupom.valor);

            const reservado = await sql`
              UPDATE cupons_desconto
              SET usos_atuais = usos_atuais + 1
              WHERE id = ${cupom.id}
                AND ativo = TRUE
                AND (COALESCE(limite_usos, 0) = 0 OR usos_atuais < limite_usos)
              RETURNING id;
            `;

            if (reservado.length > 0) {
              cupomReservadoId = cupom.id;
              descontoAplicado = desconto;
              vTotal = Math.max(0.50, Number((vTotal - desconto).toFixed(2)));
            }
          }
        }
      }

      const formaPagamentoFinal = forma_pagamento || metodo_pagamento || metodoPgto || 'dinheiro';
      const subTipoLabelFinal = sub_tipo_label || subTipoLabel || 'HUBy Carro';
      const subTipoIdFinal = sub_tipo_id || subTipoId || tipo || 'carro';

      const usuarioExiste = await sql`SELECT id FROM usuarios WHERE id::text = ${clienteId}::text LIMIT 1;`;
      const idClienteFinal = usuarioExiste.length > 0 ? usuarioExiste[0].id : null;

      const inserido = await sql`
        INSERT INTO pedidos (
          id, cliente_id, tipo, sub_tipo_id, sub_tipo_label,
          origem_endereco, destino_endereco,
          origem_lat, origem_lng, destino_lat, destino_lng,
          distancia_km, duracao_min, valor_total, valor_adicionais,
          forma_pagamento, metodo_pgto, status
        ) VALUES (
          ${idPedido}, ${idClienteFinal}, ${tipo || 'carro'}, ${subTipoIdFinal}, ${subTipoLabelFinal},
          ${String(endOrigem).slice(0, 300)}, ${String(endDestino).slice(0, 300)},
          ${origLat}, ${origLng}, ${destLat}, ${destLng},
          ${dKm}, ${dMin}, ${vTotal}, ${vAdic},
          ${formaPagamentoFinal}, ${formaPagamentoFinal}, 'pendente'
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id;
      `;

      if (!inserido.length) {
        if (cupomReservadoId) {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
        }
        return res.status(409).json({ erro: 'Já existe uma corrida com este código.' });
      }

      if (io) {
        io.emit('nova_chamada', {
          id: idPedido,
          clienteId: idClienteFinal,
          tipo: tipo || 'carro',
          subTipoLabel: subTipoLabelFinal,
          origem: endOrigem,
          destino: endDestino,
          distanciaKm: dKm,
          duracaoMin: dMin,
          valorTotal: vTotal,
          paradas: paradas || []
        });
      }

      return res.status(201).json({
        sucesso: true,
        id: idPedido,
        valorFinal: vTotal,
        desconto: descontoAplicado
      });

    } catch (error) {
      console.error('⚠️ ERRO AO GRAVAR PEDIDO NO BANCO:', error);
      if (cupomReservadoId) {
        try {
          await sql`UPDATE cupons_desconto SET usos_atuais = GREATEST(usos_atuais - 1, 0) WHERE id = ${cupomReservadoId};`;
        } catch (e) { }
      }
      return res.status(500).json({ erro: 'Falha ao salvar corrida na base de dados: ' + error.message });
    }
  });

  // =========================================================================
  // 2. RADAR DE MOTORISTAS EM TEMPO REAL (TRANSMISSÃO GPS)
  // =========================================================================
  router.post('/motoristas/localizacao', autenticarToken, async (req, res) => {
    try {
      const motoristaId = req.usuario.id;
      const { lat, lng, heading, emCorrida } = req.body;

      if (!lat || !lng) return res.status(400).json({ erro: 'Coordenadas incompletas.' });

      if (io) {
        io.emit('posicao_motorista', {
          motoristaId,
          lat: Number(lat),
          lng: Number(lng),
          heading: Number(heading || 0),
          emCorrida: !!emCorrida,
          atualizadoEm: new Date().toISOString()
        });
      }

      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao emitir localização.' });
    }
  });

  // =========================================================================
  // 3. CONSULTA DE CHAMADAS PENDENTES
  // =========================================================================
  router.get('/pendentes', autenticarToken, async (req, res) => {
    try {
      if (!ehMotoristaToken(req.usuario) && !ehAdminToken(req.usuario)) {
        return res.status(403).json({ erro: 'Acesso restrito a motoristas parceiros.' });
      }

      if (ehMotoristaToken(req.usuario)) {
        const mot = await sql`
          SELECT status_online FROM motoristas 
          WHERE id::text = ${String(req.usuario.id)}::text 
             OR usuario_id::text = ${String(req.usuario.id)}::text
          LIMIT 1;
        `;
        if (mot.length > 0 && !mot[0].status_online) {
          return res.json([]);
        }
      }

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
      return res.status(500).json({ erro: 'Erro interno ao consultar dados da viagem.' });
    }
  });

  // =========================================================================
  // 6. STATUS DA VIAGEM (CONSULTA E ATUALIZAÇÃO DE ETAPA PELO MOTORISTA)
  // =========================================================================
  router.get('/:id/status', autenticarToken, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const { id } = req.params;
      const pedidos = await sql`
        SELECT 
          p.id, p.status, p.cliente_id, p.valor_total, p.distancia_km, p.duracao_min,
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
      res.status(500).json({ erro: 'Falha ao consultar estado da chamada.' });
    }
  });

  // ROTA QUE ATUALIZA STATUS (Ex: "motorista_no_local" quando clica em "Cheguei no Local")
  router.put('/:id/status', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const novoStatus = String(req.body?.status || 'a_caminho').trim();

      await sql`
        UPDATE pedidos
        SET status = ${novoStatus}
        WHERE id::text = ${String(id)}::text
          AND LOWER(COALESCE(status, '')) <> 'concluido';
      `;

      if (io) {
        io.emit('status_corrida_atualizado', { pedidoId: id, status: novoStatus });
      }

      res.json({ sucesso: true, status: novoStatus });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao atualizar status do pedido.' });
    }
  });

  // ROTA DE EMBARQUE (Corrige o erro 404 de /:id/embarque quando o motorista clica em "Iniciar Viagem")
  router.put('/:id/embarque', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;

      await sql`
        UPDATE pedidos
        SET status = 'em_viagem'
        WHERE id::text = ${String(id)}::text
          AND LOWER(COALESCE(status, '')) <> 'concluido';
      `;

      if (io) {
        io.emit('passageiro_a_bordo', { pedidoId: id, status: 'em_viagem' });
      }

      res.json({ sucesso: true, status: 'em_viagem' });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao registrar embarque do passageiro.' });
    }
  });

  // ROTAS DE CHAT ENTRE PASSAGEIRO E MOTORISTA
  router.get('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const msgs = await sql`
        SELECT id, pedido_id, remetente_id, remetente_nome, mensagem, criado_em
        FROM mensagens_chat
        WHERE pedido_id = ${String(id)}
        ORDER BY criado_em ASC
        LIMIT 100;
      `;
      res.json(msgs);
    } catch (err) {
      res.json([]);
    }
  });

  router.post('/:id/chat', autenticarToken, async (req, res) => {
    try {
      const { id } = req.params;
      const remetenteId = String(req.usuario?.id || '');
      const remetenteNome = String(req.body?.remetenteNome || req.usuario?.nome || 'Usuário').slice(0, 80);
      const mensagem = String(req.body?.mensagem || '').trim().slice(0, 500);

      if (!mensagem) return res.status(400).json({ erro: 'Mensagem vazia.' });

      const nova = await sql`
        INSERT INTO mensagens_chat (pedido_id, remetente_id, remetente_nome, mensagem)
        VALUES (${String(id)}, ${remetenteId}, ${remetenteNome}, ${mensagem})
        RETURNING *;
      `;

      if (io) {
        io.emit(`nova_mensagem_chat_${id}`, nova[0]);
      }

      res.status(201).json(nova[0]);
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao enviar mensagem.' });
    }
  });

  // =========================================================================
  // 7. ACEITAR VIAGEM
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

      if (io) {
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
      }

      res.json({ sucesso: true, pedido: payloadResposta });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao aceitar pedido.' });
    }
  });

  // =========================================================================
  // 8. CONCLUIR VIAGEM (COM TAXA DINÂMICA DO BANCO)
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

      const tarifasBanco = await lerTarifasDoBanco();
      const taxaPorcentagem = Number(tarifasBanco.taxa_plataforma ?? 15);

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

      if (io) {
        io.emit('corrida_finalizada', {
          pedidoId: id,
          status: 'concluido',
          valorFinal: valorBruto
        });
      }

      res.json({
        sucesso: true,
        mensagem: 'Chamada concluída com sucesso!',
        repasseLiquido: repasseMotorista,
        taxaHuby: taxaPlataforma,
        novoSaldoCarteira: condutorAtualizado[0]?.saldo_carteira || 0
      });
    } catch (err) {
      res.status(500).json({ erro: 'Falha interna ao processar valores.' });
    }
  });

  // =========================================================================
  // 8.1 FINALIZAÇÃO COM ESCOLHA DO MÉTODO (DINHEIRO, MAQUININHA OU PIX)
  // =========================================================================
  router.post('/:id/finalizar-liquidacao', autenticarToken, async (req, res) => {
    const { id } = req.params;
    const { forma_pagamento } = req.body;

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

      const tarifasBanco = await lerTarifasDoBanco();
      const taxaPorcentagem = Number(tarifasBanco.taxa_plataforma ?? 15);
      const taxaPlataforma = Number(((valorTotal * taxaPorcentagem) / 100).toFixed(2));
      const motoristaIdAlvo = pedido.motorista_id || req.usuario?.id;

      if (forma_pagamento === 'dinheiro' || forma_pagamento === 'cartao_maquininha') {
        await sql`
          UPDATE pedidos
          SET status = 'concluido', 
              forma_pagamento = ${forma_pagamento},
              metodo_pgto = ${forma_pagamento},
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
          } catch (eTrans) { }
        }

        if (io) {
          io.emit(`corrida_finalizada_${id}`, {
            sucesso: true,
            pedidoId: id,
            forma_pagamento,
            valorTotal,
            mensagem: 'Viagem finalizada e acertada com o motorista!'
          });
          io.emit('corrida_finalizada', { pedidoId: id, status: 'concluido', valorFinal: valorTotal });
        }

        return res.json({ sucesso: true, status: 'concluido', forma_pagamento });
      }

      if (forma_pagamento === 'pix_mp') {
        let accessToken = process.env.MP_ACCESS_TOKEN;

        if (!accessToken) {
          const configGateway = await sql`
            SELECT valor::text AS valor_txt FROM configuracoes_plataforma 
            WHERE chave = 'gateway_mercadopago' 
            LIMIT 1;
          `;
          const gw = extrairObjetoJSONB(configGateway[0]?.valor_txt, {});
          accessToken = gw.access_token;
        }

        if (!accessToken) {
          return res.status(400).json({ erro: 'Credenciais do Mercado Pago não configuradas no sistema.' });
        }

        const client = new MercadoPagoConfig({ accessToken });
        const payment = new Payment(client);
        const notificationUrl = `${process.env.API_URL || 'https://huby.onrender.com'}/api/carteira/webhook/mercadopago`;

        const dadosCobranca = {
          transaction_amount: valorTotal,
          description: `HUBy - Corrida #${id}`,
          external_reference: String(id),
          payment_method_id: 'pix',
          notification_url: notificationUrl,
          payer: {
            email: 'passageiro@huby.app',
            first_name: pedido.motorista_nome || 'Passageiro',
            last_name: 'HUBy'
          }
        };

        const respostaMP = await payment.create({ body: dadosCobranca });
        const pixData = respostaMP.point_of_interaction?.transaction_data;
        const txidGerado = String(respostaMP.id);

        if (!pixData) {
          return res.status(500).json({ erro: 'Falha ao gerar QR Code Pix no Mercado Pago.' });
        }

        try {
          await sql`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_txid TEXT;`;
          await sql`UPDATE pedidos SET pix_txid = ${txidGerado} WHERE id::text = ${String(id)}::text;`;
        } catch (ePed) {}

        try {
          await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS txid VARCHAR(64);`;
          await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pedido_id TEXT;`;
          await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS usuario_id TEXT;`;
          await sql`ALTER TABLE cobrancas_pix ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;`;
          await sql`
            INSERT INTO cobrancas_pix (txid, transacao_id, pedido_id, usuario_id, valor, status, pix_copia_cola, qr_code, qr_code_base64)
            VALUES (${txidGerado}, ${txidGerado}, ${String(id)}, ${pedido.cliente_id ? String(pedido.cliente_id) : null}, ${valorTotal}, 'pendente', ${pixData.qr_code}, ${pixData.qr_code}, ${pixData.qr_code_base64});
          `;
        } catch (ePix) {
          console.warn('Aviso cobrancas_pix:', ePix.message);
        }

        const payloadPix = {
          pedido_id: id,
          txid: txidGerado,
          transacao_id: txidGerado,
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
      res.status(500).json({ erro: err.message || 'Erro interno ao processar encerramento da corrida.' });
    }
  });

  // =========================================================================
  // 9. CANCELAR VIAGEM
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

      if (io) {
        io.emit('corrida_cancelada', { pedidoId: id });
      }

      res.json({ sucesso: true, mensagem: 'Chamada cancelada.', pedido: atualizado[0] });
    } catch (err) {
      res.status(500).json({ erro: 'Falha ao processar cancelamento.' });
    }
  });

  // =========================================================================
  // 10. PREFERÊNCIAS DE PAGAMENTO DO MOTORISTA
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
      return res.status(500).json({ erro: 'Erro ao gravar preferências no banco.' });
    }
  });

  // =========================================================================
  // 11. ALTERNAR STATUS ONLINE / OFFLINE DO MOTORISTA
  // =========================================================================
  router.put('/motoristas/meu-status-online', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;
      const onlineExplicito = req.body?.online;

      const mot = await sql`
        SELECT id, status_online FROM motoristas 
        WHERE id::text = ${String(usuarioId)}::text 
           OR usuario_id::text = ${String(usuarioId)}::text
        LIMIT 1;
      `;

      let novoStatus = typeof onlineExplicito === 'boolean' ? onlineExplicito : true;
      if (mot.length > 0) {
        if (typeof onlineExplicito !== 'boolean') {
          novoStatus = !mot[0].status_online;
        }
        await sql`
          UPDATE motoristas 
          SET status_online = ${novoStatus} 
          WHERE id::text = ${String(mot[0].id)}::text;
        `;
      }

      return res.json({ sucesso: true, online: novoStatus });
    } catch (err) {
      return res.json({ sucesso: true, online: true });
    }
  });

  // =========================================================================
  // 12. CONSULTAR PERFIL DO CONDUTOR
  // =========================================================================
  router.get('/motoristas/perfil', autenticarToken, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
      const usuarioId = req.usuario.id;
      const emailUsuario = req.usuario.email || '';

      let motoristas = await sql`
        SELECT id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
               foto_perfil_url, avaliacao_media, total_corridas, saldo_carteira, chave_pix_padrao,
               COALESCE(codigo_voz, 'Zank') AS codigo_voz,
               COALESCE(aceita_dinheiro, true) AS aceita_dinheiro,
               COALESCE(aceita_cartao, true) AS aceita_cartao,
               COALESCE(aceita_pix, true) AS aceita_pix
        FROM motoristas 
        WHERE id::text = ${String(usuarioId)}::text 
           OR usuario_id::text = ${String(usuarioId)}::text
           OR (email = ${emailUsuario} AND ${emailUsuario} != '')
        LIMIT 1;
      `;

      if (motoristas.length === 0) {
        motoristas = await sql`
          SELECT id, nome, email, telefone, veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
                 foto_perfil_url, avaliacao_media, total_corridas, saldo_carteira, chave_pix_padrao,
                 COALESCE(codigo_voz, 'Zank') AS codigo_voz,
                 COALESCE(aceita_dinheiro, true) AS aceita_dinheiro,
                 COALESCE(aceita_cartao, true) AS aceita_cartao,
                 COALESCE(aceita_pix, true) AS aceita_pix
          FROM motoristas 
          ORDER BY saldo_carteira DESC, criado_em ASC
          LIMIT 1;
        `;
      }

      if (motoristas.length === 0) {
        return res.status(404).json({ erro: 'Motorista não localizado.' });
      }

      return res.json(motoristas[0]);
    } catch (err) {
      return res.status(500).json({ erro: 'Falha ao carregar perfil.' });
    }
  });

  // =========================================================================
  // 13. ATUALIZAR PERFIL DO MOTORISTA
  // =========================================================================
  router.put('/motoristas/perfil/atualizar', autenticarToken, async (req, res) => {
    try {
      const usuarioId = req.usuario.id;
      const emailUsuario = req.usuario.email || '';
      const {
        nome, telefone, foto_perfil_url, foto_base64,
        veiculo_modelo, veiculo_placa, veiculo_cor, veiculo_ano,
        chave_pix_padrao, codigo_voz
      } = req.body;

      const fNome = (nome && nome.trim()) ? nome.trim() : null;
      const fTel = (telefone && telefone.trim()) ? telefone.trim() : null;
      const fFoto = (foto_perfil_url && foto_perfil_url.trim()) 
        ? foto_perfil_url.trim() 
        : ((foto_base64 && foto_base64.trim()) ? foto_base64.trim() : null);

      const fMod = (veiculo_modelo && veiculo_modelo.trim()) ? veiculo_modelo.trim() : null;
      const fPlaca = (veiculo_placa && veiculo_placa.trim()) ? veiculo_placa.trim().toUpperCase() : null;
      const fCor = (veiculo_cor && veiculo_cor.trim()) ? veiculo_cor.trim() : null;
      const fAno = (veiculo_ano && String(veiculo_ano).trim()) ? String(veiculo_ano).trim() : null;
      const fPix = (chave_pix_padrao && chave_pix_padrao.trim()) ? chave_pix_padrao.trim() : null;
      const fCodVoz = (codigo_voz && codigo_voz.trim()) ? codigo_voz.trim() : null;

      let mot = await sql`
        UPDATE motoristas
        SET 
          nome = COALESCE(${fNome}, nome),
          telefone = COALESCE(${fTel}, telefone),
          foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
          veiculo_modelo = COALESCE(${fMod}, veiculo_modelo),
          veiculo_placa = COALESCE(${fPlaca}, veiculo_placa),
          veiculo_cor = COALESCE(${fCor}, veiculo_cor),
          veiculo_ano = COALESCE(${fAno}, veiculo_ano),
          chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
          codigo_voz = COALESCE(${fCodVoz}, codigo_voz)
        WHERE id::text = ${String(usuarioId)}::text 
           OR usuario_id::text = ${String(usuarioId)}::text 
           OR (email = ${emailUsuario} AND ${emailUsuario} != '')
        RETURNING *;
      `;

      if (mot.length === 0) {
        mot = await sql`
          UPDATE motoristas
          SET 
            usuario_id = ${usuarioId},
            nome = COALESCE(${fNome}, nome),
            telefone = COALESCE(${fTel}, telefone),
            foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url),
            veiculo_modelo = COALESCE(${fMod}, veiculo_modelo),
            veiculo_placa = COALESCE(${fPlaca}, veiculo_placa),
            veiculo_cor = COALESCE(${fCor}, veiculo_cor),
            veiculo_ano = COALESCE(${fAno}, veiculo_ano),
            chave_pix_padrao = COALESCE(${fPix}, chave_pix_padrao),
            codigo_voz = COALESCE(${fCodVoz}, codigo_voz)
          WHERE id = (SELECT id FROM motoristas ORDER BY saldo_carteira DESC LIMIT 1)
          RETURNING *;
        `;
      }

      if (fFoto || fNome || fTel) {
        await sql`
          UPDATE usuarios
          SET 
            nome = COALESCE(${fNome}, nome),
            telefone = COALESCE(${fTel}, telefone),
            foto_perfil_url = COALESCE(${fFoto}, foto_perfil_url)
          WHERE id::text = ${String(usuarioId)}::text;
        `;
      }

      return res.json({ sucesso: true, motorista: mot[0] || {} });
    } catch (err) {
      return res.status(500).json({ erro: err.message || 'Falha ao salvar dados do perfil.' });
    }
  });

  return router;
}