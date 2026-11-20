// js/admin.js - Orquestrador Geral do Painel Master HUBy (Regiões Dinâmicas Push + Caixa Líquido Real + Agendamentos + Selo Docs Validados)
import { API_URL, aplicarObjetoTarifas, TAXA_PLATAFORMA_ATUAL } from './config.js';
import { inicializarRadarMaster, atualizarPosicaoCondutorNoMapa } from './admin-radar.js';

let chartFinanceiroInstance = null;
let chartCategoriasInstance = null;
let motoristaFocadoModalId = null;
let bannerBase64Temporario = null;

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

function escaparHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function notificarAdmin(mensagem, tipo = 'sucesso') {
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    container.className = 'admin-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `admin-toast ${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 4200);
}

// ============================================================================
// MODAL CORPORATIVO (SUBSTITUI TODOS OS PROMPT() NATIVOS DO NAVEGADOR)
// ============================================================================
function abrirModalFormularioAdmin({
  titulo,
  subtitulo = '',
  campo1 = null,
  campo2 = null,
  textarea = null,
  textoConfirmar = 'Salvar',
  onConfirmar
}) {
  const modal = document.getElementById('modalAcaoAdmin');
  if (!modal) return;

  document.getElementById('tituloModalAcaoAdmin').textContent = titulo;
  document.getElementById('subtituloModalAcaoAdmin').textContent = subtitulo;

  const g1 = document.getElementById('campoGrupo1ModalAdmin');
  const in1 = document.getElementById('inputCampo1ModalAdmin');
  if (campo1) {
    g1.style.display = 'block';
    document.getElementById('labelCampo1ModalAdmin').textContent = campo1.label;
    in1.type = campo1.type || 'text';
    in1.placeholder = campo1.placeholder || '';
    in1.value = campo1.value || '';
  } else {
    g1.style.display = 'none';
  }

  const g2 = document.getElementById('campoGrupo2ModalAdmin');
  const in2 = document.getElementById('inputCampo2ModalAdmin');
  if (campo2) {
    g2.style.display = 'block';
    document.getElementById('labelCampo2ModalAdmin').textContent = campo2.label;
    in2.type = campo2.type || 'text';
    in2.placeholder = campo2.placeholder || '';
    in2.value = campo2.value || '';
  } else {
    g2.style.display = 'none';
  }

  const gTxt = document.getElementById('campoGrupoTextoModalAdmin');
  const txtArea = document.getElementById('textareaModalAdmin');
  if (textarea) {
    gTxt.style.display = 'block';
    document.getElementById('labelCampoTextoModalAdmin').textContent = textarea.label;
    txtArea.placeholder = textarea.placeholder || '';
    txtArea.value = textarea.value || '';
  } else {
    gTxt.style.display = 'none';
  }

  const btnConf = document.getElementById('btnConfirmarModalAcaoAdmin');
  btnConf.textContent = textoConfirmar;

  const fechar = () => {
    modal.style.display = 'none';
  };

  document.getElementById('btnFecharModalAcaoAdmin').onclick = fechar;
  document.getElementById('btnCancelarModalAcaoAdmin').onclick = fechar;
  modal.onclick = (e) => {
    if (e.target === modal) fechar();
  };

  btnConf.onclick = async () => {
    await onConfirmar({
      valor1: in1.value,
      valor2: in2.value,
      texto: txtArea.value,
      fechar
    });
  };

  modal.style.display = 'flex';
}

// ============================================================================
// CÁLCULO DE VENCIMENTO DE CNH / CRLV (ALERTA EM 30 DIAS OU VENCIDO)
// ============================================================================
function avaliarValidadeDocumento(dataStr, sigla) {
  if (!dataStr) {
    return {
      status: 'sem_data',
      html: `<span style="display:inline-block; font-size:10px; color:#94A3B8; background:rgba(255,255,255,0.06); padding:2px 6px; border-radius:6px;">${sigla}: Sem data</span>`
    };
  }

  const partes = String(dataStr).slice(0, 10).split('-');
  if (partes.length !== 3) {
    return { status: 'sem_data', html: '' };
  }

  const dtValidade = new Date(Number(partes[0]), Number(partes[1]) - 1, Number(partes[2]), 23, 59, 59);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const diffMs = dtValidade.getTime() - hoje.getTime();
  const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const dataBR = `${partes[2]}/${partes[1]}/${partes[0]}`;

  if (diasRestantes < 0) {
    return {
      status: 'vencido',
      dias: diasRestantes,
      html: `<span title="Venceu em ${dataBR}" style="display:inline-block; font-size:10px; font-weight:800; color:#FCA5A5; background:rgba(239,68,68,0.22); border:1px solid rgba(239,68,68,0.45); padding:2px 6px; border-radius:6px;">🚨 ${sigla} VENCIDO (${dataBR})</span>`
    };
  }

  if (diasRestantes <= 30) {
    return {
      status: 'alerta',
      dias: diasRestantes,
      html: `<span title="Vence em ${dataBR}" style="display:inline-block; font-size:10px; font-weight:800; color:#FCD34D; background:rgba(245,158,11,0.2); border:1px solid rgba(245,158,11,0.45); padding:2px 6px; border-radius:6px;">⚠️ ${sigla}: ${diasRestantes}d (${dataBR})</span>`
    };
  }

  return {
    status: 'ok',
    dias: diasRestantes,
    html: `<span title="Válido até ${dataBR}" style="display:inline-block; font-size:10px; font-weight:700; color:#6EE7B7; background:rgba(16,185,129,0.12); padding:2px 6px; border-radius:6px;">✅ ${sigla}: ${dataBR}</span>`
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('huby_token');
  const role = (localStorage.getItem('huby_user_role') || '').toLowerCase();

  if (!token || (role !== 'admin' && role !== 'administrador')) {
    notificarAdmin('Acesso restrito ao Painel Administrativo Master.', 'erro');
    setTimeout(() => window.location.replace('./login.html'), 900);
    return;
  }

  configurarNavegacaoAbas();
  configurarFiltroPeriodo(token);
  configurarFormDespesasAdmin(token);
  configurarFormPatrocinadores(token);
  configurarFormGrowthEDinamica(token);
  configurarFormZonasRisco(token);
  configurarFormCupons(token);
  configurarFormBroadcast(token);
  configurarFormTarifas(token);
  configurarFormMercadoPago(token);
  configurarModalDocumentos();
  configurarFormMarketplace(token);
  configurarBotaoSaqueLote(token);

  document.getElementById('btnSincronizar')?.addEventListener('click', async () => {
    await sincronizarTudo(token);
    notificarAdmin('Dados sincronizados com o servidor!', 'sucesso');
  });
  document.getElementById('btnBaixarCSV')?.addEventListener('click', () => exportarRelatorioCSV(token));

  try {
    inicializarRadarMaster(token);
  } catch (err) {
    console.warn('Radar inicializado em segundo plano:', err);
  }

  try {
    conectarSocketAdmin();
  } catch (err) {
    console.warn('Socket indisponível:', err);
  }

  sincronizarTudo(token);
});

// ============================================================================
// CARREGAMENTO EM ORDEM SEQUENCIAL GARANTIDA
// ============================================================================
async function sincronizarTudo(token) {
  if (!token) return;

  const periodoAtual = document.getElementById('selectFiltroPeriodo')?.value || 'total';

  await carregarTarifasConfig(token);
  await carregarTabelaFrota(token, true);
  await carregarTabelaViagens(token);
  await carregarMetricasECards(token, periodoAtual);
  await carregarDespesasCorporativas(token);

  Promise.allSettled([
    carregarRegioesAtivasPush(token),
    carregarTabelaAgendamentosAdmin(token),
    carregarTabelaPatrocinadores(token),
    carregarConfigGrowthEDinamica(token),
    carregarTabelaZonasRisco(token),
    carregarTabelaCupons(token),
    carregarTabelaSeguranca(token),
    carregarTabelaSaques(token),
    carregarTabelaMarketplace(token),
    carregarGatewayConfig(token),
    carregarTabelaSuporte(token)
  ]);
}

function configurarFiltroPeriodo(token) {
  const select = document.getElementById('selectFiltroPeriodo');
  if (!select) return;

  select.addEventListener('change', async () => {
    await carregarMetricasECards(token, select.value);
    await carregarDespesasCorporativas(token);
  });
}

