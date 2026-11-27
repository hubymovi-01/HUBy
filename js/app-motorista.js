/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Versão Sincronizada em Tempo Real + Clube HUBy Pro (Bronze/Prata/Ouro) + Histórico Detalhado + Suporte
 * Segurança: textos vindos de fora (endereços, mensagens do suporte) são exibidos como texto puro.
 */

import { API_URL, sincronizarTarifasServidor, aplicarObjetoTarifas } from './config.js';
import { estado } from './motorista/motorista-estado.js';
import { inicializarSocket, inicializarMapa } from './motorista/motorista-mapa.js';
import { alternarStatusOnline, iniciarRadarChamadas, taxaDoMotorista } from './motorista/motorista-radar.js';
import {
  carregarPerfil,
  configurarSalvarPreferenciasPagto,
  configurarEdicaoPerfil
} from './motorista/motorista-perfil.js';
import { configurarChatMotorista } from './motorista/motorista-chat.js';
import { configurarEventosSaque } from './motorista/motorista-carteira.js';
import { configurarMarketplace } from './motorista/motorista-loja.js';
import { inicializarPushNotifications } from './motorista/motorista-push.js';
import { configurarModosInteligentes } from './motorista/motorista-modos.js';
import { inicializarZonasRiscoMapa } from './motorista/motorista-zonas-risco.js';
import { processarFilaOfflineMotorista, executarCancelamentoCorridaMotorista } from './motorista/motorista-corrida.js';
import { notificar } from './util/alertas-huby.js';

const NIVEIS_CLUBE_PADRAO = {
  bronze: { nome: 'Bronze', corridas_min: 0, nota_min: 0.0, taxa_huby: 15 },
  prata: { nome: 'Prata', corridas_min: 50, nota_min: 4.8, taxa_huby: 12 },
  ouro: { nome: 'Ouro', corridas_min: 150, nota_min: 4.9, taxa_huby: 10 }
};

function escaparHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numero(valor, padrao = 0) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

