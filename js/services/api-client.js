/**
 * ============================================================================
 * HUBy - Cliente de API e Sincronização em Tempo Real (js/services/api-client.js)
 * ============================================================================
 */

const STORAGE_CORRIDA_ATIVA = 'huby_corrida_ativa';
const BACKEND_URL = 'http://localhost:3000'; // Endereço do Servidor Node.js

export const ApiClient = {
  async solicitarViagem(dadosPedido) {
    const pedidoCompleto = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'corrida-' + Date.now(),
      status: 'buscando_motorista',
      criadoEm: new Date().toISOString(),
      ...dadosPedido
    };

    // Guarda sempre uma cópia local para salvaguarda instantânea
    localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(pedidoCompleto));

    try {
      // Tenta enviar o pedido para o servidor Node.js real (Backend / WebSocket)
      const resp = await fetch(`${BACKEND_URL}/api/solicitar-viagem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pedidoCompleto)
      });

      if (resp.ok) {
        const resultado = await resp.json();
        console.log('[HUBy API] Pedido despachado com sucesso via Backend Node.js');
        return resultado.corrida || pedidoCompleto;
      }
    } catch (erro) {
      console.log('[HUBy API] Servidor backend offline. A utilizar modo local síncrono.');
    }

    return pedidoCompleto;
  },

  obterCorridaAtiva() {
    const raw = localStorage.getItem(STORAGE_CORRIDA_ATIVA);
    return raw ? JSON.parse(raw) : null;
  },

  atualizarStatusCorrida(novoStatus, dadosMotorista = {}) {
    const atual = this.obterCorridaAtiva();
    if (!atual) return null;

    const atualizada = {
      ...atual,
      status: novoStatus,
      ...dadosMotorista,
      atualizadoEm: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_CORRIDA_ATIVA, JSON.stringify(atualizada));
    return atualizada;
  },

  limparCorridaAtiva() {
    localStorage.removeItem(STORAGE_CORRIDA_ATIVA);
  }
};