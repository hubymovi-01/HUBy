// js/app-admin.js - Orquestrador do Painel Administrativo HUBy
import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verificação de Acesso Admin
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || (role !== 'admin' && role !== 'administrador')) {
    alert('Acesso negado. Apenas administradores podem visualizar esta página.');
    window.location.replace('./index.html');
    return;
  }

  // 2. Navegação por Abas
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(target)?.classList.add('active');
    });
  });

  // 3. Logout
  document.getElementById('btnAdminLogout')?.addEventListener('click', () => {
    if (confirm('Deseja realmente sair da área administrativa?')) {
      window.location.replace('./index.html');
    }
  });

  // 4. Carregar Dados Iniciais
  await carregarMetricasKPI();
  await carregarTabelaCorridas();
  await carregarTabelaMotoristas();

  document.getElementById('btnRecarregarCorridas')?.addEventListener('click', carregarTabelaCorridas);
  document.getElementById('btnRecarregarMotoristas')?.addEventListener('click', carregarTabelaMotoristas);
  document.getElementById('btnSalvarTarifasServidor')?.addEventListener('click', salvarTarifasServidor);
});

async function carregarMetricasKPI() {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('kpiTotalFaturamento').textContent = `R$ ${Number(data.totalFaturamento || 0).toFixed(2).replace('.', ',')}`;
    document.getElementById('kpiCorridasAtivas').textContent = data.corridasAtivas || 0;
    document.getElementById('kpiCorridasConcluidasHoje').textContent = `${data.concluidasHoje || 0} concluídas hoje`;
    document.getElementById('kpiMotoristasOnline').textContent = data.motoristasOnline || 0;
    document.getElementById('kpiTotalMotoristasCadastrados').textContent = `${data.totalMotoristas || 0} cadastrados`;
    document.getElementById('kpiNotaMedia').textContent = Number(data.notaMedia || 5.0).toFixed(1);
  } catch (e) {
    console.warn('Falha ao carregar KPIs:', e);
  }
}

async function carregarTabelaCorridas() {
  const token = localStorage.getItem('huby_token');
  const tbody = document.getElementById('listaAdminCorridas');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Falha ao carregar');
    const corridas = await res.json();

    if (!corridas || corridas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-table-cell">Nenhuma corrida registrada no momento.</td></tr>`;
      return;
    }

    tbody.innerHTML = corridas.map(c => `
      <tr>
        <td><strong>#${c.id}</strong></td>
        <td>${c.passageiro_nome || 'Cliente'}</td>
        <td>${c.motorista_nome || '<span style="color:#64748B;">Aguardando...</span>'}</td>
        <td><span style="font-weight:700;">${c.categoria?.toUpperCase() || 'CARRO'}</span></td>
        <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${c.endereco_origem || 'Origem'} ➔ <strong>${c.endereco_destino || 'Destino'}</strong>
        </td>
        <td><strong style="color:#10B981;">R$ ${Number(c.valor || 0).toFixed(2).replace('.', ',')}</strong></td>
        <td><span class="status-badge ${obterClasseStatus(c.status)}">${c.status}</span></td>
        <td>
          <button type="button" style="background:rgba(255,255,255,0.08);border:none;color:#FFF;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;">
            Detalhes
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-table-cell">Erro ao sincronizar corridas.</td></tr>`;
  }
}

async function carregarTabelaMotoristas() {
  const token = localStorage.getItem('huby_token');
  const tbody = document.getElementById('listaAdminMotoristas');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Falha ao carregar');
    const motoristas = await res.json();

    if (!motoristas || motoristas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-table-cell">Nenhum motorista cadastrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = motoristas.map(m => `
      <tr>
        <td><strong>${m.nome}</strong></td>
        <td>${m.veiculo} • <span style="font-family:monospace;font-weight:800;">${m.placa}</span></td>
        <td>${m.telefone || '--'}</td>
        <td>⭐ ${Number(m.avaliacao || 5.0).toFixed(1)}</td>
        <td><span class="status-badge ${m.ativo ? 'concluido' : 'cancelado'}">${m.ativo ? 'Ativo' : 'Pendente'}</span></td>
        <td>85%</td>
        <td>
          <button type="button" style="background:rgba(56,189,248,0.15);border:1px solid #38BDF8;color:#38BDF8;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">
            ${m.ativo ? 'Suspender' : 'Aprovar'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table-cell">Erro ao sincronizar parceiros.</td></tr>`;
  }
}

function obterClasseStatus(status) {
  if (status === 'concluido') return 'concluido';
  if (status === 'em_viagem' || status === 'a_caminho') return 'andamento';
  if (status === 'cancelado') return 'cancelado';
  return 'pendente';
}

async function salvarTarifasServidor() {
  const token = localStorage.getItem('huby_token');
  const tarifas = {
    carro: {
      base: parseFloat(document.getElementById('tarifaCarroBase').value),
      km: parseFloat(document.getElementById('tarifaCarroKm').value),
      min: parseFloat(document.getElementById('tarifaCarroMin').value)
    },
    moto: {
      base: parseFloat(document.getElementById('tarifaMotoBase').value),
      km: parseFloat(document.getElementById('tarifaMotoKm').value),
      min: parseFloat(document.getElementById('tarifaMotoMin').value)
    },
    flash: {
      base: parseFloat(document.getElementById('tarifaFlashBase').value),
      km: parseFloat(document.getElementById('tarifaFlashKm').value),
      min: parseFloat(document.getElementById('tarifaFlashMin').value)
    }
  };

  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(tarifas)
    });

    if (res.ok) {
      alert('✅ Tarifas atualizadas com sucesso no banco de dados!');
    } else {
      alert('❌ Erro ao salvar tarifas.');
    }
  } catch (e) {
    alert('Erro de conexão ao salvar tarifas.');
  }
}