// ============================================================================
// CAIXA LÍQUIDO REAL & DESPESAS CORPORATIVAS (ADMIN)
// ============================================================================
async function carregarDespesasCorporativas(token) {
  const tbody = document.getElementById('tabelaDespesasBody');
  try {
    const res = await fetch(`${API_URL}/api/admin/financeiro/despesas?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const lista = res.ok ? await res.json() : [];
    const totalDespesas = Array.isArray(lista)
      ? lista.reduce((acc, d) => acc + Number(d.valor || 0), 0)
      : 0;

    const receitaEmpresa = Number(window._ultimosDadosGraficos?.lucroLiquido || 0);
    const saldoCaixaReal = receitaEmpresa - totalDespesas;

    const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('dreReceitaBrutaEmpresa')) document.getElementById('dreReceitaBrutaEmpresa').textContent = fmt(receitaEmpresa);
    if (document.getElementById('dreTotalDespesas')) document.getElementById('dreTotalDespesas').textContent = fmt(totalDespesas);
    const elSaldo = document.getElementById('dreSaldoLiquidoCaixa');
    if (elSaldo) {
      elSaldo.textContent = fmt(saldoCaixaReal);
      elSaldo.style.color = saldoCaixaReal >= 0 ? '#10B981' : '#EF4444';
    }

    if (!tbody) return;
    if (!Array.isArray(lista) || lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma saída corporativa registrada.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(d => `
      <tr>
        <td>${escaparHTML(d.data_referencia || '--')}</td>
        <td><strong>${escaparHTML(d.descricao)}</strong></td>
        <td><span class="badge badge-pendente">${escaparHTML(String(d.categoria || 'operacional').toUpperCase())}</span></td>
        <td style="color: var(--rose); font-weight: 800;">- R$ ${Number(d.valor || 0).toFixed(2).replace('.', ',')}</td>
        <td><button type="button" class="btn-tbl rej" onclick="excluirDespesaCorporativa(${Number(d.id)})">Excluir</button></td>
      </tr>
    `).join('');
  } catch (e) {}
}

function configurarFormDespesasAdmin(token) {
  const inputData = document.getElementById('despData');
  if (inputData && !inputData.value) {
    inputData.value = new Date().toISOString().slice(0, 10);
  }

  document.getElementById('formNovaDespesaAdmin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      descricao: document.getElementById('despDescricao').value.trim(),
      categoria: document.getElementById('despCategoria').value,
      valor: parseFloat(document.getElementById('despValor').value) || 0,
      data_referencia: document.getElementById('despData').value
    };

    try {
      const res = await fetch(`${API_URL}/api/admin/financeiro/despesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falha ao lançar despesa.');
      notificarAdmin('💸 Saída corporativa registrada no caixa!', 'sucesso');
      e.target.reset();
      if (inputData) inputData.value = new Date().toISOString().slice(0, 10);
      await carregarDespesasCorporativas(token);
    } catch (err) {
      notificarAdmin(err.message, 'erro');
    }
  });
}

window.excluirDespesaCorporativa = async (id) => {
  if (!confirm('Remover este lançamento de despesa?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/financeiro/despesas/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Despesa removida.', 'aviso');
      await carregarDespesasCorporativas(token);
    }
  } catch (e) {}
};