function validarAutenticacaoMotorista() {
  const token = localStorage.getItem('huby_token');
  const role = String(localStorage.getItem('huby_user_role') || '').toLowerCase().trim();

  if (!token || token === 'null' || token === 'undefined') {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  if (role && !['motorista', 'admin', 'administrador'].includes(role)) {
    window.location.replace('./login.html?perfil=motorista');
    return false;
  }

  return true;
}

export function atualizarTextosPercentualRepasse() {
  const taxa = taxaDoMotorista();
  const pctLiquido = Math.max(1, 100 - taxa);

  const lblCarteira = document.querySelector('.wallet-meta small');
  if (lblCarteira) lblCarteira.textContent = `Saldo Disponível (${pctLiquido}%)`;

  const lblRepasseMeta = document.getElementById('lblRepassePctMotorista');
  if (lblRepasseMeta) lblRepasseMeta.textContent = `${pctLiquido}% repasse líquido`;

  const lblSaquePct = document.getElementById('lblSaldoDisponivelSaquePct');
  if (lblSaquePct) lblSaquePct.textContent = `Saldo Disponível (${pctLiquido}% Líquido)`;

  const lblTaxaModal = document.getElementById('lblTaxaModalPagamento');
  if (lblTaxaModal) lblTaxaModal.textContent = `Taxa HUBy: ${taxa}% retidos pela plataforma`;

  const lblTaxaDin = document.getElementById('lblTaxaDinheiroDesc');
  if (lblTaxaDin) lblTaxaDin.textContent = `Você recebe 100% em mãos. A taxa de ${taxa}% é descontada da carteira.`;

  const lblTaxaMaq = document.getElementById('lblTaxaMaquininhaDesc');
  if (lblTaxaMaq) lblTaxaMaq.textContent = `Passou no seu cartão. A taxa de ${taxa}% é descontada da sua carteira.`;
}

// ============================================================================
// CLUBE HUBY PRO: SELO DE NÍVEL (BRONZE / PRATA / OURO) & BARRA DE PROGRESSO
// ============================================================================
export async function atualizarClubeProMotorista(notificarPromocao = false) {
  const token = localStorage.getItem('huby_token') || '';
  if (!token) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/perfil?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return;

    const perfil = await resp.json();
    const nivelAnterior = estado.nivelMotorista || null;

    const nivelBruto = String(perfil.nivel || 'bronze').toLowerCase();
    const nivel = ['bronze', 'prata', 'ouro'].includes(nivelBruto) ? nivelBruto : 'bronze';
    const totalCorridas = Math.max(0, Math.round(numero(perfil.total_corridas, 0)));
    const notaMedia = numero(perfil.avaliacao_media, 5.0);
    const niveisCfg = (perfil.niveis_config && typeof perfil.niveis_config === 'object') ? perfil.niveis_config : NIVEIS_CLUBE_PADRAO;
    const taxaAtual = numero(
      perfil.taxa_huby_atual ?? niveisCfg[nivel]?.taxa_huby,
      NIVEIS_CLUBE_PADRAO[nivel].taxa_huby
    );

    estado.nivelMotorista = nivel;
    estado.taxaHubyMotorista = taxaAtual;
    estado.totalCorridasMotorista = totalCorridas;
    estado.avaliacaoMotorista = notaMedia;
    estado.niveisConfig = niveisCfg;

    atualizarTextosPercentualRepasse();
    renderizarSeloEProgressoClubePro({ nivel, totalCorridas, notaMedia, taxaAtual, niveisCfg });

    if (notificarPromocao && nivelAnterior && nivelAnterior !== nivel) {
      const titulos = { prata: '🥈 Prata', ouro: '🥇 Ouro', bronze: '🥉 Bronze' };
      notificar(
        `🎉 Você agora é Nível ${titulos[nivel]} no Clube HUBy Pro (Taxa de ${taxaAtual}%)!`,
        'sucesso',
        7000
      );
    }
  } catch (err) {
    console.warn('Aviso ao carregar Clube HUBy Pro:', err);
  }
}

