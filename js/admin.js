import { API_URL } from './config.js';

let chartFin = null;
let chartCat = null;
const token = localStorage.getItem('huby_token');

document.addEventListener('DOMContentLoaded', async () => {
  configurarNavegacaoAbas();
  configurarModalFotos();
  await carregarDadosDashboard();

  document.getElementById('btnSincronizar')?.addEventListener('click', carregarDadosDashboard);
  document.getElementById('btnSalvarTarifas')?.addEventListener('click', salvarTarifasServidor);
  document.getElementById('btnAplicarPico')?.addEventListener('click', () => {
    alert('Multiplicador aplicado localmente. Clique em "Gravar" para enviar para os motoristas.');
  });
  document.getElementById('btnExportarCsv')?.addEventListener('click', exportarRelatorioCsv);
});

// NAVEGAÇÃO ENTRE ABAS
function configurarNavegacaoAbas() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });
}

// BUSCA GLOBAL DE DADOS
async function carregarDadosDashboard() {
  try {
    const btnSync = document.getElementById('btnSincronizar');
    if (btnSync) btnSync.style.opacity = '0.5';

    const respMet = await fetch(`${API_URL}/api/admin/metricas`, { headers: { Authorization: `Bearer ${token}` } });
    if (!respMet.ok) throw new Error('Falha ao carregar métricas');
    const metricas = await respMet.json();

    const respMot = await fetch(`${API_URL}/api/admin/motoristas`, { headers: { Authorization: `Bearer ${token}` } });
    const motoristas = respMot.ok ? await respMot.json() : [];

    const respSaq = await fetch(`${API_URL}/api/admin/saques`, { headers: { Authorization: `Bearer ${token}` } });
    const saques = respSaq.ok ? await respSaq.json() : [];

    const respTar = await fetch(`${API_URL}/api/config/tarifas`);
    const tarifas = respTar.ok ? await respTar.json() : null;

    atualizarCardsResumo(metricas);
    atualizarGraficos(metricas);
    preencherTabelaViagens(metricas.ultimasChamadas);
    preencherTabelaFrota(motoristas);
    preencherTabelaSaques(saques);
    if (tarifas) preencherInputsTarifas(tarifas);

    if (btnSync) btnSync.style.opacity = '1';
  } catch (err) {
    console.error('Erro no dashboard:', err);
    alert('Erro ao carregar dados do painel.');
  }
}

// ATUALIZAR CARDS E GRÁFICOS (TAB 1)
function atualizarCardsResumo(data) {
  const mBruto = document.getElementById('metricBruto');
  const mLiquido = document.getElementById('metricLiquido');
  const mRepasse = document.getElementById('metricRepasse');
  const mRadar = document.getElementById('metricRadar');

  if (mBruto) mBruto.textContent = `R$ ${Number(data.faturamentoBruto || 0).toFixed(2).replace('.', ',')}`;
  if (mLiquido) mLiquido.textContent = `R$ ${Number(data.receitaPlataforma || 0).toFixed(2).replace('.', ',')}`;
  if (mRepasse) mRepasse.textContent = `R$ ${Number(data.repasseMotoristas || 0).toFixed(2).replace('.', ',')}`;
  if (mRadar) mRadar.textContent = data.chamadasEmAberto || '0';
}