// ============================================================================
// CENTRAL DE AGENDAMENTOS NO ADMIN
// ============================================================================
async function carregarTabelaAgendamentosAdmin(token) {
  const tbody = document.getElementById('tabelaAgendamentosAdminBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/agendamentos?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const lista = res.ok ? await res.json() : [];

    const tabBtn = document.querySelector('[data-tab="tabAgendamentos"]');
    if (tabBtn) {
      tabBtn.innerHTML = lista.length > 0
        ? `📅 Agendamentos <span style="background:#F59E0B;color:#000;font-weight:900;padding:1px 6px;border-radius:10px;font-size:10px;margin-left:4px;">${lista.length}</span>`
        : '📅 Agendamentos';
    }

    if (!Array.isArray(lista) || lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhuma corrida agendada futura no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(a => {
      const dataFmt = a.agendado_para ? new Date(a.agendado_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
      const temMotorista = Boolean(a.motorista_nome);
      return `
        <tr>
          <td><strong style="color:#FBBF24;">⏰ ${dataFmt}</strong></td>
          <td><strong>${escaparHTML(a.cliente_nome || 'Passageiro')}</strong><br><small style="color:var(--muted);">${escaparHTML(a.cliente_telefone || '')}</small></td>
          <td>
            <small style="display:block;"><strong style="color:#10B981;">A</strong> ${escaparHTML(a.origem_endereco || '')}</small>
            <small style="display:block;"><strong style="color:#EF4444;">B</strong> ${escaparHTML(a.destino_endereco || '')}</small>
            ${a.observacao ? `<small style="color:#38BDF8;display:block;">📝 ${escaparHTML(a.observacao)}</small>` : ''}
          </td>
          <td style="font-weight:800; color:#10B981;">R$ ${Number(a.valor_total || 0).toFixed(2).replace('.', ',')}</td>
          <td>
            ${temMotorista
              ? `<span class="badge badge-aprovado">🚘 ${escaparHTML(a.motorista_nome)}</span>`
              : `<span class="badge badge-pendente">⏳ Sem Condutor</span>`}
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              ${!temMotorista ? `<button type="button" class="btn-tbl app" onclick="liberarAgendamentoAgora('${escaparHTML(a.id)}')">🚀 Disparar Radar</button>` : ''}
              <button type="button" class="btn-tbl rej" onclick="cancelarAgendamentoAdmin('${escaparHTML(a.id)}')">Cancelar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Erro ao carregar agendamentos.</td></tr>';
  }
}

window.liberarAgendamentoAgora = async (pedidoId) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/agendamentos/${pedidoId}/liberar-agora`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('🚀 Agendamento liberado imediatamente no radar dos motoristas!', 'sucesso');
      await carregarTabelaAgendamentosAdmin(token);
    }
  } catch (e) {}
};

window.cancelarAgendamentoAdmin = async (pedidoId) => {
  if (!confirm('Cancelar este agendamento?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/cancelar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ motivo: 'Agendamento cancelado pela administração' })
    });
    if (res.ok) {
      notificarAdmin('Agendamento cancelado.', 'aviso');
      await carregarTabelaAgendamentosAdmin(token);
    }
  } catch (e) {}
};

// ============================================================================
// GROWTH & TARIFA DINÂMICA
// ============================================================================
async function carregarConfigGrowthEDinamica(token) {
  try {
    const [resInd, resDin] = await Promise.all([
      fetch(`${API_URL}/api/admin/config/indicacao`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/admin/config/dinamica`, { headers: { Authorization: `Bearer ${token}` } })
    ]);

    if (resInd.ok) {
      const ind = await resInd.json();
      if (document.getElementById('indAtivo')) document.getElementById('indAtivo').value = String(ind.ativo !== false);
      if (document.getElementById('indDescontoIndicado')) document.getElementById('indDescontoIndicado').value = Number(ind.desconto_indicado ?? 5).toFixed(2);
      if (document.getElementById('indBonusIndicador')) document.getElementById('indBonusIndicador').value = Number(ind.bonus_indicador ?? 5).toFixed(2);
      if (document.getElementById('indBonusMotorista')) document.getElementById('indBonusMotorista').value = Number(ind.bonus_motorista ?? 25).toFixed(2);
      if (document.getElementById('indMetaCorridasMotorista')) document.getElementById('indMetaCorridasMotorista').value = Number(ind.meta_corridas_motorista ?? 15);
    }

    if (resDin.ok) {
      const din = await resDin.json();
      if (document.getElementById('dinAtiva')) document.getElementById('dinAtiva').value = String(din.ativa !== false);
      if (document.getElementById('dinGatilhoChamadas')) document.getElementById('dinGatilhoChamadas').value = Number(din.gatilho_chamadas ?? 3);
      if (document.getElementById('dinMultiplicadorMax')) document.getElementById('dinMultiplicadorMax').value = Number(din.multiplicador_maximo ?? 1.8).toFixed(1);
      if (document.getElementById('dinMultiplicadorManual')) document.getElementById('dinMultiplicadorManual').value = Number(din.multiplicador_manual ?? 1.0).toFixed(1);
    }
  } catch (e) {}
}

function configurarFormGrowthEDinamica(token) {
  document.getElementById('formConfigIndicacao')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ativo: document.getElementById('indAtivo').value === 'true',
      desconto_indicado: parseFloat(document.getElementById('indDescontoIndicado').value) || 0,
      bonus_indicador: parseFloat(document.getElementById('indBonusIndicador').value) || 0,
      bonus_motorista: parseFloat(document.getElementById('indBonusMotorista').value) || 0,
      meta_corridas_motorista: parseInt(document.getElementById('indMetaCorridasMotorista').value, 10) || 15
    };

    try {
      const res = await fetch(`${API_URL}/api/admin/config/indicacao`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falha ao salvar regras de indicação.');
      notificarAdmin('✅ Regras do Programa Indique e Ganhe atualizadas!', 'sucesso');
    } catch (err) {
      notificarAdmin(err.message, 'erro');
    }
  });

  document.getElementById('formConfigDinamica')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      ativa: document.getElementById('dinAtiva').value === 'true',
      gatilho_chamadas: parseInt(document.getElementById('dinGatilhoChamadas').value, 10) || 3,
      multiplicador_maximo: parseFloat(document.getElementById('dinMultiplicadorMax').value) || 1.8,
      multiplicador_manual: parseFloat(document.getElementById('dinMultiplicadorManual').value) || 1.0
    };

    try {
      const res = await fetch(`${API_URL}/api/admin/config/dinamica`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Falha ao salvar tarifa dinâmica.');
      notificarAdmin('⚡ Regras da Tarifa Dinâmica aplicadas no radar!', 'sucesso');
    } catch (err) {
      notificarAdmin(err.message, 'erro');
    }
  });
}

async function carregarMetricasECards(token, periodo = 'total') {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas?periodo=${encodeURIComponent(periodo)}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });

    let dados = {};
    if (res.ok) {
      dados = await res.json();
    }

    let faturamentoBruto = Number(dados.faturamentoBruto || 0);
    let lucroLiquido = Number(dados.lucroHuby || 0);
    let repasseMotoristas = Number(dados.repasseMotoristas || 0);
    let viagensConcluidas = Number(dados.viagensConcluidas || 0);
    let incidentesAtivos = Number(dados.alertasSeguranca || 0);

    const pctTaxa = Number(dados.taxaPlataforma || TAXA_PLATAFORMA_ATUAL || 15) / 100;
    const pctMotorista = 1 - pctTaxa;

    if (faturamentoBruto === 0 && Array.isArray(window._ultimasCorridasAdmin) && window._ultimasCorridasAdmin.length > 0) {
      let listaValida = window._ultimasCorridasAdmin.filter(c =>
        ['concluido', 'concluida', 'concluído', 'concluída', 'pago', 'finalizado'].includes(String(c.status || '').toLowerCase().trim())
      );
      if (listaValida.length === 0) {
        listaValida = window._ultimasCorridasAdmin.filter(c =>
          !['cancelado', 'recusado'].includes(String(c.status || '').toLowerCase().trim()) && Number(c.valor_total || 0) > 0
        );
      }
      if (listaValida.length > 0) {
        faturamentoBruto = Number(listaValida.reduce((acc, c) => acc + Number(c.valor_total || 0), 0).toFixed(2));
        repasseMotoristas = Number((faturamentoBruto * pctMotorista).toFixed(2));
        lucroLiquido = Number((faturamentoBruto - repasseMotoristas).toFixed(2));
        viagensConcluidas = listaValida.length;
      }
    }

    const fmtMoeda = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const setTexto = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    };

    setTexto('metricBruto', fmtMoeda(faturamentoBruto));
    setTexto('metricLiquido', fmtMoeda(lucroLiquido));
    setTexto('metricRepasse', fmtMoeda(repasseMotoristas));
    setTexto('metricConcluidas', String(viagensConcluidas));
    setTexto('metricAlertas', String(incidentesAtivos));

    const distCategorias = dados.distribuicao_categorias || {
      carro: viagensConcluidas,
      moto: 0,
      entrega: 0
    };

    window._ultimosDadosGraficos = {
      faturamentoBruto,
      lucroLiquido,
      repasseMotoristas,
      distCategorias
    };

    renderizarGraficos(faturamentoBruto, lucroLiquido, repasseMotoristas, distCategorias);
  } catch (err) {
    console.warn('Erro ao ler KPIs:', err);
  }
}

function renderizarGraficos(bruto, lucro, repasse, categorias) {
  if (typeof Chart === 'undefined') return;

  const taxaPct = Number(TAXA_PLATAFORMA_ATUAL || 15);
  const motPct = Math.max(1, 100 - taxaPct);

  const canvasFin = document.getElementById('chartFinanceiro');
  const ctxFin = canvasFin?.getContext('2d');
  if (ctxFin) {
    if (chartFinanceiroInstance) {
      chartFinanceiroInstance.destroy();
      chartFinanceiroInstance = null;
    }

    const temFaturamento = (Number(repasse) > 0 || Number(lucro) > 0);
    const valRepasse = temFaturamento ? Number(repasse.toFixed(2)) : motPct;
    const valLucro = temFaturamento ? Number(lucro.toFixed(2)) : taxaPct;

    chartFinanceiroInstance = new Chart(ctxFin, {
      type: 'doughnut',
      data: {
        labels: [
          `Repasse Frota (${motPct}%): R$ ${Number(repasse || 0).toFixed(2).replace('.', ',')}`,
          `Caixa Corporativo HUBy (${taxaPct}%): R$ ${Number(lucro || 0).toFixed(2).replace('.', ',')}`
        ],
        datasets: [{
          data: [valRepasse, valLucro],
          backgroundColor: ['#F59E0B', '#38BDF8'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#E2E8F0', boxWidth: 12, font: { size: 12, weight: 'bold' } }
          }
        }
      }
    });
  }

  const canvasCat = document.getElementById('chartCategorias');
  const ctxCat = canvasCat?.getContext('2d');
  if (ctxCat) {
    if (chartCategoriasInstance) {
      chartCategoriasInstance.destroy();
      chartCategoriasInstance = null;
    }

    const totalCarro = Number(categorias?.carro || (bruto > 0 ? 1 : 0));
    const totalMoto = Number(categorias?.moto || 0);
    const totalEntrega = Number(categorias?.entrega || 0);

    chartCategoriasInstance = new Chart(ctxCat, {
      type: 'bar',
      data: {
        labels: ['HUBy Carro', 'HUBy Moto', 'HUBy Entrega'],
        datasets: [{
          label: 'Viagens Concluídas',
          data: [totalCarro, totalMoto, totalEntrega],
          backgroundColor: ['#10B981', '#F59E0B', '#A855F7'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94A3B8' }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: '#94A3B8', precision: 0, stepSize: 1 },
            grid: { color: 'rgba(255,255,255,0.05)' },
            suggestedMax: Math.max(5, totalCarro + totalMoto + totalEntrega + 1)
          }
        }
      }
    });
  }
}

// ============================================================================
// GESTÃO DO CLUBE HUBy / MARKETPLACE (MOTORISTAS)
// ============================================================================
async function carregarTabelaMarketplace(token) {
  const tbody = document.getElementById('tabelaMarketplaceBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhuma parceria cadastrada no momento.</td></tr>';
      return;
    }
    const itens = await res.json();

    if (!Array.isArray(itens) || !itens.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum benefício ou parceria cadastrada no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = itens.map(i => `
      <tr>
        <td><strong>${escaparHTML(i.titulo)}</strong><br><small style="color:var(--muted);">${escaparHTML(i.empresa_nome)}</small></td>
        <td><span class="badge badge-aceito">${escaparHTML(i.categoria)}</span></td>
        <td style="color:var(--rose); text-decoration:line-through;">R$ ${Number(i.preco_original).toFixed(2).replace('.', ',')}</td>
        <td style="color:var(--primary); font-weight:800;">R$ ${Number(i.preco_parceiro).toFixed(2).replace('.', ',')}</td>
        <td><span class="badge ${i.ativo ? 'badge-ativo' : 'badge-inativo'}">${i.ativo ? 'Disponível' : 'Oculto'}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-tbl alt" onclick="alternarStatusMarketplace('${escaparHTML(i.id)}')">${i.ativo ? 'Ocultar' : 'Exibir'}</button>
            <button type="button" class="btn-tbl rej" onclick="excluirItemMarketplace('${escaparHTML(i.id)}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhuma parceria cadastrada no momento.</td></tr>';
  }
}

function configurarFormMarketplace(token) {
  document.getElementById('formNovoMarketplace')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Publicando...';
    }

    const titulo = document.getElementById('mkpTitulo').value.trim();
    const empresa_nome = document.getElementById('mkpEmpresa').value.trim();
    const categoria = document.getElementById('mkpCategoria').value;
    const descricao = document.getElementById('mkpDescricao').value.trim();
    const preco_original = parseFloat(document.getElementById('mkpPrecoDe').value) || 0;
    const preco_parceiro = parseFloat(document.getElementById('mkpPrecoPor').value) || 0;
    const whatsapp_contato = document.getElementById('mkpWhatsapp').value.replace(/\D/g, '');
    const imagem_url = document.getElementById('mkpImagemUrl').value.trim() || null;

    try {
      const res = await fetch(`${API_URL}/api/marketplace/admin/itens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          titulo, empresa_nome, categoria, descricao,
          preco_original, preco_parceiro, whatsapp_contato, imagem_url,
          endereco: 'Atendimento Local'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notificarAdmin('Nova parceria adicionada com sucesso ao Clube HUBy!', 'sucesso');
        e.target.reset();
        await carregarTabelaMarketplace(token);
      } else {
        notificarAdmin(data.erro || 'Erro ao guardar a parceria.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao salvar parceria.', 'erro');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Publicar Parceria no App';
      }
    }
  });
}

window.alternarStatusMarketplace = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens/${id}/toggle`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Visibilidade da oferta atualizada.', 'sucesso');
      carregarTabelaMarketplace(token);
    }
  } catch (e) {}
};

window.excluirItemMarketplace = async (id) => {
  if (!confirm('Tem certeza de que deseja remover esta oferta permanentemente?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Oferta removida do Clube HUBy.', 'aviso');
      carregarTabelaMarketplace(token);
    }
  } catch (e) {}
};

// ============================================================================
// GESTÃO DE FROTA, DOCUMENTOS, SELO DOCS VALIDADOS E ALERTA DE VALIDADE
// ============================================================================
async function carregarTabelaFrota(token, emitirAlertaVencimento = false) {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
      return;
    }
    const motoristas = await res.json();

    if (!Array.isArray(motoristas) || !motoristas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
      return;
    }

    window._ultimoSaldoAcumuladoFrota = motoristas.reduce((acc, m) => acc + Number(m.saldo_carteira || 0), 0);

    let qtdVencidos = 0;
    let qtdVencendoEmBreve = 0;

    tbody.innerHTML = motoristas.map(m => {
      const statusLimpo = m.status_aprovacao || 'pendente';
      const badgeStatus = {
        aprovado: 'badge-aprovado',
        pendente: 'badge-pendente',
        bloqueado: 'badge-recusado',
        recusado: 'badge-recusado'
      }[statusLimpo] || 'badge-pendente';

      const nomeSeguro = escaparHTML(m.nome);
      const idSeguro = escaparHTML(m.id);

      const valCnh = avaliarValidadeDocumento(m.cnh_validade, 'CNH');
      const valCrlv = avaliarValidadeDocumento(m.crlv_validade, 'CRLV');

      if (valCnh.status === 'vencido' || valCrlv.status === 'vencido') qtdVencidos++;
      else if (valCnh.status === 'alerta' || valCrlv.status === 'alerta') qtdVencendoEmBreve++;

      const seloDocsAutoHTML = m.docs_validados_auto
        ? `<div style="margin-top:4px;"><span title="CNH, CRLV, Placa e datas validados automaticamente no cadastro" style="display:inline-block; font-size:10px; font-weight:800; color:#38BDF8; background:rgba(56,189,248,0.14); border:1px solid rgba(56,189,248,0.35); padding:2px 7px; border-radius:999px;">⚡ Docs Validados</span></div>`
        : '';

      return `
        <tr>
          <td>
            <strong>${nomeSeguro}</strong><br>
            <small style="color:var(--muted);">CNH: ${escaparHTML(m.cnh || m.cnh_numero || '---')}</small>
          </td>
          <td>
            ${escaparHTML(m.veiculo_modelo || 'Não inf.')}<br>
            <small style="color:var(--blue); font-weight:700;">${escaparHTML((m.veiculo_placa || 'SEM PLACA').toUpperCase())}</small>
          </td>
          <td><span class="badge badge-aceito">${escaparHTML((m.categoria || m.categoria_veiculo || 'carro').toUpperCase())}</span></td>
          <td style="color:var(--primary); font-weight:800;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</td>
          <td>
            <span class="badge ${badgeStatus}">${escaparHTML(statusLimpo.toUpperCase())}</span>
            ${seloDocsAutoHTML}
          </td>
          <td>
            <div style="display:flex; flex-direction:column; gap:4px;">
              <div style="display:flex; gap:4px; flex-wrap:wrap;">
                ${m.doc_crlv_url ? `<button type="button" class="btn-tbl alt btn-doc-zoom" data-url="${escaparHTML(m.doc_crlv_url)}" data-titulo="CRLV - ${nomeSeguro}" data-mot-id="${idSeguro}">CRLV</button>` : ''}
                ${m.doc_cnh_url ? `<button type="button" class="btn-tbl alt btn-doc-zoom" data-url="${escaparHTML(m.doc_cnh_url)}" data-titulo="CNH - ${nomeSeguro}" data-mot-id="${idSeguro}">CNH</button>` : ''}
                ${m.ultima_selfie_url ? `<button type="button" class="btn-tbl app btn-doc-zoom" data-url="${escaparHTML(m.ultima_selfie_url)}" data-titulo="Selfie Turno - ${nomeSeguro}" data-mot-id="${idSeguro}">🤳 Selfie</button>` : ''}
                <button type="button" class="btn-tbl alt btn-edit-validade" data-mot-id="${idSeguro}" data-nome="${nomeSeguro}" data-cnh="${escaparHTML(m.cnh_validade || '')}" data-crlv="${escaparHTML(m.crlv_validade || '')}">📅 Validades</button>
              </div>
              <div style="display:flex; gap:4px; flex-wrap:wrap;">
                ${valCnh.html}
                ${valCrlv.html}
              </div>
            </div>
          </td>
          <td>
            <div style="display:flex; gap:4px;">
              ${statusLimpo !== 'aprovado' ? `
                <button type="button" class="btn-tbl app" onclick="alterarStatusCondutor('${idSeguro}', 'aprovar')">Aprovar</button>
              ` : ''}
              ${statusLimpo !== 'recusado' && statusLimpo !== 'bloqueado' ? `
                <button type="button" class="btn-tbl rej" onclick="alterarStatusCondutor('${idSeguro}', 'recusar')">Recusar</button>
              ` : `
                <button type="button" class="btn-tbl app" onclick="alterarStatusCondutor('${idSeguro}', 'aprovar')">Liberar</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-doc-zoom').forEach(btn => {
      btn.addEventListener('click', () => {
        window.abrirFotoDocumento(
          btn.getAttribute('data-url'),
          btn.getAttribute('data-titulo'),
          btn.getAttribute('data-mot-id')
        );
      });
    });

    tbody.querySelectorAll('.btn-edit-validade').forEach(btn => {
      btn.addEventListener('click', () => {
        window.editarValidadeDocumentos(
          btn.getAttribute('data-mot-id'),
          btn.getAttribute('data-cnh'),
          btn.getAttribute('data-crlv'),
          btn.getAttribute('data-nome')
        );
      });
    });

    const tabBtnFrota = document.querySelector('[data-tab="tabFrota"]');
    if (tabBtnFrota) {
      const totalCriticos = qtdVencidos + qtdVencendoEmBreve;
      tabBtnFrota.innerHTML = totalCriticos > 0
        ? `🚗 Condutores <span style="background:${qtdVencidos > 0 ? '#EF4444' : '#F59E0B'}; color:#000; font-weight:900; padding:1px 6px; border-radius:10px; font-size:10px; margin-left:4px;">${totalCriticos}</span>`
        : '🚗 Condutores';
    }

    if (emitirAlertaVencimento) {
      if (qtdVencidos > 0) {
        notificarAdmin(`🚨 Atenção: ${qtdVencidos} condutor(es) com CNH ou CRLV VENCIDO! Verifique a aba Condutores.`, 'erro');
      } else if (qtdVencendoEmBreve > 0) {
        notificarAdmin(`⚠️ Aviso: ${qtdVencendoEmBreve} condutor(es) com documento vencendo nos próximos 30 dias.`, 'aviso');
      }
    }
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
  }
}

window.editarValidadeDocumentos = (motoristaId, cnhAtual, crlvAtual, nomeCondutor = 'Condutor') => {
  const token = localStorage.getItem('huby_token');

  abrirModalFormularioAdmin({
    titulo: `📅 Validade de Documentos • ${nomeCondutor}`,
    subtitulo: 'Defina as datas de vencimento da CNH e do CRLV para monitoramento preventivo.',
    campo1: {
      label: 'Validade da CNH',
      type: 'date',
      value: cnhAtual ? String(cnhAtual).slice(0, 10) : ''
    },
    campo2: {
      label: 'Validade do CRLV',
      type: 'date',
      value: crlvAtual ? String(crlvAtual).slice(0, 10) : ''
    },
    textoConfirmar: '💾 Salvar Validades',
    onConfirmar: async ({ valor1, valor2, fechar }) => {
      try {
        const res = await fetch(`${API_URL}/api/admin/motoristas/${motoristaId}/validade-documentos`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            cnh_validade: valor1.trim() || null,
            crlv_validade: valor2.trim() || null
          })
        });

        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.erro || 'Erro ao salvar datas.');
        }

        fechar();
        notificarAdmin('Datas de validade da CNH e CRLV atualizadas!', 'sucesso');
        await carregarTabelaFrota(token, false);
      } catch (err) {
        notificarAdmin(err.message, 'erro');
      }
    }
  });
};