function renderizarSeloEProgressoClubePro({ nivel, totalCorridas, notaMedia, taxaAtual, niveisCfg }) {
  const pctRepasse = Math.max(1, 100 - taxaAtual);

  const temas = {
    bronze: {
      icone: '🥉',
      titulo: 'Nível Bronze',
      cor: '#D97706',
      corClaro: '#FBBF24',
      bg: 'rgba(217, 119, 6, 0.14)',
      borda: 'rgba(245, 158, 11, 0.45)',
      prioridade: 'Fila padrão de chamadas'
    },
    prata: {
      icone: '🥈',
      titulo: 'Nível Prata',
      cor: '#94A3B8',
      corClaro: '#E2E8F0',
      bg: 'rgba(148, 163, 184, 0.16)',
      borda: 'rgba(203, 213, 225, 0.5)',
      prioridade: '⚡ Prioridade Intermediária (+4s antes)'
    },
    ouro: {
      icone: '🥇',
      titulo: 'Nível Ouro',
      cor: '#F59E0B',
      corClaro: '#FDE047',
      bg: 'rgba(245, 158, 11, 0.18)',
      borda: 'rgba(250, 204, 21, 0.65)',
      prioridade: '⚡ Prioridade Máxima Imediata nas Chamadas'
    }
  };

  const visual = temas[nivel] || temas.bronze;

  let progressoPct = 100;
  let textoMetaHTML = '';

  const montarMeta = (proximoNome, corridasMeta, notaMeta, taxaProxima) => {
    const faltam = Math.max(0, corridasMeta - totalCorridas);
    return faltam > 0
      ? `Faltam <strong>${faltam} corrida(s)</strong> (e nota ≥ ${notaMeta.toFixed(1)}) para <strong>${proximoNome}</strong> (taxa de ${taxaProxima}%)`
      : `Mantenha nota ≥ <strong>${notaMeta.toFixed(1)}</strong> para ativar <strong>${proximoNome}</strong>`;
  };

  if (nivel === 'bronze') {
    const corridasMeta = numero(niveisCfg.prata?.corridas_min, 50);
    const notaMeta = numero(niveisCfg.prata?.nota_min, 4.8);
    const taxaProxima = numero(niveisCfg.prata?.taxa_huby, 12);
    progressoPct = corridasMeta > 0 ? Math.min(100, Math.round((totalCorridas / corridasMeta) * 100)) : 100;
    textoMetaHTML = montarMeta('🥈 Prata', corridasMeta, notaMeta, taxaProxima);
  } else if (nivel === 'prata') {
    const corridasMeta = numero(niveisCfg.ouro?.corridas_min, 150);
    const notaMeta = numero(niveisCfg.ouro?.nota_min, 4.9);
    const taxaProxima = numero(niveisCfg.ouro?.taxa_huby, 10);
    const basePrata = numero(niveisCfg.prata?.corridas_min, 50);
    const faixa = Math.max(1, corridasMeta - basePrata);
    progressoPct = Math.min(100, Math.max(5, Math.round(((totalCorridas - basePrata) / faixa) * 100)));
    textoMetaHTML = montarMeta('🥇 Ouro', corridasMeta, notaMeta, taxaProxima);
  } else {
    progressoPct = 100;
    textoMetaHTML = `🏆 Você atingiu o nível máximo! Aproveite a menor taxa (<strong>${taxaAtual}%</strong>) e prioridade total.`;
  }

  // 1. Selo compacto no topo da tela
  const badgeTop = document.getElementById('badgeNivelTopMotorista');
  if (badgeTop) {
    badgeTop.style.background = visual.bg;
    badgeTop.style.border = `1px solid ${visual.borda}`;
    badgeTop.style.color = visual.corClaro;
    badgeTop.textContent = `${visual.icone} ${nivel.toUpperCase()} • ${pctRepasse}%`;
  }

  // 2. Cartão completo no topo do Menu Lateral (só números e textos fixos entram no HTML)
  const drawerContent = document.querySelector('#driverDrawer .drawer-content');
  if (!drawerContent) return;

  let cardPro = document.getElementById('cardClubeHubyPro');
  if (!cardPro) {
    cardPro = document.createElement('div');
    cardPro.id = 'cardClubeHubyPro';
    drawerContent.insertAdjacentElement('afterbegin', cardPro);
  }

  cardPro.style.cssText = [
    'background: linear-gradient(135deg, #0F172A 0%, #111827 100%)',
    `border: 1.5px solid ${visual.borda}`,
    'border-radius: 16px',
    'padding: 14px',
    'margin-bottom: 12px',
    'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35)'
  ].join(';');

  cardPro.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 24px; line-height: 1;">${visual.icone}</span>
        <div>
          <div style="font-size: 14px; font-weight: 900; color: ${visual.corClaro}; letter-spacing: 0.3px;">
            ${visual.titulo}
          </div>
          <small style="font-size: 11px; color: #94A3B8; font-weight: 600;">
            ${totalCorridas} corridas • ⭐ ${notaMedia.toFixed(2)}
          </small>
        </div>
      </div>
      <div style="text-align: right; background: ${visual.bg}; border: 1px solid ${visual.borda}; padding: 5px 10px; border-radius: 10px;">
        <small style="display: block; font-size: 9.5px; color: #CBD5E1; text-transform: uppercase; font-weight: 800;">Taxa HUBy</small>
        <strong style="font-size: 14px; color: ${visual.corClaro}; font-weight: 900;">${taxaAtual}%</strong>
      </div>
    </div>

    <div style="font-size: 11px; color: #38BDF8; font-weight: 700; margin-bottom: 8px; background: rgba(56, 189, 248, 0.08); padding: 5px 8px; border-radius: 8px;">
      ${visual.prioridade}
    </div>

    <div style="width: 100%; height: 8px; background: rgba(255, 255, 255, 0.08); border-radius: 999px; overflow: hidden; margin-bottom: 6px;">
      <div style="width: ${progressoPct}%; height: 100%; background: linear-gradient(90deg, ${visual.cor}, ${visual.corClaro}); border-radius: 999px; transition: width 0.4s ease;"></div>
    </div>

    <div style="font-size: 11px; color: #CBD5E1; line-height: 1.35;">
      ${textoMetaHTML}
    </div>
  `;
}

export function atualizarBarraMetaDiaria(novoValorMeta = null) {
  if (novoValorMeta !== null && Number(novoValorMeta) >= 10) {
    estado.metaDiaria = Number(novoValorMeta);
    localStorage.setItem('huby_meta_diaria', String(estado.metaDiaria));
  }

  const meta = numero(estado.metaDiaria || localStorage.getItem('huby_meta_diaria'), 200) || 200;
  const ganhosNumerico = numero(estado.ganhosHoje, 0);

  const percentual = meta > 0 ? Math.min(100, Math.round((ganhosNumerico / meta) * 100)) : 0;

  const barra = document.getElementById('barraProgressoMeta');
  const lblMeta = document.getElementById('lblMetaDiariaTxt');

  if (barra) {
    barra.style.width = `${percentual}%`;
    barra.style.background = percentual >= 100 ? '#10B981' : '#38BDF8';
  }
  if (lblMeta) {
    lblMeta.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${percentual}%)`;
  }
}

