// js/cliente/cliente-paradas.js
import { estadoCliente } from './cliente-estado.js';
import { atualizarResumoValores } from './cliente-pedidos.js';

// Inicializa a lista de paradas no estado caso não exista
if (!estadoCliente.paradas) {
  estadoCliente.paradas = [];
}

export function configurarMultiplasParadas() {
  const btnAdd = document.getElementById('btnAddParada');
  if (!btnAdd) return;

  btnAdd.addEventListener('click', (e) => {
    e.preventDefault();

    if (estadoCliente.pedidoAtivoId) {
      alert('Não é possível adicionar paradas com uma corrida em andamento.');
      return;
    }

    if (!estadoCliente.coordsDestino) {
      alert('Selecione primeiro o destino final no mapa.');
      return;
    }

    if (estadoCliente.paradas.length >= 3) {
      alert('Limite máximo de 3 paradas intermediárias atingido.');
      return;
    }

    const enderecoParada = prompt(`Endereço da Parada ${estadoCliente.paradas.length + 1} (ex: Farmácia, Banco, Padaria):`);
    if (!enderecoParada || !enderecoParada.trim()) return;

    // Adiciona a parada com estimativa de acréscimo proporcional
    const novaParada = {
      id: Date.now(),
      endereco: enderecoParada.trim(),
      deltaKm: 1.2
    };

    estadoCliente.paradas.push(novaParada);
    renderizarParadas();
    recalcularRotaComParadas();
  });
}

export function renderizarParadas() {
  const container = document.getElementById('containerParadasIntermediarias');
  if (!container) return;

  if (!estadoCliente.paradas || estadoCliente.paradas.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = estadoCliente.paradas.map((p, index) => `
    <div class="stop-row" style="display: flex; align-items: center; justify-content: space-between; background: rgba(56, 189, 248, 0.08); border-left: 2.5px solid #38BDF8; padding: 6px 10px; border-radius: 8px; margin-top: 6px; font-size: 12px; border: 1px solid rgba(56,189,248,0.2);">
      <span style="color: #E2E8F0; max-width: 85%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        <strong style="color: #38BDF8;">Parada ${index + 1}:</strong> ${p.endereco}
      </span>
      <button type="button" class="btn-remover-parada" data-id="${p.id}" style="background: transparent; border: none; color: #EF4444; font-size: 14px; font-weight: bold; cursor: pointer; padding: 0 4px;" title="Remover parada">✕</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-remover-parada').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.getAttribute('data-id'));
      estadoCliente.paradas = estadoCliente.paradas.filter(item => item.id !== id);
      renderizarParadas();
      recalcularRotaComParadas();
    });
  });
}

export function recalcularRotaComParadas() {
  if (!estadoCliente.rotaAtual) return;

  const distBase = Number(estadoCliente.rotaAtual.distanciaKm || estadoCliente.rotaAtual.distancia || 2.5);
  const durBase = Number(estadoCliente.rotaAtual.duracaoMin || estadoCliente.rotaAtual.duracao || 8);

  const distExtra = estadoCliente.paradas.reduce((acc, p) => acc + (p.deltaKm || 1.2), 0);
  const durExtra = estadoCliente.paradas.length * 4;

  estadoCliente.distanciaTotalComParadas = Number((distBase + distExtra).toFixed(1));
  estadoCliente.duracaoTotalComParadas = Math.round(durBase + durExtra);

  atualizarResumoValores();
}

// Limpa as paradas ao resetar o painel
export function resetarParadasIntermediarias() {
  estadoCliente.paradas = [];
  estadoCliente.distanciaTotalComParadas = null;
  estadoCliente.duracaoTotalComParadas = null;
  renderizarParadas();
}