// ============================================================================
// ZONAS DE RISCO
// ============================================================================
async function carregarTabelaZonasRisco(token) {
  const tbody = document.getElementById('tabelaZonasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
      return;
    }
    const zonas = await res.json();
    if (!Array.isArray(zonas) || !zonas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
      return;
    }

    tbody.innerHTML = zonas.map(z => `
      <tr>
        <td><strong>${escaparHTML(z.nome)}</strong><br><small style="color:var(--muted);">${escaparHTML(z.descricao || 'Área demarcada')}</small></td>
        <td><span class="badge ${z.nivel_risco === 'alto' ? 'badge-recusado' : 'badge-pendente'}">${escaparHTML((z.nivel_risco || 'ALTO').toUpperCase())}</span></td>
        <td>${Number(z.raio_metros || 500)}m</td>
        <td><code style="color:var(--blue);">${escaparHTML(z.horario_inicio || '20:00')} às ${escaparHTML(z.horario_fim || '05:00')}</code></td>
        <td><button type="button" class="btn-tbl rej" onclick="excluirZonaRisco(${Number(z.id)})">Remover</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
  }
}

function configurarFormZonasRisco(token) {
  document.getElementById('formZonaRisco')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('zonaNome').value.trim();
    const nivel_risco = document.getElementById('zonaNivel').value;
    const lat = parseFloat(document.getElementById('zonaLat').value);
    const lng = parseFloat(document.getElementById('zonaLng').value);
    const raio_metros = parseInt(document.getElementById('zonaRaio').value, 10) || 500;
    const horario_inicio = document.getElementById('zonaHoraInicio').value || '20:00:00';
    const horario_fim = document.getElementById('zonaHoraFim').value || '05:00:00';

    try {
      const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, nivel_risco, lat, lng, raio_metros, horario_inicio, horario_fim })
      });
      if (res.ok) {
        notificarAdmin('Zona de risco delimitada com sucesso!', 'sucesso');
        e.target.reset();
        carregarTabelaZonasRisco(token);
      } else {
        notificarAdmin('Erro ao registrar zona de risco.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao registrar zona.', 'erro');
    }
  });
}

// ============================================================================
// CUPONS DE DESCONTO
// ============================================================================
async function carregarTabelaCupons(token) {
  const tbody = document.getElementById('tabelaCuponsBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/cupons`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
      return;
    }
    const cupons = await res.json();
    if (!Array.isArray(cupons) || !cupons.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = cupons.map(c => `
      <tr>
        <td><strong>${escaparHTML(c.codigo)}</strong></td>
        <td>${c.tipo === 'porcentagem' ? `${Number(c.valor)}%` : `R$ ${Number(c.valor).toFixed(2).replace('.', ',')}`}</td>
        <td>${Number(c.usos_atuais || 0)} / ${escaparHTML(c.limite_usos || '∞')}</td>
        <td><span class="badge ${c.ativo ? 'badge-ativo' : 'badge-inativo'}">${c.ativo ? 'Ativo' : 'Pausado'}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-tbl alt" onclick="alternarCupom('${escaparHTML(c.id)}')">${c.ativo ? 'Pausar' : 'Ativar'}</button>
            <button type="button" class="btn-tbl rej" onclick="excluirCupom('${escaparHTML(c.id)}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
  }
}

function configurarFormCupons(token) {
  document.getElementById('formNovoCupom')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = document.getElementById('cupomCodigo').value.trim().toUpperCase();
    const tipo = document.getElementById('cupomTipo').value;
    const valor = parseFloat(document.getElementById('cupomValor').value);
    const limite_usos = parseInt(document.getElementById('cupomLimite').value, 10);
    const expira_em = document.getElementById('cupomExpira').value || null;

    try {
      const res = await fetch(`${API_URL}/api/admin/cupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codigo, tipo, valor, limite_usos, expira_em })
      });
      if (res.ok) {
        notificarAdmin('Cupom cadastrado com sucesso!', 'sucesso');
        e.target.reset();
        carregarTabelaCupons(token);
      } else {
        notificarAdmin('Erro ao salvar cupom promocional.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao salvar cupom.', 'erro');
    }
  });
}