function configurarMetaDiaria() {
  const btnAbrir = document.getElementById('btnEditarMetaDiaria');
  const modal = document.getElementById('modalMetaDiaria');
  const btnFechar = document.getElementById('btnFecharModalMeta');
  const btnCancelar = document.getElementById('btnCancelarModalMeta');
  const btnSalvar = document.getElementById('btnSalvarMetaDiaria') || document.getElementById('btnSalvarMetaDiariaLocal');
  const inputValor = document.getElementById('inputValorMetaDiaria');

  const abrirModalMeta = () => {
    if (!modal) return;
    const metaAtual = numero(estado.metaDiaria || localStorage.getItem('huby_meta_diaria'), 200);
    if (inputValor) inputValor.value = metaAtual.toFixed(2);
    modal.style.display = 'flex';
  };

  const fecharModalMeta = () => {
    if (modal) modal.style.display = 'none';
  };

  if (btnAbrir) {
    btnAbrir.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      abrirModalMeta();
    };
  }

  if (btnFechar) btnFechar.onclick = fecharModalMeta;
  if (btnCancelar) btnCancelar.onclick = fecharModalMeta;

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fecharModalMeta();
  });

  document.querySelectorAll('.btn-fast-meta').forEach((btn) => {
    btn.onclick = () => {
      const val = btn.getAttribute('data-meta');
      if (val && inputValor) inputValor.value = Number(val).toFixed(2);
    };
  });

  if (btnSalvar) {
    btnSalvar.onclick = () => {
      const valorDigitado = parseFloat(String(inputValor?.value || '').replace(',', '.'));
      if (!valorDigitado || valorDigitado < 10 || valorDigitado > 100000) {
        notificar('Informe uma meta diária a partir de R$ 10,00.', 'alerta');
        return;
      }

      atualizarBarraMetaDiaria(valorDigitado);
      fecharModalMeta();
      notificar(`🎯 Meta diária atualizada para R$ ${valorDigitado.toFixed(2).replace('.', ',')}!`, 'sucesso');
    };
  }

  atualizarBarraMetaDiaria();
}

function corridaAtualDoMotoristaId() {
  return String(estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id || localStorage.getItem('huby_corrida_ativa_mot_id') || '');
}

