// js/extras-cliente.js - Indique & Ganhe + Corrida Agendada no App HUBy
import { API_URL } from './config.js';

function criarModaisExtras() {
  if (document.getElementById('modalIndiqueGanhe')) return;

  const html = `
    <!-- MODAL INDIQUE E GANHE -->
    <div id="modalIndiqueGanhe" class="modal-backdrop" style="display: none; z-index: 10020;">
      <div class="modal-card">
        <div class="modal-header-row">
          <h3>🎁 Indique e Ganhe</h3>
          <button type="button" id="btnFecharIndique" class="btn-icon-close">✕</button>
        </div>
        <p style="font-size: 13px; color: #94A3B8; margin: 8px 0 14px;">
          Compartilhe seu código! Seu amigo ganha <strong style="color:#10B981;">R$ 5,00 de desconto</strong> na 1ª viagem e você ganha <strong style="color:#38BDF8;">R$ 5,00 de bônus</strong> assim que ele concluir a corrida.
        </p>
        <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px dashed #10B981; border-radius: 14px; padding: 14px; text-align: center; margin-bottom: 14px;">
          <small style="color: #94A3B8; font-size: 10px; text-transform: uppercase; font-weight: 800;">Seu Código Exclusivo</small>
          <div id="lblMeuCodigoIndicacao" style="font-size: 24px; font-weight: 900; color: #10B981; letter-spacing: 2px; margin: 4px 0;">HUBY-...</div>
          <small id="lblResumoIndicacoes" style="color: #CBD5E1; font-size: 11px;">Carregando seu extrato...</small>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="btnCopiarCodigoInd" class="btn-secondary-modal" style="flex: 1;">📋 Copiar</button>
          <button type="button" id="btnCompartilharCodigoZap" class="btn-primary-modal" style="flex: 1.5;">📲 Enviar no WhatsApp</button>
        </div>
      </div>
    </div>

    <!-- MODAL CORRIDA AGENDADA -->
    <div id="modalAgendarCorrida" class="modal-backdrop" style="display: none; z-index: 10021;">
      <div class="modal-card">
        <div class="modal-header-row">
          <h3>⏰ Agendar Viagem</h3>
          <button type="button" id="btnFecharAgendar" class="btn-icon-close">✕</button>
        </div>
        <p style="font-size: 13px; color: #94A3B8; margin: 6px 0 14px;">
          Ideal para ir ao aeroporto, trabalho cedo ou compromissos com hora marcada.
        </p>
        <div style="text-align: left; margin-bottom: 14px;">
          <label style="display: block; font-size: 11px; font-weight: 800; color: #CBD5E1; margin-bottom: 6px; text-transform: uppercase;">Data e Hora do Embarque</label>
          <input type="datetime-local" id="inputDataHoraAgendamento"
            style="width: 100%; background: #090D16; border: 1px solid rgba(56,189,248,0.4); border-radius: 10px; padding: 12px; color: #FFF; font-size: 14px; outline: none;">
        </div>
        <button type="button" id="btnConfirmarAgendamento" class="btn-primary-modal" style="width: 100%;">
          ✅ Confirmar Agendamento
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  document.getElementById('btnFecharIndique')?.addEventListener('click', () => {
    document.getElementById('modalIndiqueGanhe').style.display = 'none';
  });
  document.getElementById('btnFecharAgendar')?.addEventListener('click', () => {
    document.getElementById('modalAgendarCorrida').style.display = 'none';
  });

  document.getElementById('btnCopiarCodigoInd')?.addEventListener('click', async () => {
    const cod = document.getElementById('lblMeuCodigoIndicacao')?.textContent || '';
    await navigator.clipboard.writeText(cod);
    document.getElementById('btnCopiarCodigoInd').textContent = '✅ Copiado!';
    setTimeout(() => { document.getElementById('btnCopiarCodigoInd').textContent = '📋 Copiar'; }, 2000);
  });

  document.getElementById('btnCompartilharCodigoZap')?.addEventListener('click', () => {
    const cod = document.getElementById('lblMeuCodigoIndicacao')?.textContent || '';
    const msg = encodeURIComponent(`🚘 Baixe ou acesse o *HUBy* e ganhe *R$ 5,00 de desconto* na sua 1ª corrida usando meu código de convite: *${cod}*\n\nAcesse: https://hubymovi-01.github.io/HUBy/cadastro.html`);
    window.open(`https://wa.me/?text=${msg}`, '_blank');
  });

  document.getElementById('btnConfirmarAgendamento')?.addEventListener('click', () => {
    const val = document.getElementById('inputDataHoraAgendamento')?.value;
    if (!val) {
      alert('Selecione a data e o horário desejados.');
      return;
    }
    const dt = new Date(val);
    if ((dt.getTime() - Date.now()) / 60000 < 25) {
      alert('Escolha um horário com pelo menos 30 minutos de antecedência.');
      return;
    }

    window._hubyAgendadoPara = dt.toISOString();
    document.getElementById('modalAgendarCorrida').style.display = 'none';

    const btnAgendar = document.getElementById('btnAbrirAgendamento');
    if (btnAgendar) {
      const horaFmt = dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      btnAgendar.innerHTML = `<span>⏰ ${horaFmt}</span>`;
      btnAgendar.style.borderColor = '#10B981';
      btnAgendar.style.color = '#10B981';
    }
  });
}

