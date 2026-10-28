import { API_URL } from './config.js';

// Verificação de segurança admin
const token = localStorage.getItem('huby_token');
const role = localStorage.getItem('huby_user_role');

if (!token || role !== 'admin') {
  window.location.replace('./welcome.html');
}

// Navegação por Abas
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// Funções Utilitárias para Formatar Moeda
const fMoeda = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);

let chartFin = null;
let chartCat = null;

// ==========================================
// 1. CARREGAR MÉTRICAS E GRÁFICOS
// ==========================================
async function carregarMetricas() {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`, { headers: { 'Authorization': `Bearer ${token}` } });
    const dados = await res.json();

    const bruto = Number(dados.financeiro.faturamento_total) || 0;
    const repasse = Number(dados.financeiro.total_pago_motoristas) || 0;
    const liquido = Number(dados.financeiro.lucro_plataforma) || 0;

    document.getElementById('metricBruto').textContent = fMoeda(bruto);
    document.getElementById('metricLiquido').textContent = fMoeda(liquido);
    document.getElementById('metricRepasse').textContent = fMoeda(repasse);
    document.getElementById('metricRadar').textContent = dados.pedidos.pendentes;

    renderizarGraficos(bruto, liquido, repasse, dados.pedidos);
  } catch (err) {
    console.error("Erro ao carregar métricas:", err);
  }
}

function renderizarGraficos(bruto, liquido, repasse, pedidos) {
  const ctxFin = document.getElementById('chartFinanceiro').getContext('2d');
  if(chartFin) chartFin.destroy();
  chartFin = new Chart(ctxFin, {
    type: 'doughnut',
    data: {
      labels: ['Lucro HUBy (15%)', 'Repasse Motoristas (85%)'],
      datasets: [{ data: [liquido, repasse], backgroundColor: ['#38BDF8', '#F59E0B'], borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#FFF' } } } }
  });

  const ctxCat = document.getElementById('chartCategorias').getContext('2d');
  if(chartCat) chartCat.destroy();
  chartCat = new Chart(ctxCat, {
    type: 'bar',
    data: {
      labels: ['Pendentes', 'Concluídos', 'Cancelados'],
      datasets: [{ label: 'Qtd', data: [pedidos.pendentes, pedidos.concluidos, pedidos.cancelados], backgroundColor: ['#F59E0B', '#10B981', '#F43F5E'] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { color: '#64748B' } }, x: { ticks: { color: '#64748B' } } } }
  });
}

// ==========================================
// 2. GESTÃO DE SAQUES PIX
// ==========================================
async function carregarSaques() {
  const tbody = document.getElementById('tabelaSaquesBody');
  try {
    const res = await fetch(`${API_URL}/api/admin/saques`, { headers: { 'Authorization': `Bearer ${token}` } });
    const saques = await res.json();
    
    if (saques.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted);">Nenhum pedido de saque.</td></tr>';
      return;
    }

    tbody.innerHTML = saques.map(s => {
      let botoesAcao = '';
      if (s.status === 'pendente') {
        botoesAcao = '<button class="btn-tbl app" onclick="aprovarSaque(' + s.id + ')">Aprovar & Pagar</button>' +
                     '<button class="btn-tbl rej" onclick="rejeitarSaque(' + s.id + ')" style="margin-left:4px;">Recusar</button>';
      } else {
        botoesAcao = '<small style="color: var(--muted);">Já processado</small>';
      }

      let cssBadge = 'badge-pendente';
      if (s.status === 'pago') cssBadge = 'badge-pago';
      if (s.status === 'recusado') cssBadge = 'badge-recusado';

      return '<tr>' +
        '<td>#' + s.id + '</td>' +
        '<td><strong>' + s.motorista_nome + '</strong></td>' +
        '<td><span style="color: #38BDF8; font-family: monospace;">' + s.chave_pix + '</span> (' + s.tipo_chave + ')</td>' +
        '<td style="color: #10B981; font-weight: 800;">' + fMoeda(s.valor) + '</td>' +
        '<td><span class="badge ' + cssBadge + '">' + s.status + '</span></td>' +
        '<td>' + botoesAcao + '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--rose);">Erro de conexão.</td></tr>';
  }
}

window.aprovarSaque = async (id) => {
  if(!confirm('Confirma que já enviou o dinheiro por Pix para o parceiro?')) return;
  try {
    await fetch(`${API_URL}/api/admin/saques/${id}/aprovar`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    alert('Saque marcado como PAGO!');
    carregarSaques();
  } catch(e) { alert('Erro ao aprovar.'); }
}

window.rejeitarSaque = async (id) => {
  const motivo = prompt("Motivo da recusa:");
  if(!motivo) return;
  try {
    await fetch(`${API_URL}/api/admin/saques/${id}/rejeitar`, { 
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ motivo })
    });
    carregarSaques();
  } catch(e) { alert('Erro ao rejeitar.'); }
}

// ==========================================
// 3. GESTÃO DE FROTA
// ==========================================
async function carregarFrota() {
  const tbody = document.getElementById('tabelaFrotaBody');
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, { headers: { 'Authorization': `Bearer ${token}` } });
    const motoristas = await res.json();

    tbody.innerHTML = motoristas.map(m => {
      let btnDoc = m.doc_crlv_url ? '<button class="btn-tbl" style="background:#38BDF8; color:#000;" onclick="verDoc(\'' + m.doc_crlv_url + '\')">Ver Doc</button>' : '<small>Sem doc</small>';
      
      let botoesMot = '';
      if (m.status_aprovacao === 'pendente') {
        botoesMot = '<button class="btn-tbl app" onclick="alterarStatusMot(\'' + m.id + '\', \'aprovado\')">Aprovar</button>' +
                    '<button class="btn-tbl rej" onclick="alterarStatusMot(\'' + m.id + '\', \'recusado\')" style="margin-left:4px;">Bloquear</button>';
      } else {
        botoesMot = '<button class="btn-tbl rej" onclick="alterarStatusMot(\'' + m.id + '\', \'recusado\')">Suspender</button>';
      }

      let cssStatus = 'badge-pendente';
      if(m.status_aprovacao === 'aprovado') cssStatus = 'badge-aprovado';
      if(m.status_aprovacao === 'recusado') cssStatus = 'badge-recusado';

      return '<tr>' +
        '<td><strong>' + m.nome + '</strong><br><small style="color:var(--muted);">' + m.telefone + '</small></td>' +
        '<td>' + m.veiculo_modelo + '<br><strong style="letter-spacing: 1px; color:#FFF;">' + m.veiculo_placa + '</strong></td>' +
        '<td>' + (m.categoria || '').toUpperCase() + '</td>' +
        '<td style="color: #10B981; font-weight: 800;">' + fMoeda(m.saldo_carteira) + '</td>' +
        '<td><span class="badge ' + cssStatus + '">' + m.status_aprovacao + '</span></td>' +
        '<td>' + btnDoc + '</td>' +
        '<td>' + botoesMot + '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--rose);">Erro ao carregar parceiros.</td></tr>';
  }
}

window.alterarStatusMot = async (id, status) => {
  if(!confirm(`Deseja alterar o motorista para ${status}?`)) return;
  try {
    await fetch(`${API_URL}/api/admin/motoristas/${id}/status`, { 
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ status_aprovacao: status })
    });
    carregarFrota();
  } catch(e) { alert('Erro na alteração.'); }
}

window.verDoc = (url) => {
  document.getElementById('imgPreviewVeiculo').src = url;
  document.getElementById('modalPreviewFoto').style.display = 'flex';
}
document.getElementById('btnFecharModalPreview').addEventListener('click', () => {
  document.getElementById('modalPreviewFoto').style.display = 'none';
});

// ==========================================
// 4. MONITOR DE VIAGENS
// ==========================================
async function carregarViagens() {
  const tbody = document.getElementById('tabelaCorridasBody');
  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, { headers: { 'Authorization': `Bearer ${token}` } });
    const viagens = await res.json();
    
    tbody.innerHTML = viagens.map(v => {
      const taxa = Number(v.valor_total) * 0.15;
      let badgeClass = 'badge-concluido';
      if(v.status === 'pendente') badgeClass = 'badge-pendente';
      if(v.status === 'cancelado') badgeClass = 'badge-cancelado';
      if(v.status === 'aceito') badgeClass = 'badge-aceito';

      return '<tr>' +
        '<td><small style="color:var(--muted)">' + String(v.id).substring(0,8) + '</small></td>' +
        '<td>' + (v.sub_tipo_label || v.tipo) + '</td>' +
        '<td>' + Number(v.distancia_km).toFixed(1) + ' km</td>' +
        '<td style="color: #F59E0B; font-weight: 800;">' + fMoeda(v.valor_total) + '</td>' +
        '<td style="color: #38BDF8; font-weight: 800;">+ ' + fMoeda(taxa) + '</td>' +
        '<td>' + (v.motorista_nome || 'Nenhum') + '</td>' +
        '<td><span class="badge ' + badgeClass + '">' + v.status + '</span></td>' +
      '</tr>';
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--rose);">Erro ao monitorizar viagens.</td></tr>';
  }
}

document.getElementById('btnSincronizar').addEventListener('click', () => {
  carregarMetricas(); carregarSaques(); carregarFrota(); carregarViagens();
});

// Iniciar tudo ao carregar a página
carregarMetricas();
carregarSaques();
carregarFrota();
carregarViagens();