// Usa a conexão principal (a do mapa): não abre conexões extras
function escutarAtualizacaoTarifasTempoReal() {
  const socket = estado.socket;
  if (!socket) return;

  socket.on('tarifas_atualizadas', async (novasTarifas) => {
    aplicarObjetoTarifas(novasTarifas);
    await atualizarClubeProMotorista(false);
    // O radar já atualiza as chamadas sozinho quando as tarifas mudam
  });

  // Só recarrega o nível quando a corrida finalizada é DESTE motorista
  socket.on('corrida_finalizada', async (dados) => {
    const minha = corridaAtualDoMotoristaId();
    if (minha && String(dados?.pedidoId) === minha) {
      setTimeout(() => atualizarClubeProMotorista(true), 1500);
    }
  });
}

// Compatibilidade: outros módulos (ex.: copiloto de voz) podem chamar este nome
export async function cancelarCorridaPeloMotorista(pedidoIdAlvo = null) {
  const id = pedidoIdAlvo || corridaAtualDoMotoristaId();
  const dados = estado.pedidoAtivo || estado.pedidoAceitoAtual || (id ? { id } : null);
  if (!dados) {
    notificar('Nenhuma corrida ativa encontrada para cancelar.', 'alerta');
    return;
  }
  await executarCancelamentoCorridaMotorista(dados);
}

window.cancelarCorridaPeloMotorista = cancelarCorridaPeloMotorista;

// ============================================================================
// HISTÓRICO DETALHADO DE CORRIDAS E REPASSES DO MOTORISTA
// ============================================================================
function configurarHistoricoCorridasMotorista() {
  const drawerContent = document.querySelector('#driverDrawer .drawer-content');
  if (!drawerContent || document.getElementById('btnAbrirHistoricoMotorista')) return;

  const btnHistorico = document.createElement('button');
  btnHistorico.type = 'button';
  btnHistorico.id = 'btnAbrirHistoricoMotorista';
  btnHistorico.style.cssText = [
    'width: 100%',
    'margin-bottom: 12px',
    'padding: 13px 14px',
    'border-radius: 12px',
    'background: rgba(56, 189, 248, 0.14)',
    'border: 1.5px solid rgba(56, 189, 248, 0.4)',
    'color: #38BDF8',
    'font-weight: 900',
    'font-size: 13px',
    'cursor: pointer',
    'display: flex',
    'align-items: center',
    'justify-content: space-between'
  ].join(';');
  btnHistorico.innerHTML = `
    <span>📋 Minhas Corridas & Ganhos</span>
    <span style="font-size: 11px; background: rgba(56,189,248,0.2); padding: 2px 8px; border-radius: 999px;">Ver extrato</span>
  `;

  const cardPro = document.getElementById('cardClubeHubyPro');
  if (cardPro) {
    cardPro.insertAdjacentElement('afterend', btnHistorico);
  } else {
    drawerContent.insertAdjacentElement('afterbegin', btnHistorico);
  }

  btnHistorico.addEventListener('click', () => {
    document.getElementById('driverDrawer')?.classList.remove('active');
    document.getElementById('drawerOverlay')?.classList.remove('active');
    abrirModalHistoricoDetalhadoMotorista();
  });
}