async function abrirModalIndiqueEGanhe() {
  criarModaisExtras();
  const modal = document.getElementById('modalIndiqueGanhe');
  modal.style.display = 'flex';

  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_URL}/api/indicacoes/meu-codigo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('lblMeuCodigoIndicacao').textContent = data.codigo || 'HUBY-VIP';
    document.getElementById('lblResumoIndicacoes').textContent =
      `${(data.indicados || []).length} amigo(s) indicado(s) • Total ganho: R$ ${Number(data.totalGanho || 0).toFixed(2).replace('.', ',')}`;
  } catch (e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  criarModaisExtras();

  // Injeta item "Indique e Ganhe" no menu lateral do passageiro
  const nav = document.querySelector('.drawer-nav');
  if (nav && !document.getElementById('menuItemIndique')) {
    const link = document.createElement('a');
    link.href = '#';
    link.id = 'menuItemIndique';
    link.className = 'drawer-item';
    link.innerHTML = `
      <span class="d-icon">🎁</span>
      <div class="d-info"><strong>Indique e Ganhe</strong><small>Ganhe R$ 5,00 por amigo indicado</small></div>
    `;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('menuBackdrop')?.click();
      abrirModalIndiqueEGanhe();
    });
    nav.appendChild(link);
  }

  // Injeta botão "⏰ Agendar" na linha de ações rápidas do dock
  const actionsRow = document.querySelector('.dock-quick-actions-row');
  if (actionsRow && !document.getElementById('btnAbrirAgendamento')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btnAbrirAgendamento';
    btn.className = 'btn-dock-quick-pill modern-pill';
    btn.innerHTML = '<span>⏰ Agendar</span>';
    btn.addEventListener('click', () => {
      const minDate = new Date(Date.now() + 35 * 60000);
      const localIso = new Date(minDate.getTime() - minDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const inp = document.getElementById('inputDataHoraAgendamento');
      if (inp) {
        inp.min = localIso;
        if (!inp.value) inp.value = localIso;
      }
      document.getElementById('modalAgendarCorrida').style.display = 'flex';
    });
    actionsRow.appendChild(btn);
  }

  // Intercepta fetch de criação de pedido para anexar automaticamente o horário agendado se escolhido
  const originalFetch = window.fetch;
  window.fetch = async function (resource, init) {
    if (typeof resource === 'string' && resource.endsWith('/api/pedidos') && init?.method === 'POST' && window._hubyAgendadoPara) {
      try {
        const bodyObj = JSON.parse(init.body);
        bodyObj.agendadoPara = window._hubyAgendadoPara;
        init.body = JSON.stringify(bodyObj);
        window._hubyAgendadoPara = null;
      } catch (e) {}
    }
    return originalFetch.apply(this, arguments);
  };
});