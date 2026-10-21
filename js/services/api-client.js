/**
 * ============================================================================
 * HUBy - Cliente de API e Sincronização em Tempo Real (js/services/api-client.js)
 * ============================================================================
 */

const STORAGE_CORRIDA_ATIVA = 'huby_corrida_ativa';
const STORAGE_PEDIDOS_FILA = 'huby_pedidos_fila';
const BACKEND_URL = 'https://huby.onrender.com';

export const ApiClient = {
  // 1. SOLICITAR UMA VIAGEM / FLASH / CARGO
  async solicitarViagem(dadosPedido) {
    const idGerado = dadosPedido.id || (
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().substring(0, 6).toUpperCase()
        : 'HUB' + Math.floor(Math.random() * 9000 + 1000)
    );

    const pedidoCompleto = {
      id: idGerado,
      status: 'pendente',
      tipo: dadosPedido.tipo || 'carro',
      subTipoLabel: dadosPedido.subTipoLabel || 'HUBy Carro',
      origem: dadosPedido.origem || 'Localização atual do passageiro',
      destino: dadosPedido.destino || 'Ponto selecionado',
      coordsOrigem: dadosPedido.coordsOrigem || null,
      coordsDestino: dadosPedido.coordsDestino || null,
      distancia: dadosPedido.distancia || '1.0 km',
      preco: dadosPedido.preco || 'R$ 10,00',
      metodoPgto: dadosPedido.metodoPgto || 'pix_app',
      criadoEm: new Date().toISOString(),
      ...dadosPedido
    };

    // 1.1. Guarda local da corrida do passageiro
    localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(pedidoCompleto));

    // 1.2. Adiciona à fila de chamadas para radares locais
    const pedidosAtuais = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS_FILA) || '[]');
    pedidosAtuais.unshift(pedidoCompleto);
    localStorage.setItem(STORAGE_PEDIDOS_FILA, JSON.stringify(pedidosAtuais));

    // 1.3. Transmissão imediata via BroadcastChannel entre abas
    try {
      const channel = new BroadcastChannel('huby_orders_channel');
      channel.postMessage({ tipo: 'NOVO_PEDIDO', pedido: pedidoCompleto });
    } catch (e) {}

    // 1.4. Mapeamento e Envio ao Neon PostgreSQL via backend Render
    try {
      const payloadNeon = {
        id: pedidoCompleto.id,
        tipo: pedidoCompleto.tipo,
        sub_tipo_label: pedidoCompleto.subTipoLabel,
        origem: pedidoCompleto.origem,
        destino: pedidoCompleto.destino,
        coords_origem: pedidoCompleto.coordsOrigem,
        coords_destino: pedidoCompleto.coordsDestino,
        distancia: pedidoCompleto.distancia,
        preco: pedidoCompleto.preco,
        metodo_pgto: pedidoCompleto.metodoPgto,
        status: 'pendente',
        criado_em: pedidoCompleto.criadoEm
      };

      const resp = await fetch(`${BACKEND_URL}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadNeon)
      });

      if (resp.ok) {
        console.log('[HUBy API] Pedido gravado no Neon PostgreSQL');
        const resultado = await resp.json();
        return resultado.pedido || pedidoCompleto;
      }
    } catch (erro) {
      console.warn('[HUBy API] Servidor em repouso. Operando em sincronia local offline.');
    }

    return pedidoCompleto;
  },

  // 2. BUSCAR PEDIDOS PENDENTES PARA OS PAINÉIS DE MOTORISTA / MOTOBOY / CARGO
  async obterPedidosPendentes(categoriaFiltro = 'todos') {
    let lista = [];

    try {
      const resp = await fetch(`${BACKEND_URL}/api/pedidos?status=pendente`);
      if (resp.ok) {
        const dados = await resp.json();
        if (Array.isArray(dados)) {
          lista = dados.map(p => ({
            id: p.id,
            tipo: p.tipo,
            subTipoLabel: p.sub_tipo_label || p.subTipoLabel,
            origem: p.origem,
            destino: p.destino,
            coordsOrigem: p.coords_origem || p.coordsOrigem,
            coordsDestino: p.coords_destino || p.coordsDestino,
            distancia: p.distancia,
            preco: p.preco,
            metodoPgto: p.metodo_pgto || p.metodoPgto,
            horario: new Date(p.criado_em || p.criadoEm || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          }));
        }
      }
    } catch (e) {
      // Fallback local se o servidor estiver dormindo
    }

    if (lista.length === 0) {
      lista = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS_FILA) || '[]');
    }

    // Filtra pela categoria da tela correspondente
    if (categoriaFiltro !== 'todos') {
      lista = lista.filter(p => {
        if (categoriaFiltro === 'carro') return p.tipo === 'carro' || p.tipo === 'viagem';
        if (categoriaFiltro === 'moto') return p.tipo === 'moto' || p.tipo === 'flash';
        if (categoriaFiltro === 'cargo') return p.tipo === 'cargo';
        return p.tipo === categoriaFiltro;
      });
    }

    return lista;
  },

  // 3. RECUPERAR A CORRIDA ATIVA DO CLIENTE
  obterCorridaAtiva() {
    const raw = localStorage.getItem(STORAGE_CORRIDA_ATIVA);
    return raw ? JSON.parse(raw) : null;
  },

  // 4. ATUALIZAR STATUS (ACEITA, EM ROTA, CONCLUÍDA)
  async atualizarStatusCorrida(id, novoStatus, dadosAdicionais = {}) {
    const atual = this.obterCorridaAtiva();
    let atualizada = null;

    if (atual && String(atual.id) === String(id)) {
      atualizada = {
        ...atual,
        status: novoStatus,
        ...dadosAdicionais,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(atualizada));
    }

    // Se a corrida foi aceita ou finalizada, remove da fila visível nos radares
    if (novoStatus === 'em_andamento' || novoStatus === 'concluida' || novoStatus === 'cancelada') {
      let fila = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS_FILA) || '[]');
      fila = fila.filter(p => String(p.id) !== String(id));
      localStorage.setItem(STORAGE_PEDIDOS_FILA, JSON.stringify(fila));
    }

    // Comunica a mudança para o backend Render / Neon
    try {
      await fetch(`${BACKEND_URL}/api/pedidos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus, ...dadosAdicionais })
      });
    } catch (e) {
      console.warn('[HUBy API] Falha na sincronização remota do status.');
    }

    return atualizada;
  },

  // 5. LIMPAR SESSÃO DE CORRIDA
  limparCorridaAtiva() {
    localStorage.removeItem(STORAGE_CORRIDA_ATIVA);
  }
};