async function abrirModalHistoricoDetalhadoMotorista() {
  document.getElementById('modalHistoricoDetalhadoMotorista')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modalHistoricoDetalhadoMotorista';
  overlay.className = 'modal-backdrop-custom active';
  overlay.style.cssText = 'display:flex; z-index:10030;';
  overlay.innerHTML = `
    <div class="modal-box-edit" style="max-width: 440px; max-height: 86dvh; display: flex; flex-direction: column; padding: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div>
          <h3 style="margin: 0; font-size: 17px; font-weight: 900; color: #FFF;">📋 Minhas Corridas & Ganhos</h3>
          <small style="color: #94A3B8; font-size: 11px;">Ganho estimado com a sua taxa atual de nível</small>
        </div>
        <button type="button" id="btnFecharHistMot" style="background: rgba(255,255,255,0.08); border: none; color: #FFF; width: 32px; height: 32px; border-radius: 50%; cursor: pointer;">✕</button>
      </div>
      <div id="listaCorridasDetalhadasMot" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
        <div style="text-align: center; color: #94A3B8; padding: 24px 0;">Carregando histórico de viagens...</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#btnFecharHistMot').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const listaEl = overlay.querySelector('#listaCorridasDetalhadasMot');
  const token = localStorage.getItem('huby_token') || '';
  const taxaPct = taxaDoMotorista();
  const fatorMot = Math.max(0.1, (100 - taxaPct) / 100);

  const rotulosStatus = {
    concluido: 'Concluída',
    cancelado: 'Cancelada',
    em_viagem: 'Em viagem',
    em_andamento: 'Em viagem',
    a_caminho: 'A caminho',
    aceito: 'Aceita',
    chegou_local: 'No local'
  };

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('falha');
    const dados = await resp.json();
    const corridas = Array.isArray(dados) ? dados : (Array.isArray(dados?.viagens) ? dados.viagens : []);

    if (corridas.length === 0) {
      listaEl.innerHTML = `<div style="text-align:center; color:#94A3B8; padding:30px 10px;">Nenhuma corrida registrada no seu histórico ainda.</div>`;
      return;
    }

    listaEl.innerHTML = corridas.slice(0, 100).map((c) => {
      const st = String(c.status || '').toLowerCase();
      const concluida = st === 'concluido';
      const bruto = numero(c.valor_total, 0);
      const liquido = concluida ? Number((bruto * fatorMot).toFixed(2)) : 0;
      const taxa = concluida ? Number((bruto - liquido).toFixed(2)) : 0;
      const dataObj = c.criado_em ? new Date(c.criado_em) : null;
      const dataFmt = dataObj && Number.isFinite(dataObj.getTime())
        ? dataObj.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '--';
      const corSt = concluida ? '#10B981' : (st === 'cancelado' ? '#EF4444' : '#38BDF8');
      const rotuloSt = rotulosStatus[st] || 'Em andamento';

      return `
        <div style="background: #090D16; border: 1px solid rgba(255,255,255,0.09); border-radius: 14px; padding: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; color: #94A3B8; font-weight: 700;">#${escaparHTML(String(c.id ?? '').slice(-4))} • ${escaparHTML(dataFmt)}</span>
            <span style="font-size: 10px; font-weight: 900; color: ${corSt}; text-transform: uppercase; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 6px;">${escaparHTML(rotuloSt)}</span>
          </div>
          <div style="font-size: 12.5px; color: #E2E8F0; margin-bottom: 8px; line-height: 1.35; word-break: break-word;">
            <div><strong style="color:#10B981;">A</strong> ${escaparHTML(c.origem_endereco || 'Origem')}</div>
            <div><strong style="color:#EF4444;">B</strong> ${escaparHTML(c.destino_endereco || 'Destino')}</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 10px; font-size: 11px;">
            <div>
              <small style="color:#94A3B8; display:block;">Seu Ganho</small>
              <strong style="color:#10B981; font-size:13px;">R$ ${liquido.toFixed(2).replace('.', ',')}</strong>
            </div>
            <div>
              <small style="color:#94A3B8; display:block;">Taxa (${taxaPct}%)</small>
              <strong style="color:#F59E0B;">R$ ${taxa.toFixed(2).replace('.', ',')}</strong>
            </div>
            <div style="text-align:right;">
              <small style="color:#94A3B8; display:block;">Valor da corrida</small>
              <strong style="color:#E2E8F0;">R$ ${bruto.toFixed(2).replace('.', ',')}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    listaEl.innerHTML = `<div style="text-align:center; color:#EF4444; padding:24px 0;">Falha ao carregar histórico de corridas.</div>`;
  }
}

