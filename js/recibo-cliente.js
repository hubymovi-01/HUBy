// js/recibo-cliente.js - Atalhos de Recibo Compartilhável no App do Passageiro
import { API_URL } from './config.js';

export function abrirReciboCorrida(pedidoId) {
  if (!pedidoId) return;
  window.location.href = `./recibo.html?id=${encodeURIComponent(pedidoId)}`;
}

window.abrirReciboCorrida = abrirReciboCorrida;

async function renderizarHistoricoComRecibos() {
  const listaBox = document.getElementById('listaHistoricoCorridas');
  const token = localStorage.getItem('huby_token');
  if (!listaBox || !token) return;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/historico?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const viagens = await res.json();
    if (!Array.isArray(viagens) || !viagens.length) return;

    listaBox.innerHTML = viagens.map(v => {
      const dataFmt = v.criado_em
        ? new Date(v.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '--';
      const valorFmt = `R$ ${Number(v.valor_total || 0).toFixed(2).replace('.', ',')}`;
      const statusUp = String(v.status || 'pendente').toUpperCase();
      const concluida = ['concluido', 'concluida', 'pago', 'finalizado'].includes(String(v.status || '').toLowerCase());

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 12px; margin-bottom: 10px; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="font-size: 13px; color: #FFF;">${v.sub_tipo_label || 'HUBy'} • ${valorFmt}</strong>
            <span style="font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 10px; background: ${concluida ? 'rgba(16,185,129,0.18)' : 'rgba(245,158,11,0.18)'}; color: ${concluida ? '#10B981' : '#F59E0B'};">
              ${statusUp}
            </span>
          </div>
          <div style="font-size: 12px; color: #94A3B8; margin-bottom: 4px;">📍 ${v.origem_endereco || ''}</div>
          <div style="font-size: 12px; color: #CBD5E1; margin-bottom: 8px;">🏁 ${v.destino_endereco || ''}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
            <small style="color: #64748B; font-size: 11px;">${dataFmt} • ${v.motorista_nome || 'Parceiro'}</small>
            <button type="button" onclick="abrirReciboCorrida('${v.id}')"
              style="background: rgba(56,189,248,0.16); border: 1px solid rgba(56,189,248,0.4); color: #38BDF8; padding: 5px 10px; border-radius: 8px; font-size: 11px; font-weight: 800; cursor: pointer;">
              🧾 Ver Recibo
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnNavViagens')?.addEventListener('click', () => {
    setTimeout(renderizarHistoricoComRecibos, 250);
  });
  document.getElementById('menuItemViagens')?.addEventListener('click', () => {
    setTimeout(renderizarHistoricoComRecibos, 250);
  });

  // Adiciona botão de recibo também no modal de avaliação ao finalizar corrida
  const modalAvaliacao = document.getElementById('modalAvaliacao');
  const btnRow = modalAvaliacao?.querySelector('.modal-btn-row');
  if (btnRow && !document.getElementById('btnVerReciboPosCorrida')) {
    const btnRecibo = document.createElement('button');
    btnRecibo.type = 'button';
    btnRecibo.id = 'btnVerReciboPosCorrida';
    btnRecibo.className = 'btn-secondary-modal';
    btnRecibo.style.borderColor = '#38BDF8';
    btnRecibo.style.color = '#38BDF8';
    btnRecibo.textContent = '🧾 Recibo';
    btnRecibo.addEventListener('click', () => {
      const id = localStorage.getItem('huby_ultima_corrida_id') || localStorage.getItem('huby_pedido_ativo_id');
      if (id) abrirReciboCorrida(id);
    });
    btnRow.prepend(btnRecibo);
  }
});