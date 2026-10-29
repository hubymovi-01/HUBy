import { API_URL } from './config.js';

// ==========================================
// SEGURANÇA E ACESSO
// ==========================================
const token = localStorage.getItem('huby_token');
let role = (localStorage.getItem('huby_user_role') || '').toLowerCase();

if (token && !role) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const payload = JSON.parse(jsonPayload);
    role = String(payload.role || payload.funcao || payload.tipo || '').toLowerCase();
    if (role) localStorage.setItem('huby_user_role', role);
  } catch (e) {
    console.warn('Erro ao decodificar token:', e);
  }
}

if (!token || (role !== 'admin' && role !== 'administrador')) {
  window.location.replace('./welcome.html');
}

// Navegação por Abas
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const pane = document.getElementById(btn.dataset.tab);
    if (pane) pane.classList.add('active');

    if (btn.dataset.tab === 'tabMetricas') {
      carregarMetricas();
    }
  });
});

const fMoeda = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);

let chartFin = null;
let chartCat = null;

// ==========================================
// 1. CARREGAR MÉTRICAS E RENDERIZAR GRÁFICOS
// ==========================================
async function carregarMetricas() {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Falha ao obter métricas');
    const dados = await res.json();

    const bruto = Number(dados.financeiro?.faturamento_total ?? dados.faturamentoBruto ?? 0);
    const repasse = Number(dados.financeiro?.total_pago_motoristas ?? dados.repasseMotoristas ?? 0);
    const liquido = Number(dados.financeiro?.lucro_plataforma ?? dados.receitaPlataforma ?? 0);
    const pedidos = dados.pedidos || { pendentes: dados.chamadasEmAberto || 0, concluidos: dados.totalCorridas || 0, cancelados: 0 };

    document.getElementById('metricBruto').textContent = fMoeda(bruto);
    document.getElementById('metricLiquido').textContent = fMoeda(liquido);
    document.getElementById('metricRepasse').textContent = fMoeda(repasse);
    document.getElementById('metricConcluidas').textContent = pedidos.concluidos || 0;
    document.getElementById('metricMotoristas').textContent = dados.motoristas?.total ?? dados.motoristasAtivos ?? 0;

    renderizarGraficos(bruto, liquido, repasse, pedidos);
  } catch (err) {
    console.error("Erro ao carregar métricas:", err);
  }
}

function renderizarGraficos(bruto, liquido, repasse, pedidos) {
  const canvasFin = document.getElementById('chartFinanceiro');
  const canvasCat = document.getElementById('chartCategorias');

  if (!canvasFin || !canvasCat) return;

  if (chartFin) chartFin.destroy();
  chartFin = new Chart(canvasFin.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Lucro HUBy', 'Repasse Parceiros'],
      datasets: [{
        data: [liquido > 0 ? liquido : 1, repasse > 0 ? repasse : 1],
        backgroundColor: ['#38BDF8', '#F59E0B'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#FFF' } }
      }
    }
  });

  if (chartCat) chartCat.destroy();
  chartCat = new Chart(canvasCat.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['Pendentes', 'Concluídos', 'Cancelados'],
      datasets: [{
        label: 'Viagens',
        data: [pedidos.pendentes || 0, pedidos.concluidos || 0, pedidos.cancelados || 0],
        backgroundColor: ['#F59E0B', '#10B981', '#EF4444'],
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#64748B' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#64748B' }, grid: { display: false } }
      }
    }
  });
}

// ==========================================
// 2. GESTÃO DE SAQUES PIX
// ==========================================
async function carregarSaques() {
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/saques`, { headers: { 'Authorization': `Bearer ${token}` } });
    const saques = await res.json();
    
    if (!saques || saques.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted); padding: 20px;">Nenhum pedido de saque registrado.</td></tr>';
      return;
    }

    tbody.innerHTML = saques.map(s => {
      let botoesAcao = '';
      if (s.status === 'pendente') {
        botoesAcao = `<button class="btn-tbl app" onclick="aprovarSaque(${s.id})">Aprovar & Pagar</button>
                      <button class="btn-tbl rej" onclick="rejeitarSaque(${s.id})" style="margin-left:4px;">Recusar</button>`;
      } else {
        botoesAcao = '<small style="color: var(--muted);">Processado</small>';
      }

      let cssBadge = 'badge-pendente';
      if (s.status === 'pago') cssBadge = 'badge-pago';
      if (s.status === 'recusado') cssBadge = 'badge-recusado';

      return `<tr>
        <td>#${s.id}</td>
        <td><strong>${s.motorista_nome || 'Motorista'}</strong></td>
        <td><span style="color: #38BDF8; font-family: monospace;">${s.chave_pix}</span> (${s.tipo_chave})</td>
        <td style="color: #10B981; font-weight: 800;">${fMoeda(s.valor)}</td>
        <td><span class="badge ${cssBadge}">${s.status}</span></td>
        <td>${botoesAcao}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--rose);">Erro ao carregar lista de saques.</td></tr>';
  }
}

window.aprovarSaque = async (id) => {
  if (!confirm('Confirma que realizou a transferência Pix para o parceiro?')) return;
  try {
    await fetch(`${API_URL}/api/admin/saques/${id}/aprovar`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    alert('Saque marcado como PAGO!');
    carregarSaques();
    carregarMetricas();
  } catch (e) { alert('Erro ao processar aprovação.'); }
};

window.rejeitarSaque = async (id) => {
  const motivo = prompt("Motivo da recusa do saque:");
  if (!motivo) return;
  try {
    await fetch(`${API_URL}/api/admin/saques/${id}/rejeitar`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
      body: JSON.stringify({ motivo })
    });
    carregarSaques();
  } catch (e) { alert('Erro ao recusar saque.'); }
};