// ============================================================================
// CHAT DE SUPORTE (mensagens sempre exibidas como texto puro)
// ============================================================================
function inicializarChatSuporte() {
  const btnAbrir = document.getElementById('btnAbrirChatSuporte');
  const btnFechar = document.getElementById('btnFecharChatSuporte');
  const modal = document.getElementById('modalChatSuporteIA');
  const inputMsg = document.getElementById('inputMsgSuporte');
  const btnEnviar = document.getElementById('btnEnviarMsgSuporte');
  const areaMensagens = document.getElementById('suporteAreaMensagens');

  if (!btnAbrir || !modal || !areaMensagens) return;

  const CHAT_STORAGE_KEY = 'huby_suporte_chat_history';
  const TEMPO_EXPIRACAO_MS = 24 * 60 * 60 * 1000;
  const MAX_MENSAGENS = 60;
  let enviando = false;

  function carregarHistorico() {
    try {
      const dataString = localStorage.getItem(CHAT_STORAGE_KEY);
      if (!dataString) return [];
      const data = JSON.parse(dataString);
      if (data.ultimaAtualizacao && (Date.now() - data.ultimaAtualizacao > TEMPO_EXPIRACAO_MS)) {
        localStorage.removeItem(CHAT_STORAGE_KEY);
        return [];
      }
      return Array.isArray(data.mensagens) ? data.mensagens : [];
    } catch (e) {
      return [];
    }
  }

  function salvarHistorico(mensagens) {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
      ultimaAtualizacao: Date.now(),
      mensagens: mensagens.slice(-MAX_MENSAGENS)
    }));
  }

  function renderizarMensagem(msg) {
    const isUser = msg.autor === 'user';
    const isAdmin = msg.autor === 'admin';

    const divWrapper = document.createElement('div');
    divWrapper.style.cssText = `align-self: ${isUser ? 'flex-end' : 'flex-start'}; max-width: 85%;`;

    const divMsg = document.createElement('div');
    divMsg.style.cssText = [
      `background: ${isUser ? '#38BDF8' : (isAdmin ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.1)')}`,
      `border: ${isUser ? 'none' : (isAdmin ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(16, 185, 129, 0.3)')}`,
      `color: ${isUser ? '#02131D' : '#FFF'}`,
      'padding: 12px',
      `border-radius: ${isUser ? '12px 12px 0 12px' : '0 12px 12px 12px'}`,
      'font-size: 13px',
      'line-height: 1.5',
      'white-space: pre-line',
      'word-break: break-word'
    ].join(';');

    if (isAdmin) {
      const rotulo = document.createElement('strong');
      rotulo.style.cssText = 'color: #38BDF8; display: block; margin-bottom: 6px; font-size: 11px; text-transform: uppercase;';
      rotulo.textContent = '🛡️ Equipe HUBy';
      divMsg.appendChild(rotulo);
    }
    divMsg.appendChild(document.createTextNode(String(msg.texto ?? '').slice(0, 2000)));

    const smallTime = document.createElement('small');
    smallTime.style.cssText = `display: block; color: #64748B; font-size: 10px; margin-top: 4px; text-align: ${isUser ? 'right' : 'left'};`;
    const dataMsg = new Date(Number(msg.data) || Date.now());
    smallTime.textContent = dataMsg.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    divWrapper.appendChild(divMsg);
    divWrapper.appendChild(smallTime);
    areaMensagens.appendChild(divWrapper);
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  }

  function renderizarChatInteiro() {
    areaMensagens.textContent = '';
    const mensagens = carregarHistorico();

    if (mensagens.length === 0) {
      mensagens.push({
        autor: 'sistema',
        texto: 'Olá! Este é o Suporte Oficial da HUBy.\nDescreva com detalhes o que aconteceu. Sua mensagem vai para a nossa equipe.',
        data: Date.now()
      });
      salvarHistorico(mensagens);
    }

    mensagens.forEach(renderizarMensagem);
  }

  function classificarAssunto(texto) {
    const txt = texto.toLowerCase();
    if (/(pagamento|saque|dinheiro|pix|receber|carteira|repasse)/.test(txt)) return 'Financeiro';
    if (/(passageiro|cliente|corrida|viagem|bagagem)/.test(txt)) return 'Viagem';
    if (/(aplicativo|erro|bug|mapa|travar|trava)/.test(txt)) return 'Suporte Técnico App';
    return 'Suporte Geral';
  }

  async function enviarMensagem() {
    const texto = String(inputMsg?.value || '').trim().slice(0, 1000);
    if (!texto || enviando) return;

    enviando = true;
    inputMsg.value = '';

    const novaMensagem = { autor: 'user', texto, data: Date.now() };
    const mensagens = carregarHistorico();
    mensagens.push(novaMensagem);
    salvarHistorico(mensagens);
    renderizarMensagem(novaMensagem);

    btnEnviar.textContent = '⏳';
    btnEnviar.disabled = true;

    let resposta;
    try {
      const token = localStorage.getItem('huby_token');
      const resp = await fetch(`${API_URL}/api/suporte/chamado`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pedido_id: corridaAtualDoMotoristaId() || null,
          assunto: classificarAssunto(texto),
          mensagem: texto
        })
      });
      resposta = resp.ok
        ? '✅ Mensagem recebida pela equipe HUBy. Vamos analisar e responder o mais rápido possível.'
        : '⚠️ Não conseguimos registrar sua mensagem agora. Tente novamente em instantes.';
    } catch (e) {
      resposta = '⚠️ Sem conexão. Sua mensagem NÃO foi enviada. Tente novamente quando a internet voltar.';
    }

    const msgSistema = { autor: 'sistema', texto: resposta, data: Date.now() };
    const mensagensAtuais = carregarHistorico();
    mensagensAtuais.push(msgSistema);
    salvarHistorico(mensagensAtuais);
    renderizarMensagem(msgSistema);

    btnEnviar.textContent = '➤';
    btnEnviar.disabled = false;
    enviando = false;
    inputMsg.focus();
  }

  btnAbrir.addEventListener('click', (e) => {
    e.preventDefault();
    renderizarChatInteiro();
    modal.style.display = 'flex';
  });

  btnFechar?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  btnEnviar?.addEventListener('click', enviarMensagem);

  inputMsg?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enviarMensagem();
    }
  });

  // Resposta da equipe (usa a conexão principal, sem abrir outra)
  estado.socket?.on('resposta_suporte_admin', (dados) => {
    if (!dados || !dados.resposta) return;
    const respostaAdmin = {
      autor: 'admin',
      texto: String(dados.resposta).slice(0, 2000),
      data: Number(dados.data) || Date.now()
    };
    const mensagensAtuais = carregarHistorico();
    mensagensAtuais.push(respostaAdmin);
    salvarHistorico(mensagensAtuais);

    if (modal.style.display === 'flex') {
      renderizarMensagem(respostaAdmin);
    } else {
      notificar('Você recebeu uma resposta da equipe HUBy no suporte.', 'aviso');
    }
  });
}

function registrarEventosUI() {
  const btnOnline = document.getElementById('btnToggleStatusOnline');
  if (btnOnline) {
    btnOnline.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await alternarStatusOnline();
    };
  }

  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');

  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', async () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
    await atualizarClubeProMotorista(false);
  });

  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };

  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  configurarChatMotorista();
  configurarEventosSaque();
  configurarSalvarPreferenciasPagto();
  configurarEdicaoPerfil();
  configurarMarketplace();
  configurarModosInteligentes();

  configurarHistoricoCorridasMotorista();
  configurarMetaDiaria();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!validarAutenticacaoMotorista()) return;

  await sincronizarTarifasServidor();
  atualizarTextosPercentualRepasse();

  inicializarSocket();
  escutarAtualizacaoTarifasTempoReal();
  inicializarMapa();
  inicializarZonasRiscoMapa();
  registrarEventosUI();
  await carregarPerfil();
  await atualizarClubeProMotorista(false);
  atualizarBarraMetaDiaria();
  iniciarRadarChamadas();
  inicializarPushNotifications();
  processarFilaOfflineMotorista();

  inicializarChatSuporte();
});