// ============================================================================
// INCIDENTES E SOS
// ============================================================================
async function carregarTabelaSeguranca(token) {
  const tbody = document.getElementById('tabelaSegurancaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/incidentes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
      return;
    }
    const incidentes = await res.json();
    if (!Array.isArray(incidentes) || !incidentes.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
      return;
    }

    tbody.innerHTML = incidentes.map(i => `
      <tr>
        <td>#${escaparHTML(String(i.id).slice(-4))}</td>
        <td><span class="badge ${i.tipo_alerta === 'sos' ? 'badge-sos' : 'badge-pendente'}">${escaparHTML((i.tipo_alerta || 'ALERTA').toUpperCase())}</span></td>
        <td>${escaparHTML(i.descricao || 'Alerta reportado')}</td>
        <td>${new Date(i.criado_em).toLocaleString('pt-BR')}</td>
        <td><span class="badge ${i.resolvido ? 'badge-concluido' : 'badge-pendente'}">${i.resolvido ? 'Resolvido' : 'Pendente'}</span></td>
        <td>${!i.resolvido ? `<button type="button" class="btn-tbl app" onclick="resolverIncidente(${Number(i.id)})">Resolver</button>` : '---'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
  }
}

// ============================================================================
// MODERAÇÃO, DISPARO EM LOTE E EXTRATO DE SAQUES DOS MOTORISTAS
// ============================================================================
function configurarBotaoSaqueLote(token) {
  const btnLote = document.getElementById('btnPagarSaquesLote');
  if (!btnLote) return;

  btnLote.addEventListener('click', async () => {
    const qtdPendentes = Number(window._qtdSaquesPendentes || 0);
    if (qtdPendentes === 0) {
      notificarAdmin('Não há saques pendentes na fila no momento.', 'aviso');
      return;
    }

    btnLote.disabled = true;
    const txtOriginal = btnLote.textContent;
    btnLote.textContent = '⚡ Disparando Pix em Lote...';

    try {
      const res = await fetch(`${API_URL}/api/carteira/admin/saques/pagar-lote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Falha ao processar saques em lote.');

      notificarAdmin(data.mensagem || 'Lote de saques liquidado com sucesso!', 'sucesso');
      await carregarTabelaSaques(token);
      await carregarTabelaFrota(token, false);
      await carregarMetricasECards(token);
    } catch (err) {
      notificarAdmin(err.message, 'erro');
    } finally {
      btnLote.disabled = false;
      btnLote.textContent = txtOriginal;
    }
  });
}

async function carregarTabelaSaques(token) {
  const tbody = document.getElementById('tabelaSaquesBody');
  const btnLote = document.getElementById('btnPagarSaquesLote');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/carteira/admin/saques?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
      return;
    }
    const saques = await res.json();

    if (!Array.isArray(saques) || !saques.length) {
      window._qtdSaquesPendentes = 0;
      if (btnLote) btnLote.textContent = '⚡ Liquidar Todos os Pendentes em Lote (0)';
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
      return;
    }

    const pendentes = saques.filter(s => s.status === 'pendente');
    window._qtdSaquesPendentes = pendentes.length;
    if (btnLote) {
      const somaPendentes = pendentes.reduce((acc, s) => acc + Number(s.valor || 0), 0);
      btnLote.textContent = pendentes.length > 0
        ? `⚡ Liquidar ${pendentes.length} Pendente(s) em Lote (R$ ${somaPendentes.toFixed(2).replace('.', ',')})`
        : '✅ Todos os Saques Liquidados (0 Pendentes)';
    }

    tbody.innerHTML = saques.map(s => {
      const badgeClass = s.status === 'pago' ? 'badge-pago' : (s.status === 'recusado' ? 'badge-recusado' : 'badge-pendente');
      const dataFormatada = s.criado_em ? new Date(s.criado_em).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';
      const chaveSegura = escaparHTML(s.chave_pix);

      return `
        <tr>
          <td><strong>#${Number(s.id)}</strong></td>
          <td>
            <strong>${escaparHTML(s.motorista_nome || 'Condutor')}</strong><br>
            <small style="color:var(--muted);">${dataFormatada}</small>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <code style="background:rgba(255,255,255,0.06); padding:3px 6px; border-radius:4px; font-family:monospace; color:#38BDF8;">
                ${chaveSegura}
              </code>
              <button type="button" class="btn-copiar-chave-pix" data-chave="${chaveSegura}" title="Copiar Chave Pix" 
                style="background:transparent; border:none; cursor:pointer; color:var(--muted); font-size:13px;">
                📋
              </button>
            </div>
          </td>
          <td style="font-weight: 800; color: var(--primary);">R$ ${Number(s.valor).toFixed(2).replace('.', ',')}</td>
          <td><span class="badge ${badgeClass}">${escaparHTML(s.status.toUpperCase())}</span></td>
          <td>
            ${s.status === 'pendente' ? `
              <div style="display:flex; gap:6px;">
                <button type="button" class="btn-tbl app" onclick="processarSaqueMaster(${Number(s.id)}, 'pago')">⚡ Disparar Pix</button>
                <button type="button" class="btn-tbl rej" onclick="processarSaqueMaster(${Number(s.id)}, 'recusado')">Recusar</button>
              </div>
            ` : `<small style="color:var(--muted);">${s.status === 'pago' ? '✅ Liquidado' : 'Estornado'}</small>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-copiar-chave-pix').forEach(btn => {
      btn.addEventListener('click', () => {
        const chave = btn.getAttribute('data-chave');
        navigator.clipboard.writeText(chave);
        notificarAdmin('Chave Pix copiada!', 'sucesso');
      });
    });

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
  }
}