// ==========================================
// 3. GESTÃO DE FROTA
// ==========================================
async function carregarFrota() {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, { headers: { 'Authorization': `Bearer ${token}` } });
    const motoristas = await res.json();

    if (!motoristas || motoristas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 20px;">Nenhum motorista cadastrado na base.</td></tr>';
      return;
    }

    tbody.innerHTML = motoristas.map(m => {
      let btnDoc = m.doc_crlv_url ? `<button class="btn-tbl" style="background:#38BDF8; color:#000;" onclick="verDoc('${m.doc_crlv_url}')">Ver Doc</button>` : '<small>Sem anexo</small>';
      
      let botoesMot = '';
      if (m.status_aprovacao === 'pendente') {
        botoesMot = `<button class="btn-tbl app" onclick="alterarStatusMot('${m.id}', 'aprovar')">Aprovar</button>
                    <button class="btn-tbl rej" onclick="alterarStatusMot('${m.id}', 'recusar')" style="margin-left:4px;">Bloquear</button>`;
      } else {
        botoesMot = `<button class="btn-tbl rej" onclick="alterarStatusMot('${m.id}', 'recusar')">Suspender</button>`;
      }

      let cssStatus = 'badge-pendente';
      if (m.status_aprovacao === 'aprovado') cssStatus = 'badge-aprovado';
      if (m.status_aprovacao === 'recusado') cssStatus = 'badge-recusado';

      return `<tr>
        <td><strong>${m.nome}</strong><br><small style="color:var(--muted);">${m.telefone || 'Sem contato'}</small></td>
        <td>${m.veiculo_modelo || 'Veículo'}<br><strong style="letter-spacing: 1px; color:#FFF;">${m.veiculo_placa || '---'}</strong></td>
        <td>${(m.categoria_veiculo || m.categoria || '').toUpperCase()}</td>
        <td style="color: #10B981; font-weight: 800;">${fMoeda(m.saldo_carteira)}</td>
        <td><span class="badge ${cssStatus}">${m.status_aprovacao}</span></td>
        <td>${btnDoc}</td>
        <td>${botoesMot}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--rose);">Erro ao consultar frota.</td></tr>';
  }
}

window.alterarStatusMot = async (id, acao) => {
  if (!confirm(`Deseja aplicar a ação "${acao}" neste motorista?`)) return;
  try {
    await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, { 
      method: 'PUT', 
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, 
      body: JSON.stringify({ acao })
    });
    carregarFrota();
  } catch (e) { alert('Erro ao alterar status.'); }
};

window.verDoc = (url) => {
  const img = document.getElementById('imgPreviewVeiculo');
  const modal = document.getElementById('modalPreviewFoto');
  if (img && modal) {
    img.src = url;
    modal.style.display = 'flex';
  }
};

document.getElementById('btnFecharModalPreview')?.addEventListener('click', () => {
  const modal = document.getElementById('modalPreviewFoto');
  if (modal) modal.style.display = 'none';
});

// ==========================================
// 4. MONITOR DE VIAGENS
// ==========================================
async function carregarViagens() {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, { headers: { 'Authorization': `Bearer ${token}` } });
    const viagens = await res.json();
    
    if (!viagens || viagens.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted); padding: 20px;">Nenhuma viagem solicitada até o momento.</td></tr>';
      return;
    }

    tbody.innerHTML = viagens.map(v => {
      const taxa = Number(v.valor_total || 0) * 0.15;
      let badgeClass = 'badge-concluido';
      if (v.status === 'pendente') badgeClass = 'badge-pendente';
      if (v.status === 'cancelado') badgeClass = 'badge-cancelado';
      if (v.status === 'aceito') badgeClass = 'badge-aceito';

      return `<tr>
        <td><small style="color:var(--muted)">${String(v.id).substring(0,8)}</small></td>
        <td>${v.sub_tipo_label || v.tipo}</td>
        <td>${Number(v.distancia_km || 0).toFixed(1)} km</td>
        <td style="color: #F59E0B; font-weight: 800;">${fMoeda(v.valor_total)}</td>
        <td style="color: #38BDF8; font-weight: 800;">+ ${fMoeda(taxa)}</td>
        <td>${v.motorista_nome || 'Aguardando'}</td>
        <td><span class="badge ${badgeClass}">${v.status}</span></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--rose);">Erro ao carregar viagens.</td></tr>';
  }
}

// ==========================================
// 5. SALVAR REGRAS DE NEGÓCIO E TAXAS
// ==========================================
document.getElementById('formConfiguracoes')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const taxa_plataforma = document.getElementById('cfgTaxaPlataforma').value;
  const tarifa_km_carro = document.getElementById('cfgKmCarro').value;
  const tarifa_km_moto = document.getElementById('cfgKmMoto').value;
  const tarifa_km_entrega = document.getElementById('cfgKmEntrega').value;

  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        taxa_plataforma: Number(taxa_plataforma),
        tarifa_km_carro: Number(tarifa_km_carro),
        tarifa_km_moto: Number(tarifa_km_moto),
        tarifa_km_entrega: Number(tarifa_km_entrega)
      })
    });

    if (res.ok) {
      alert('Configurações salvas e aplicadas a toda a plataforma!');
    } else {
      alert('Erro ao gravar configurações no servidor.');
    }
  } catch (err) {
    alert('Erro de conexão ao salvar configurações.');
  }
});

// Ações Globais
document.getElementById('btnSincronizar')?.addEventListener('click', () => {
  carregarMetricas();
  carregarSaques();
  carregarFrota();
  carregarViagens();
});

// Inicialização imediata
carregarMetricas();
carregarSaques();
carregarFrota();
carregarViagens();