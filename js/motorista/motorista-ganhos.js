// js/motorista/motorista-ganhos.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';

export async function carregarGanhosHoje() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/ganhos-hoje`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) return;
    const dados = await resp.json();

    estado.ganhosHoje = Number(dados.ganhosHoje || 0);
    estado.corridasHoje = Number(dados.corridasHoje || 0);

    renderizarCardGanhosHoje();
  } catch (err) {
    console.warn('Erro ao carregar ganhos diários:', err);
  }
}

export function configurarAjusteMetaDiaria() {
  const btnEditarMeta = document.getElementById('btnEditarMetaDiaria');
  if (!btnEditarMeta) return;

  btnEditarMeta.addEventListener('click', () => {
    const novaMeta = prompt('Defina a sua meta diária de faturamento (R$):', estado.metaDiaria);
    const valorNum = parseFloat(novaMeta);

    if (!isNaN(valorNum) && valorNum > 0) {
      estado.metaDiaria = valorNum;
      localStorage.setItem('huby_meta_diaria', valorNum);
      renderizarCardGanhosHoje();
    }
  });
}

export function renderizarCardGanhosHoje() {
  const lblValor = document.getElementById('lblGanhosHojeValor');
  const lblQtd = document.getElementById('lblCorridasHojeQtd');
  const barraProgresso = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  const ganhos = estado.ganhosHoje;
  const meta = estado.metaDiaria;
  const percentual = Math.min(Math.round((ganhos / meta) * 100), 100);

  if (lblValor) lblValor.textContent = `R$ ${ganhos.toFixed(2).replace('.', ',')}`;
  if (lblQtd) lblQtd.textContent = `${estado.corridasHoje} ${estado.corridasHoje === 1 ? 'viagem' : 'viagens'}`;
  if (lblMetaTxt) lblMetaTxt.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${percentual}%)`;

  if (barraProgresso) {
    barraProgresso.style.width = `${percentual}%`;
    barraProgresso.style.background = percentual >= 100 ? '#10B981' : '#38BDF8';
  }
}

export async function carregarExtratoFinanceiro() {
  const listaEl = document.getElementById('drawerListaExtrato');
  if (!listaEl) return;

  const token = localStorage.getItem('huby_token');
  try {
    const resp = await fetch(`${API_URL}/api/motoristas/extrato`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 8px;">Sem lançamentos recentes.</div>';
      return;
    }

    const { saques, corridas } = await resp.json();

    if ((!saques || saques.length === 0) && (!corridas || corridas.length === 0)) {
      listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 8px;">Nenhuma movimentação registada.</div>';
      return;
    }

    let html = '';

    (saques || []).slice(0, 5).forEach(s => {
      const corStatus = s.status === 'pago' ? '#10B981' : (s.status === 'recusado' ? '#EF4444' : '#F59E0B');
      html += `
        <div class="item-extrato">
          <div>
            <strong style="color: #FFF; display: block;">Saque Pix</strong>
            <small style="color: ${corStatus}; font-weight: 700; text-transform: uppercase;">${s.status}</small>
          </div>
          <span style="color: #EF4444; font-weight: 800;">- R$ ${Number(s.valor).toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    (corridas || []).slice(0, 8).forEach(c => {
      const repasse = Number(c.repasse_liquido || (Number(c.valor_total) * 0.85));
      html += `
        <div class="item-extrato">
          <div>
            <strong style="color: #FFF; display: block;">Viagem Concluída</strong>
            <small style="color: var(--text-sec);">${c.destino_endereco ? c.destino_endereco.substring(0, 22) + '...' : 'Viagem'}</small>
          </div>
          <span style="color: #10B981; font-weight: 800;">+ R$ ${repasse.toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    listaEl.innerHTML = html;
  } catch (err) {
    listaEl.innerHTML = '<div style="text-align: center; color: var(--rose); font-size: 11px; padding: 8px;">Erro ao ler extrato.</div>';
  }
}