// ============================================================================
// MONITOR DE VIAGENS
// ============================================================================
async function carregarTabelaViagens(token) {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
      return;
    }
    const corridas = await res.json();
    window._ultimasCorridasAdmin = Array.isArray(corridas) ? corridas : [];

    if (!Array.isArray(corridas) || !corridas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
      return;
    }

    const pctTaxa = Number(TAXA_PLATAFORMA_ATUAL || 15) / 100;

    tbody.innerHTML = corridas.slice(0, 25).map(c => {
      const taxa = Number(c.valor_total || 0) * pctTaxa;
      return `
        <tr>
          <td><strong>#${escaparHTML(String(c.id).slice(-4))}</strong></td>
          <td>${escaparHTML(c.sub_tipo_label || c.tipo || 'HUBy')}</td>
          <td>${escaparHTML(c.distancia_km || '0.0')} km</td>
          <td style="font-weight:800; color:#FFF;">R$ ${Number(c.valor_total || 0).toFixed(2).replace('.', ',')}</td>
          <td style="color:var(--blue); font-weight:700;">R$ ${taxa.toFixed(2).replace('.', ',')}</td>
          <td>${escaparHTML(c.motorista_nome || 'Aguardando...')}</td>
          <td><span class="badge ${c.status === 'concluido' ? 'badge-concluido' : (c.status === 'cancelado' ? 'badge-recusado' : 'badge-aceito')}">${escaparHTML((c.status || 'pendente').toUpperCase())}</span></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
  }
}

// ============================================================================
// PARÂMETROS E TARIFAS DINÂMICAS
// ============================================================================
async function carregarTarifasConfig(token) {
  const preencherInputs = (cfg) => {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.taxa_plataforma !== undefined) {
      document.getElementById('cfgTaxaPlataforma').value = cfg.taxa_plataforma;
    }
    if (cfg.carro) {
      if (cfg.carro.base !== undefined) document.getElementById('tarifaCarroBase').value = Number(cfg.carro.base).toFixed(2);
      if (cfg.carro.km !== undefined) document.getElementById('tarifaCarroKm').value = Number(cfg.carro.km).toFixed(2);
      if (cfg.carro.min !== undefined) document.getElementById('tarifaCarroMin').value = Number(cfg.carro.min).toFixed(2);
    }
    if (cfg.moto) {
      if (cfg.moto.base !== undefined) document.getElementById('tarifaMotoBase').value = Number(cfg.moto.base).toFixed(2);
      if (cfg.moto.km !== undefined) document.getElementById('tarifaMotoKm').value = Number(cfg.moto.km).toFixed(2);
      if (cfg.moto.min !== undefined) document.getElementById('tarifaMotoMin').value = Number(cfg.moto.min).toFixed(2);
    }
    if (cfg.entrega) {
      if (cfg.entrega.base !== undefined) document.getElementById('tarifaFlashBase').value = Number(cfg.entrega.base).toFixed(2);
      if (cfg.entrega.km !== undefined) document.getElementById('tarifaFlashKm').value = Number(cfg.entrega.km).toFixed(2);
      if (cfg.entrega.min !== undefined) document.getElementById('tarifaFlashMin').value = Number(cfg.entrega.min).toFixed(2);
    }
  };

  try {
    const cacheLocal = localStorage.getItem('huby_tarifas_cache');
    if (cacheLocal) preencherInputs(JSON.parse(cacheLocal));
  } catch (e) {}

  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    let cfg = await res.json();
    while (typeof cfg === 'string') {
      try { cfg = JSON.parse(cfg); } catch (e) { break; }
    }
    if (cfg && typeof cfg === 'object' && cfg.carro) {
      aplicarObjetoTarifas(cfg);
      preencherInputs(cfg);
    }
  } catch (e) {}
}

function configurarFormTarifas(token) {
  document.getElementById('formConfiguracoes')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const lerCampo = (id, padrao) => {
      const val = parseFloat(String(document.getElementById(id)?.value ?? '').replace(',', '.'));
      return Number.isFinite(val) && val >= 0 ? val : padrao;
    };

    const payload = {
      taxa_plataforma: lerCampo('cfgTaxaPlataforma', 15),
      carro: {
        base: lerCampo('tarifaCarroBase', 6.0),
        km: lerCampo('tarifaCarroKm', 2.2),
        min: lerCampo('tarifaCarroMin', 0.30)
      },
      moto: {
        base: lerCampo('tarifaMotoBase', 4.0),
        km: lerCampo('tarifaMotoKm', 1.4),
        min: lerCampo('tarifaMotoMin', 0.20)
      },
      entrega: {
        base: lerCampo('tarifaFlashBase', 5.0),
        km: lerCampo('tarifaFlashKm', 1.8),
        min: lerCampo('tarifaFlashMin', 0.25)
      }
    };

    aplicarObjetoTarifas(payload);

    try {
      const res = await fetch(`${API_URL}/api/admin/tarifas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const respData = await res.json().catch(() => null);
        if (respData?.tarifas) aplicarObjetoTarifas(respData.tarifas);
        notificarAdmin('Tabela tarifária dinâmica salva no banco e aplicada no mapa!', 'sucesso');
      } else {
        notificarAdmin('Falha ao atualizar tabela tarifária no servidor.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Erro de conexão ao salvar tarifas.', 'erro');
    }
  });
}

// ============================================================================
// GATEWAY DE PAGAMENTO MERCADO PAGO
// ============================================================================
async function carregarGatewayConfig(token) {
  try {
    const res = await fetch(`${API_URL}/api/admin/gateway/mercadopago`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const inputToken = document.getElementById('mpAccessToken');
    if (inputToken && (data.access_token_mascarado || data.access_token)) {
      inputToken.placeholder = data.access_token_mascarado || 'Token configurado com segurança';
      inputToken.value = '';
    }
    if (data.public_key) document.getElementById('mpPublicKey').value = data.public_key;
    if (data.taxa_percentual) document.getElementById('mpTaxaPercentual').value = data.taxa_percentual;
  } catch (e) {}
}

function configurarFormMercadoPago(token) {
  document.getElementById('formMercadoPagoConfig')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const access_token = document.getElementById('mpAccessToken').value.trim();
    const public_key = document.getElementById('mpPublicKey').value.trim();
    const taxa_percentual = parseFloat(document.getElementById('mpTaxaPercentual').value) || 0.99;

    try {
      const res = await fetch(`${API_URL}/api/admin/gateway/mercadopago`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ access_token, public_key, taxa_percentual })
      });
      if (res.ok) {
        notificarAdmin('Credenciais do Mercado Pago salvas com segurança!', 'sucesso');
        await carregarGatewayConfig(token);
      } else {
        const d = await res.json().catch(() => ({}));
        notificarAdmin(d.erro || 'Falha ao salvar chaves do Mercado Pago.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Erro de conexão ao salvar gateway.', 'erro');
    }
  });
}

// ============================================================================
// REGIÕES DINÂMICAS REAIS & DISPARO DE NOTIFICAÇÕES PUSH
// ============================================================================
async function carregarRegioesAtivasPush(token) {
  const select = document.getElementById('broadRegiao');
  const inputCustom = document.getElementById('broadRegiaoCustom');
  if (!select) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/regioes-ativas?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    const regioes = res.ok ? await res.json() : [];

    let opcoesHTML = `<option value="todas">🌐 Todas as Regiões (Global)</option>`;
    if (Array.isArray(regioes) && regioes.length > 0) {
      opcoesHTML += regioes.map((r) => {
        const detalhes = [];
        if (r.motoristas > 0) detalhes.push(`${r.motoristas} mot.`);
        if (r.usuarios > 0) detalhes.push(`${r.usuarios} usr.`);
        if (r.corridas > 0) detalhes.push(`${r.corridas} corridas`);
        const info = detalhes.length ? ` (${detalhes.join(' • ')})` : '';
        return `<option value="${escaparHTML(r.nome)}">📍 ${escaparHTML(r.nome)}${escaparHTML(info)}</option>`;
      }).join('');
    }
    opcoesHTML += `<option value="__outra__">✏️ Digitar outra cidade / região...</option>`;

    select.innerHTML = opcoesHTML;

    select.onchange = () => {
      if (inputCustom) {
        inputCustom.style.display = select.value === '__outra__' ? 'block' : 'none';
        if (select.value === '__outra__') inputCustom.focus();
      }
    };
  } catch (e) {}
}