function atualizarGraficos(data) {
  const ctxFin = document.getElementById('chartFinanceiro');
  const ctxCat = document.getElementById('chartCategorias');
  
  if (!ctxFin || !ctxCat || typeof Chart === 'undefined') return;

  if (chartFin) chartFin.destroy();
  if (chartCat) chartCat.destroy();

  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = '-apple-system, sans-serif';

  // GRÁFICO 1: Balanço (Plataforma vs Motoristas)
  chartFin = new Chart(ctxFin, {
    type: 'doughnut',
    data: {
      labels: ['Plataforma (15%)', 'Motoristas (85%)'],
      datasets: [{
        data: [data.receitaPlataforma || 0, data.repasseMotoristas || 0],
        backgroundColor: ['#38BDF8', '#F59E0B'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10, weight: 'bold' } } }
      },
      cutout: '65%'
    }
  });

  // GRÁFICO 2: Modalidades Ativas (Extraído das últimas chamadas)
  const contagem = { carro: 0, moto: 0, flash: 0, frete: 0 };
  if (data.ultimasChamadas) {
    data.ultimasChamadas.forEach(c => {
      if (c.tipo === 'carro') contagem.carro++;
      else if (c.tipo === 'moto') contagem.moto++;
      else if (c.tipo === 'flash_moto') contagem.flash++;
      else contagem.frete++;
    });
  }

  chartCat = new Chart(ctxCat, {
    type: 'bar',
    data: {
      labels: ['Carro', 'Moto', 'Flash', 'Frete'],
      datasets: [{
        label: 'Viagens Recentes',
        data: [contagem.carro, contagem.moto, contagem.flash, contagem.frete],
        backgroundColor: ['#10B981', '#38BDF8', '#F59E0B', '#F43F5E'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { stepSize: 1 } },
        x: { grid: { display: false } }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// TABELA 5: VIAGENS
function preencherTabelaViagens(chamadas) {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;

  if (!chamadas || chamadas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--muted);">Sem histórico de viagens.</td></tr>';
    return;
  }

  tbody.innerHTML = chamadas.map(c => {
    const valor = Number(c.valor_total || 0);
    const taxa = valor * 0.15;
    return `
      <tr>
        <td style="font-weight:700;">#${String(c.id).slice(-5).toUpperCase()}</td>
        <td>${c.sub_tipo_label || c.tipo}</td>
        <td>${c.distancia_km} km</td>
        <td style="color:#FFF; font-weight:800;">R$ ${valor.toFixed(2).replace('.', ',')}</td>
        <td style="color:var(--cyan); font-weight:800;">R$ ${taxa.toFixed(2).replace('.', ',')}</td>
        <td>${c.motorista_nome || '<span style="color:var(--muted)">Procurando...</span>'}</td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
      </tr>
    `;
  }).join('');
}

// TABELA 4: FROTA E APROVAÇÃO
function preencherTabelaFrota(motoristas) {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;

  if (!motoristas || motoristas.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color: var(--muted);">Nenhum motorista registado.</td></tr>';
    return;
  }

  tbody.innerHTML = motoristas.map(m => {
    const formatCnh = m.cnh ? m.cnh.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : 'N/A';
    
    // Ação depende do status
    let btnAcoes = '';
    if (m.status_aprovacao === 'pendente') {
      btnAcoes = `
        <button class="btn-tbl app" onclick="window.triagemMot('${m.id}', 'aprovar')">Aprovar</button>
        <button class="btn-tbl rej" onclick="window.triagemMot('${m.id}', 'recusar')">Recusar</button>
      `;
    } else {
      btnAcoes = `<span style="font-size:10px; color:var(--muted)">${m.status_aprovacao.toUpperCase()}</span>`;
    }

    // Botão ver CNH/CRLV se existir
    const btnFoto = m.doc_crlv_url 
      ? `<button type="button" class="btn-tbl" style="background:rgba(255,255,255,0.1); color:#FFF;" onclick="window.verFotoCRLV('${m.doc_crlv_url}')">📸 CNH/CRLV</button>`
      : '<span style="font-size:10px; color:var(--muted)">Sem Foto</span>';

    return `
      <tr>
        <td>
          <div style="font-weight:800; color:#FFF;">${m.nome}</div>
          <div style="font-size:9px; color:var(--muted); margin-top:2px;">CNH: ${formatCnh}</div>
        </td>
        <td>${m.veiculo_modelo}<br><small style="color:var(--emerald); font-weight:700;">${m.veiculo_placa}</small></td>
        <td style="text-transform:uppercase; font-size:10px; font-weight:800;">${m.categoria_veiculo}</td>
        <td style="color:#FFF; font-weight:800;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</td>
        <td><span class="badge badge-${m.status_aprovacao}">${m.status_aprovacao}</span></td>
        <td>${btnFoto}</td>
        <td>${btnAcoes}</td>
      </tr>
    `;
  }).join('');
}

// FUNÇÕES GLOBAIS DE TRIAGEM (Acedidas pelos botões HTML criados no JS)
window.triagemMot = async (id, acao) => {
  if (!confirm(`Tem a certeza que pretende ${acao} este parceiro?`)) return;
  try {
    const resp = await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao })
    });
    if (!resp.ok) throw new Error('Falha na triagem');
    carregarDadosDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.verFotoCRLV = (url) => {
  const modal = document.getElementById('modalPreviewFoto');
  const img = document.getElementById('imgPreviewVeiculo');
  if (modal && img) {
    img.src = url;
    modal.style.display = 'flex';
  }
};

function configurarModalFotos() {
  const modal = document.getElementById('modalPreviewFoto');
  const btnClose = document.getElementById('btnFecharModalPreview');
  if (btnClose) btnClose.addEventListener('click', () => { modal.style.display = 'none'; });
}

// TABELA 3: SAQUES PIX
function preencherTabelaSaques(saques) {
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;

  if (!saques || saques.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--muted);">Sem solicitações de saque.</td></tr>';
    return;
  }

  tbody.innerHTML = saques.map(s => {
    let btnAcoes = '';
    if (s.status === 'pendente') {
      btnAcoes = `
        <button class="btn-tbl app" onclick="window.processarSaque('${s.id}', 'pago')">Baixar</button>
        <button class="btn-tbl rej" onclick="window.processarSaque('${s.id}', 'recusado')">Recusar</button>
      `;
    } else {
      btnAcoes = `<span style="font-size:10px; color:var(--muted)">${s.status.toUpperCase()}</span>`;
    }

    return `
      <tr>
        <td style="font-weight:700;">#${s.id}</td>
        <td style="color:#FFF; font-weight:800;">${s.motorista_nome}</td>
        <td>
          <div style="font-weight:700; color:var(--cyan);">${s.chave_pix}</div>
          <div style="font-size:9px; color:var(--muted); text-transform:uppercase;">Tipo: ${s.tipo_chave}</div>
        </td>
        <td style="color:#FFF; font-weight:800;">R$ ${Number(s.valor || 0).toFixed(2).replace('.', ',')}</td>
        <td><span class="badge badge-${s.status}">${s.status}</span></td>
        <td>${btnAcoes}</td>
      </tr>
    `;
  }).join('');
}

window.processarSaque = async (id, status) => {
  if (!confirm(`Marcar saque como ${status.toUpperCase()}?`)) return;
  try {
    const resp = await fetch(`${API_URL}/api/admin/saques/${id}/processar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    if (!resp.ok) throw new Error('Falha ao processar saque');
    carregarDadosDashboard();
  } catch (err) {
    alert(err.message);
  }
};

// TABELA 2: TARIFAS
function preencherInputsTarifas(tarifas) {
  const mapaIDs = {
    'carro_base': 'tarifa_carro_base', 'carro_km': 'tarifa_carro_km', 'carro_min': 'tarifa_carro_min',
    'moto_base': 'tarifa_moto_base', 'moto_km': 'tarifa_moto_km', 'moto_min': 'tarifa_moto_min',
    'flash_moto_base': 'tarifa_flash_base', 'flash_moto_km': 'tarifa_flash_km', 'flash_moto_min': 'tarifa_flash_min',
    'cargo_pickup_base': 'tarifa_cargo_base', 'cargo_pickup_km': 'tarifa_cargo_km', 'cargo_pickup_min': 'tarifa_cargo_min'
  };

  for (const cat in tarifas) {
    if (cat === 'multiplicador_pico') {
      const el = document.getElementById('tarifa_multiplicador');
      if (el) el.value = tarifas[cat];
      continue;
    }
    const dt = tarifas[cat];
    if (document.getElementById(mapaIDs[`${cat}_base`])) document.getElementById(mapaIDs[`${cat}_base`]).value = dt.base;
    if (document.getElementById(mapaIDs[`${cat}_km`])) document.getElementById(mapaIDs[`${cat}_km`]).value = dt.km;
    if (document.getElementById(mapaIDs[`${cat}_min`])) document.getElementById(mapaIDs[`${cat}_min`]).value = dt.min;
  }
}

async function salvarTarifasServidor() {
  const btn = document.getElementById('btnSalvarTarifas');
  btn.disabled = true;
  btn.textContent = 'A Gravar...';

  const payload = {
    carro: {
      base: Number(document.getElementById('tarifa_carro_base').value),
      km: Number(document.getElementById('tarifa_carro_km').value),
      min: Number(document.getElementById('tarifa_carro_min').value)
    },
    moto: {
      base: Number(document.getElementById('tarifa_moto_base').value),
      km: Number(document.getElementById('tarifa_moto_km').value),
      min: Number(document.getElementById('tarifa_moto_min').value)
    },
    flash_moto: {
      base: Number(document.getElementById('tarifa_flash_base').value),
      km: Number(document.getElementById('tarifa_flash_km').value),
      min: Number(document.getElementById('tarifa_flash_min').value)
    },
    cargo_pickup: {
      base: Number(document.getElementById('tarifa_cargo_base').value),
      km: Number(document.getElementById('tarifa_cargo_km').value),
      min: Number(document.getElementById('tarifa_cargo_min').value)
    },
    multiplicador_pico: Number(document.getElementById('tarifa_multiplicador').value)
  };

  try {
    const resp = await fetch(`${API_URL}/api/admin/tarifas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('Falha ao atualizar base de dados.');
    alert('Tarifas e Multiplicadores salvos com sucesso!');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Gravar';
  }
}

// RELATÓRIO EXCEL / CSV
async function exportarRelatorioCsv() {
  try {
    const resp = await fetch(`${API_URL}/api/admin/relatorios/corridas.csv`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) throw new Error('Falha ao gerar documento.');

    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `huby-relatorio-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message);
  }
}