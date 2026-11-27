// js/motorista/motorista-ganhos.js - Ganhos do dia, Meta diária e Extrato
// Os valores vêm do servidor (já calculados com a taxa do nível do motorista).
import { API_URL, sonsHUBy, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';

let metaComemorada = false;

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function reais(valor) {
  const n = Number(valor);
  return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`;
}

// Taxa do nível do motorista (cai na taxa geral só se o perfil ainda não carregou)
function fatorRepasse() {
  const taxaNivel = Number(estado.taxaHubyMotorista);
  const taxa = Number.isFinite(taxaNivel) ? taxaNivel : Number(TAXA_PLATAFORMA_ATUAL ?? 15);
  return Math.max(0.1, (100 - taxa) / 100);
}

export async function carregarGanhosHoje() {
  try {
    const resp = await fetch(`${API_URL}/api/motoristas/ganhos-hoje?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });

    if (resp.ok) {
      const dados = await resp.json();
      estado.ganhosHoje = Number(dados.ganhosHoje || 0);
      estado.corridasHoje = Number(dados.corridasHoje || 0);
    }
  } catch (err) {
    // Sem rede: mantém os últimos valores na tela
  } finally {
    renderizarCardGanhosHoje();
  }
}

// Mantida por compatibilidade: a meta é editada pelo modal do app-motorista.js
export function configurarAjusteMetaDiaria() {}

export function renderizarCardGanhosHoje() {
  const lblValor = document.getElementById('lblGanhosHojeValor');
  const lblQtd = document.getElementById('lblCorridasHojeQtd');
  const barraProgresso = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  const ganhos = Number(estado.ganhosHoje || 0);
  const meta = Number(estado.metaDiaria || localStorage.getItem('huby_meta_diaria') || 200) || 200;
  const percentual = Math.min(Math.round((ganhos / meta) * 100), 100);
  const qtd = Number(estado.corridasHoje || 0);

  if (lblValor) lblValor.textContent = reais(ganhos);
  if (lblQtd) lblQtd.textContent = `${qtd} ${qtd === 1 ? 'viagem' : 'viagens'}`;

  if (lblMetaTxt) {
    lblMetaTxt.textContent = percentual >= 100
      ? `Meta: ${reais(meta)} (100% batida! 🎉)`
      : `Meta: ${reais(meta)} (${percentual}%)`;
    lblMetaTxt.style.color = percentual >= 100 ? '#10B981' : '';
    lblMetaTxt.style.fontWeight = percentual >= 100 ? '800' : '';
  }

  if (barraProgresso) {
    barraProgresso.style.width = `${percentual}%`;
    if (percentual >= 100) {
      barraProgresso.style.background = '#10B981';
      barraProgresso.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.7)';
    } else {
      barraProgresso.style.background = '#38BDF8';
      barraProgresso.style.boxShadow = 'none';
    }
  }

  if (percentual >= 100 && !metaComemorada && ganhos > 0) {
    metaComemorada = true;
    if (sonsHUBy?.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
  } else if (percentual < 100) {
    metaComemorada = false;
  }
}

const ROTULOS_SAQUE = {
  pago: 'Pago',
  pendente: 'Pendente',
  processando: 'Processando',
  recusado: 'Recusado'
};

export async function carregarExtratoFinanceiro() {
  const listaEl = document.getElementById('drawerListaExtrato');
  if (!listaEl) return;

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/extrato?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });
    if (!resp.ok) throw new Error('falha');

    const data = await resp.json();
    const saques = Array.isArray(data.saques) ? data.saques : [];
    const corridas = Array.isArray(data.corridas) ? data.corridas : [];

    if (saques.length === 0 && corridas.length === 0) {
      listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Nenhuma movimentação registrada ainda.</div>';
      return;
    }

    const fator = fatorRepasse();
    let html = '';

    saques.slice(0, 5).forEach((s) => {
      const st = String(s.status || 'pendente').toLowerCase();
      const corStatus = st === 'pago' ? '#10B981' : (st === 'recusado' ? '#EF4444' : '#F59E0B');
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px;">
          <div>
            <strong style="color: #FFF; display: block;">Saque Pix</strong>
            <small style="color: ${corStatus}; font-weight: 700; text-transform: uppercase;">${escaparHTML(ROTULOS_SAQUE[st] || st)}</small>
          </div>
          <span style="color: #EF4444; font-weight: 800;">- ${reais(s.valor)}</span>
        </div>
      `;
    });

    corridas.slice(0, 8).forEach((c) => {
      const repasse = c.repasse_liquido !== undefined && c.repasse_liquido !== null
        ? Number(c.repasse_liquido)
        : Number(c.valor_total || 0) * fator;
      const local = c.destino_endereco ? String(c.destino_endereco).split(',')[0].trim().slice(0, 60) : 'Viagem concluída';
      html += `
        <div class="item-extrato" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px; gap: 8px;">
          <div style="min-width: 0;">
            <strong style="color: #FFF; display: block;">Viagem HUBy</strong>
            <small style="color: var(--text-sec); font-size: 11px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escaparHTML(local)}</small>
          </div>
          <span style="color: #10B981; font-weight: 800; flex-shrink: 0;">+ ${reais(repasse)}</span>
        </div>
      `;
    });

    listaEl.innerHTML = html;
  } catch (err) {
    listaEl.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 8px;">Não foi possível carregar o extrato agora.</div>';
  }
}