function configurarFormBroadcast(token) {
  document.getElementById('formBroadcast')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = e.target.querySelector('button[type="submit"]');
    const txtOriginal = btnSubmit.innerHTML;
    btnSubmit.innerHTML = '⏳ Enviando Notificação...';
    btnSubmit.disabled = true;

    const publico = document.getElementById('broadPublico').value;
    const selectRegiao = document.getElementById('broadRegiao').value;
    const customRegiao = document.getElementById('broadRegiaoCustom')?.value.trim() || '';
    const regiao = selectRegiao === '__outra__' ? (customRegiao || 'todas') : selectRegiao;
    const titulo = document.getElementById('broadTitulo').value.trim();
    const mensagem = document.getElementById('broadMensagem').value.trim();

    try {
      const res = await fetch(`${API_URL}/api/admin/notificacoes/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ publico, regiao, titulo, mensagem })
      });

      const data = await res.json();

      if (res.ok) {
        notificarAdmin(`🚀 Push transmitido para: ${regiao === 'todas' ? 'TODAS AS REGIÕES' : regiao.toUpperCase()}`, 'sucesso');
        e.target.reset();
        const inpC = document.getElementById('broadRegiaoCustom');
        if (inpC) inpC.style.display = 'none';
      } else {
        notificarAdmin(data.erro || 'Erro ao enviar broadcast.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao disparar alerta.', 'erro');
    } finally {
      btnSubmit.innerHTML = txtOriginal;
      btnSubmit.disabled = false;
    }
  });
}

function configurarModalDocumentos() {
  const modal = document.getElementById('modalPreviewFoto');
  const btnFechar = document.getElementById('btnFecharModalPreview');
  const btnAprovar = document.getElementById('btnAprovarDocModal');
  const btnRecusar = document.getElementById('btnRecusarDocModal');

  window.abrirFotoDocumento = (url, titulo = 'Documento do Condutor', motoristaId = null) => {
    const img = document.getElementById('imgPreviewVeiculo');
    const lblTitulo = document.getElementById('lblTituloDocModal');
    motoristaFocadoModalId = motoristaId;

    if (img && modal) {
      img.src = url;
      if (lblTitulo) lblTitulo.textContent = titulo;
      modal.style.display = 'flex';
      if (btnAprovar && btnRecusar) {
        btnAprovar.style.display = motoristaId ? 'inline-block' : 'none';
        btnRecusar.style.display = motoristaId ? 'inline-block' : 'none';
      }
    }
  };

  btnAprovar?.addEventListener('click', async () => {
    if (motoristaFocadoModalId) {
      await window.alterarStatusCondutor(motoristaFocadoModalId, 'aprovar');
      if (modal) modal.style.display = 'none';
    }
  });

  btnRecusar?.addEventListener('click', async () => {
    if (motoristaFocadoModalId) {
      await window.alterarStatusCondutor(motoristaFocadoModalId, 'recusar');
      if (modal) modal.style.display = 'none';
    }
  });

  btnFechar?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

function configurarNavegacaoAbas() {
  const botoes = document.querySelectorAll('.tab-btn, [data-tab]');
  const paineis = document.querySelectorAll('.tab-pane, section[id^="tab"]');

  botoes.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabAlvoId = btn.getAttribute('data-tab');
      if (!tabAlvoId) return;

      botoes.forEach(b => b.classList.remove('active'));
      paineis.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });

      btn.classList.add('active');
      const tabAlvo = document.getElementById(tabAlvoId);
      if (tabAlvo) {
        tabAlvo.classList.add('active');
        tabAlvo.style.display = 'block';

        const token = localStorage.getItem('huby_token');

        if (tabAlvoId === 'tabMetricas') {
          const g = window._ultimosDadosGraficos;
          if (g) {
            setTimeout(() => renderizarGraficos(g.faturamentoBruto, g.lucroLiquido, g.repasseMotoristas, g.distCategorias), 100);
          }
          carregarDespesasCorporativas(token);
        }

        if (tabAlvoId === 'tabBroadcast') carregarRegioesAtivasPush(token);
        if (tabAlvoId === 'tabAgendamentos') carregarTabelaAgendamentosAdmin(token);
        if (tabAlvoId === 'tabPatrocinadores') carregarTabelaPatrocinadores(token);
        if (tabAlvoId === 'tabGrowth') carregarConfigGrowthEDinamica(token);
        if (tabAlvoId === 'tabSaques') carregarTabelaSaques(token);
        if (tabAlvoId === 'tabCupons') carregarTabelaCupons(token);
        if (tabAlvoId === 'tabViagens') carregarTabelaViagens(token);
        if (tabAlvoId === 'tabConfig') carregarTarifasConfig(token);
        if (tabAlvoId === 'tabMarketplace') carregarTabelaMarketplace(token);
        if (tabAlvoId === 'tabFrota') carregarTabelaFrota(token, false);
        if (tabAlvoId === 'tabSuporte') carregarTabelaSuporte(token);

        if (tabAlvoId.toLowerCase().includes('radar')) {
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
          }, 200);
        }
      }
    });
  });
}

function conectarSocketAdmin() {
  const ioClient = getSocketIO();
  if (!ioClient) return;

  const socket = ioClient(API_URL);
  socket.on('posicao_motorista', (dados) => {
    atualizarPosicaoCondutorNoMapa(dados);
  });

  socket.on('nova_chamada', async (dados) => {
    if (dados?.agendadoPara) {
      const token = localStorage.getItem('huby_token');
      await carregarTabelaAgendamentosAdmin(token);
    }
  });

  socket.on('corrida_finalizada', async () => {
    const token = localStorage.getItem('huby_token');
    const periodo = document.getElementById('selectFiltroPeriodo')?.value || 'total';
    await carregarTabelaViagens(token);
    await carregarTabelaFrota(token, false);
    await carregarMetricasECards(token, periodo);
    await carregarDespesasCorporativas(token);
  });

  socket.on('novo_saque_solicitado', async (dados) => {
    const token = localStorage.getItem('huby_token');
    notificarAdmin(`💸 Novo saque solicitado por ${dados.motorista_nome || 'Condutor'}: R$ ${Number(dados.valor || 0).toFixed(2).replace('.', ',')}`, 'aviso');
    await carregarTabelaSaques(token);
    await carregarTabelaFrota(token, false);
  });

  socket.on('saque_atualizado', async () => {
    const token = localStorage.getItem('huby_token');
    await carregarTabelaSaques(token);
    await carregarTabelaFrota(token, false);
  });

  socket.on('tarifas_atualizadas', (novasTarifas) => {
    aplicarObjetoTarifas(novasTarifas);
  });

  socket.on('alerta_sos', (dados) => {
    notificarAdmin(`🚨 ALERTA SOS: Viagem #${dados.pedidoId} - ${dados.relato || 'Emergência reportada!'}`, 'erro');
    const token = localStorage.getItem('huby_token');
    carregarTabelaSeguranca(token);
    carregarMetricasECards(token);
  });
}

// ============================================================================
// AÇÕES GLOBAIS
// ============================================================================
window.excluirZonaRisco = async (id) => {
  if (!confirm('Deseja realmente remover esta zona de risco?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Zona de risco removida.', 'aviso');
      carregarTabelaZonasRisco(token);
    }
  } catch (e) {}
};

window.alternarCupom = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/cupons/${id}/toggle`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Status do cupom alterado.', 'sucesso');
      carregarTabelaCupons(token);
    }
  } catch (e) {}
};

window.excluirCupom = async (id) => {
  if (!confirm('Deseja excluir este cupom?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/cupons/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Cupom excluído.', 'aviso');
      carregarTabelaCupons(token);
    }
  } catch (e) {}
};

window.alterarStatusCondutor = async (id, acao) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao })
    });
    if (res.ok) {
      notificarAdmin(acao === 'aprovar' ? 'Condutor aprovado e liberado!' : 'Condutor recusado/bloqueado.', acao === 'aprovar' ? 'sucesso' : 'aviso');
      await carregarTabelaFrota(token, false);
      await carregarMetricasECards(token);
    }
  } catch (e) {}
};

window.processarSaqueMaster = async (id, status) => {
  const token = localStorage.getItem('huby_token');

  const executarRequisicao = async (motivo = '') => {
    try {
      const res = await fetch(`${API_URL}/api/carteira/admin/saques/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ status, motivo_recusa: motivo })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.erro || 'Falha ao processar saque.');

      notificarAdmin(data.mensagem || (status === 'pago' ? '⚡ Saque Pix liquidado!' : 'Saque recusado e valor estornado.'), status === 'pago' ? 'sucesso' : 'aviso');
      await carregarTabelaSaques(token);
      await carregarTabelaFrota(token, false);
      await carregarMetricasECards(token);
    } catch (e) {
      notificarAdmin(e.message, 'erro');
    }
  };

  if (status === 'recusado') {
    abrirModalFormularioAdmin({
      titulo: `Recusar Saque #${id}`,
      subtitulo: 'O valor será estornado automaticamente para a carteira do motorista.',
      textarea: {
        label: 'Motivo da Recusa',
        placeholder: 'Ex: Chave Pix inválida ou divergente do titular...'
      },
      textoConfirmar: 'Confirmar Recusa e Estornar',
      onConfirmar: async ({ texto, fechar }) => {
        fechar();
        await executarRequisicao(texto.trim() || 'Recusado pela administração');
      }
    });
    return;
  }

  await executarRequisicao('');
};

