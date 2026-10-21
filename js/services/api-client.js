/**
 * ============================================================================
 * HUBy - Cliente de API e Sincronização em Tempo Real (js/services/api-client.js)
 * ============================================================================
 */

const STORAGE_CORRIDA_ATIVA = 'huby_corrida_ativa';
const STORAGE_PEDIDOS_FILA = 'huby_pedidos_fila';
const BACKEND_URL = 'https://huby.onrender.com'; // Endereço oficial no Render

export const ApiClient = {
  async solicitarViagem(dadosPedido) {
    const pedidoCompleto = {
      id: dadosPedido.id || (crypto.randomUUID ? crypto.randomUUID().substring(0, 6).toUpperCase() : 'HUB' + Math.floor(Math.random() * 9000 + 1000)),
      status: 'pendente',
      criadoEm: new Date().toISOString(),
      ...dadosPedido
    };

    // 1. Salvaguarda local da corrida do cliente
    localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(pedidoCompleto));

    // 2. Adiciona à fila local para sincronizar com motoristas e painel admin
    const pedidosAtuais = JSON.parse(localStorage.getItem(STORAGE_PEDIDOS_FILA) || '[]');
    pedidosAtuais.unshift(pedidoCompleto);
    localStorage.setItem(STORAGE_PEDIDOS_FILA, JSON.stringify(pedidosAtuais));

    // 3. Notifica instantaneamente outras abas abertas no navegador
    try {
      const channel = new BroadcastChannel('huby_orders_channel');
      channel.postMessage({ tipo: 'NOVO_PEDIDO', pedido: pedidoCompleto });
    } catch (e) {}

    // 4. Envia para o backend Node.js no Render / Neon PostgreSQL
    try {
      const resp = await fetch(`${BACKEND_URL}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedidoCompleto)
      });

      if (resp.ok) {
        console.log('[HUBy API] Pedido gravado com sucesso no Neon PostgreSQL');
        const resultado = await resp.json();
        return resultado.pedido || pedidoCompleto;
      }
    } catch (erro) {
      console.warn('[HUBy API] Servidor backend em repouso/offline. Operando em modo local síncrono.');
    }

    return pedidoCompleto;
  },

  obterCorridaAtiva() {
    const raw = localStorage.getItem(STORAGE_CORRIDA_ATIVA);
    return raw ? JSON.parse(raw) : null;
  },

  async atualizarStatusCorrida(id, novoStatus, dadosMotorista = {}) {
    const atual = this.obterCorridaAtiva();
    let atualizada = null;

    if (atual && String(atual.id) === String(id)) {
      atualizada = {
        ...atual,
        status: novoStatus,
        ...dadosMotorista,
        atualizadoEm: new Date().toISOString()
      };
      localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(atualizada));
    }

    // Tenta atualizar o status no Render/Neon
    try {
      await fetch(`${BACKEND_URL}/api/pedidos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, novoStatus })
      });
    } catch (e) {
      console.warn('[HUBy API] Falha ao sincronizar status na API remota.');
    }

    return atualizada;
  },

  limparCorridaAtiva() {
    localStorage.removeItem(STORAGE_CORRIDA_ATIVA);
  }
};