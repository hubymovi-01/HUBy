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

    if (resp.ok) {
      const dados = await resp.json();
      estado.ganhosHoje = Number(dados.ganhosHoje || 0);
      estado.corridasHoje = Number(dados.corridasHoje || 0);
    }
  } catch (err) {
    console.warn('Aviso: endpoint ganhos-hoje ainda não respondeu, usando valores locais:', err);
  } finally {
    renderizarCardGanhosHoje();
  }
}

export function configurarAjusteMetaDiaria() {
  const btnEditarMeta = document.getElementById('btnEditarMetaDiaria');
  if (!btnEditarMeta) {
    console.warn('Botão #btnEditarMetaDiaria não encontrado no DOM.');
    return;
  }

  btnEditarMeta.addEventListener('click', (e) => {
    e.preventDefault();
    const metaAtual = estado.metaDiaria || 200;
    const novaMeta = prompt('Defina a sua meta diária de faturamento (R$):', metaAtual);
    
    if (novaMeta !== null) {
      const valorNum = parseFloat(novaMeta.replace(',', '.'));
      if (!isNaN(valorNum) && valorNum > 0) {
        estado.metaDiaria = valorNum;
        localStorage.setItem('huby_meta_diaria', valorNum);
        renderizarCardGanhosHoje();
      } else {
        alert('Por favor, informe um valor numérico válido.');
      }
    }
  });
}

export function renderizarCardGanhosHoje() {
  const lblValor = document.getElementById('lblGanhosHojeValor');
  const lblQtd = document.getElementById('lblCorridasHojeQtd');
  const barraProgresso = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  const ganhos = estado.ganhosHoje || 0;
  const meta = estado.metaDiaria || 200;
  const percentual = Math.min(Math.round((ganhos / meta) * 100), 100);

  if (lblValor) lblValor.textContent = `R$ ${ganhos.toFixed(2).replace('.', ',')}`;
  if (lblQtd) lblQtd.textContent = `${estado.corridasHoje || 0} ${estado.corridasHoje === 1 ? 'viagem' : 'viagens'}`;
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
  if (!token) return;

  try {
    // 1. Tenta a rota dedicada de extrato
    let resp = await fetch(`${API_URL}/api/motoristas/extrato`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let saques = [];
    let corridas = [];

    if (resp.ok) {
      const data = await resp.json();
      saques = Array.isArray(data.saques) ? data.saques : [];
      corridas = Array.isArray(data.corridas) ? data.corridas : [];
    } else {
      // 2. Fallback caso a rota acima ainda não esteja no backend: busca histórico de pedidos
      const respHistorico = await fetch(`${API_URL}/api/pedidos/historico`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (respHistorico.ok) {
        const dataHist = await respHistorico.json();
        corridas = Array.isArray(dataHist) ? dataHist : (dataHist.viagens || []);
      }
    }

    if (saques.length === 0 && corridas.length === 0) {
      listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Nenhuma movimentação registrada hoje.</div>';
      return;
    }

    let html = '';

    // Renderiza saques recentes
    saques.slice(0, 5).forEach(s => {
      const corStatus = s.status === 'pago' ? '#10B981' : (s.status === 'recusado' ? '#EF4444' : '#F59E0B');
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
          <div>
            <strong style="color: #FFF; display: block;">Saque Pix</strong>
            <small style="color: ${corStatus}; font-weight: 700; text-transform: uppercase;">${s.status}</small>
          </div>
          <span style="color: #EF4444; font-weight: 800;">- R$ ${Number(s.valor || 0).toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    // Renderiza corridas recentes
    corridas.slice(0, 8).forEach(c => {
      const repasse = Number(c.repasse_liquido || (Number(c.valor_total || 0) * 0.85));
      const local = c.destino_endereco ? c.destino_endereco.split(',')[0].trim() : 'Viagem Concluída';
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
          <div>
            <strong style="color: #FFF; display: block;">Viagem HUBy</strong>
            <small style="color: var(--text-sec); font-size: 11px;">${local}</small>
          </div>
          <span style="color: #10B981; font-weight: 800;">+ R$ ${repasse.toFixed(2).replace('.', ',')}</span>
        </div>
      `;
    });

    listaEl.innerHTML = html;
  } catch (err) {
    console.warn('Extrato indisponível no momento:', err);
    listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Sem movimentações no período.</div>';
  }
}