window.resolverIncidente = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/incidentes/${id}/resolver`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Incidente marcado como resolvido.', 'sucesso');
      await carregarTabelaSeguranca(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {}
};

function exportarRelatorioCSV(token) {
  const tokenUrl = token || localStorage.getItem('huby_token') || '';
  window.open(`${API_URL}/api/admin/relatorios/corridas.csv?token=${encodeURIComponent(tokenUrl)}`, '_blank');
}

// ============================================================================
// GESTÃO DE SUPORTE E TICKETS
// ============================================================================
async function carregarTabelaSuporte(token) {
  const tbody = document.getElementById('tabelaSuporteBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/suporte/admin/chamados`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const chamados = await res.json();

    if (!chamados || !chamados.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum chamado de suporte pendente. Tudo tranquilo!</td></tr>';
      return;
    }

    tbody.innerHTML = chamados.map(c => {
      const badgeClass = c.status === 'pendente' ? 'badge-pendente' : 'badge-concluido';
      const msgCurta = c.mensagem.length > 45 ? c.mensagem.slice(0, 45) + '...' : c.mensagem;
      const dataBR = new Date(c.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const nomeAutorSeguro = escaparHTML(c.usuario_nome);

      return `
        <tr>
          <td>${dataBR}</td>
          <td><strong>${nomeAutorSeguro}</strong><br><small style="color:var(--muted); text-transform:capitalize;">${escaparHTML(c.tipo_usuario)}</small></td>
          <td>${c.pedido_id ? `<code style="color:var(--blue);">#${String(c.pedido_id).slice(-6)}</code>` : 'Geral'}</td>
          <td title="${escaparHTML(c.mensagem)}">${escaparHTML(msgCurta)}</td>
          <td><span class="badge ${badgeClass}">${escaparHTML(String(c.status).toUpperCase())}</span></td>
          <td>
            ${c.status === 'pendente'
              ? `<button type="button" class="btn-tbl app btn-responder-ticket" data-ticket-id="${Number(c.id)}" data-autor="${nomeAutorSeguro}">Responder</button>`
              : `<small style="color:var(--primary); font-weight:700;">✅ Respondido</small>`
            }
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-responder-ticket').forEach(btn => {
      btn.addEventListener('click', () => {
        window.responderChamadoMaster(
          Number(btn.getAttribute('data-ticket-id')),
          btn.getAttribute('data-autor')
        );
      });
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum chamado de suporte pendente.</td></tr>';
  }
}

window.responderChamadoMaster = (ticketId, nomeAutor) => {
  const token = localStorage.getItem('huby_token');

  abrirModalFormularioAdmin({
    titulo: `🎧 Responder Chamado #${ticketId}`,
    subtitulo: `Enviando retorno oficial para ${nomeAutor}.`,
    textarea: {
      label: 'Resposta / Resolução',
      placeholder: 'Digite a resposta detalhada para encerrar o chamado...'
    },
    textoConfirmar: '📨 Enviar Resposta',
    onConfirmar: async ({ texto, fechar }) => {
      if (!texto || !texto.trim()) {
        notificarAdmin('Digite uma resposta antes de enviar.', 'aviso');
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/suporte/admin/chamados/${ticketId}/responder`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ resposta: texto.trim() })
        });

        const data = await res.json();

        if (res.ok) {
          fechar();
          notificarAdmin('Resposta registada e chamado encerrado com sucesso!', 'sucesso');
          carregarTabelaSuporte(token);
        } else {
          notificarAdmin(data.erro || 'Erro ao enviar resposta.', 'erro');
        }
      } catch (e) {
        notificarAdmin('Erro de ligação ao responder chamado.', 'erro');
      }
    }
  });
};

// ============================================================================
// GESTÃO DE PATROCINADORES E BANNERS DA GALERIA
// ============================================================================
function comprimirImagemGaleriaParaBase64(file, maxWidth = 860, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function configurarFormPatrocinadores(token) {
  const inputGaleria = document.getElementById('inputBannerGaleria');
  const imgPreview = document.getElementById('imgPreviewBannerAdmin');
  const lblStatus = document.getElementById('lblStatusUploadBanner');
  const form = document.getElementById('formNovoPatrocinador');

  inputGaleria?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (lblStatus) lblStatus.textContent = '⏳ Otimizando imagem da galeria...';
    try {
      bannerBase64Temporario = await comprimirImagemGaleriaParaBase64(file);
      if (imgPreview) {
        imgPreview.src = bannerBase64Temporario;
        imgPreview.style.display = 'block';
      }
      if (lblStatus) lblStatus.textContent = '✅ Banner carregado! (Toque para trocar)';
    } catch (err) {
      notificarAdmin('Erro ao ler imagem da galeria.', 'erro');
    }
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!bannerBase64Temporario) {
      notificarAdmin('Escolha uma imagem da galeria para o banner antes de publicar.', 'aviso');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Publicando no App...';
    }

    const payload = {
      nome_empresa: document.getElementById('patNomeEmpresa').value.trim(),
      titulo_oferta: document.getElementById('patTituloOferta').value.trim(),
      categoria: document.getElementById('patCategoria').value,
      cupom_codigo: document.getElementById('patCupom').value.trim().toUpperCase(),
      descricao: document.getElementById('patDescricao').value.trim(),
      whatsapp_link: document.getElementById('patWhatsappLink').value.trim(),
      prioridade: parseInt(document.getElementById('patPrioridade').value, 10) || 5,
      exibir_popup: document.getElementById('patExibirPopup').checked,
      imagem_base64: bannerBase64Temporario
    };

    try {
      const res = await fetch(`${API_URL}/api/patrocinadores/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.erro || 'Falha ao publicar patrocinador.');

      notificarAdmin('🌟 Banner do patrocinador publicado com sucesso no app!', 'sucesso');
      form.reset();
      bannerBase64Temporario = null;
      if (imgPreview) imgPreview.style.display = 'none';
      if (lblStatus) lblStatus.textContent = 'Toque para escolher imagem da Galeria';
      await carregarTabelaPatrocinadores(token);
    } catch (err) {
      notificarAdmin(err.message, 'erro');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Publicar Banner no App do Cliente';
      }
    }
  });
}

async function carregarTabelaPatrocinadores(token) {
  const tbody = document.getElementById('tabelaPatrocinadoresBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/patrocinadores/admin?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const lista = await res.json();

    if (!Array.isArray(lista) || lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum banner de patrocinador cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map(p => `
      <tr>
        <td>
          <img src="${p.imagem_base64}" alt="${escaparHTML(p.nome_empresa)}" class="img-banner-zoom"
            data-titulo="Banner - ${escaparHTML(p.nome_empresa)}"
            style="width: 68px; height: 48px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); cursor: pointer;" />
        </td>
        <td>
          <strong>${escaparHTML(p.nome_empresa)}</strong><br>
          <small style="color: #38BDF8; font-weight: 700;">${escaparHTML(p.titulo_oferta)}</small>
          ${p.cupom_codigo ? `<br><span style="font-size:10px; background:rgba(16,185,129,0.15); color:#10B981; padding:1px 6px; border-radius:4px; font-weight:800;">CUPOM: ${escaparHTML(p.cupom_codigo)}</span>` : ''}
        </td>
        <td>
          <button type="button" class="btn-tbl ${p.exibir_popup ? 'app' : 'alt'}" onclick="alternarPopupPatrocinador(${p.id})">
            ${p.exibir_popup ? '🚀 Sim (No Pop-up)' : '⚪ Só na Vitrine'}
          </button>
        </td>
        <td>
          <small style="color:#CBD5E1; display:block;">👁️ <strong>${Number(p.visualizacoes || 0)}</strong> views</small>
          <small style="color:#10B981; display:block;">👆 <strong>${Number(p.cliques || 0)}</strong> cliques</small>
        </td>
        <td>
          <span class="badge ${p.ativo ? 'badge-ativo' : 'badge-inativo'}">${p.ativo ? 'ATIVO' : 'PAUSADO'}</span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-tbl alt" onclick="alternarStatusPatrocinador(${p.id})">${p.ativo ? 'Pausar' : 'Ativar'}</button>
            <button type="button" class="btn-tbl rej" onclick="excluirPatrocinador(${p.id})">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.img-banner-zoom').forEach(img => {
      img.addEventListener('click', () => {
        window.abrirFotoDocumento(img.src, img.getAttribute('data-titulo'));
      });
    });
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum patrocinador cadastrado.</td></tr>';
  }
}

window.alternarStatusPatrocinador = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/patrocinadores/admin/${id}/toggle-ativo`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Status do patrocinador atualizado!', 'sucesso');
      carregarTabelaPatrocinadores(token);
    }
  } catch (e) {}
};

window.alternarPopupPatrocinador = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/patrocinadores/admin/${id}/toggle-popup`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Destaque do Pop-up atualizado!', 'sucesso');
      carregarTabelaPatrocinadores(token);
    }
  } catch (e) {}
};

window.excluirPatrocinador = async (id) => {
  if (!confirm('Deseja remover este patrocinador permanentemente?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/patrocinadores/admin/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Patrocinador removido.', 'aviso');
      carregarTabelaPatrocinadores(token);
    }
  } catch (e) {}
};