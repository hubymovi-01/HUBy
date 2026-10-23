import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('huby_token');

  async function carregarDashboard() {
    await Promise.all([
      carregarMetricas(),
      carregarMotoristas()
    ]);
  }

  async function carregarMetricas() {
    try {
      const resp = await fetch(`${API_URL}/api/admin/metricas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Falha ao obter métricas.');
      const data = await resp.json();

      const faturamentoBruto = Number(data.faturamentoBruto || 0);
      const receitaHuby = Number(data.receitaPlataforma || 0);
      const repasseMotoristas = Number(data.repasseMotoristas || 0);

      document.getElementById('mFaturamentoBruto').textContent = `R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}`;
      document.getElementById('mReceitaHuby').textContent = `R$ ${receitaHuby.toFixed(2).replace('.', ',')}`;
      document.getElementById('mReceitaHubySub').textContent = `R$ ${receitaHuby.toFixed(2).replace('.', ',')}`;
      document.getElementById('mRepasseMotoristas').textContent = `R$ ${repasseMotoristas.toFixed(2).replace('.', ',')}`;
      document.getElementById('mChamadasAbertas').textContent = data.chamadasEmAberto || 0;
      document.getElementById('mMotoristasAtivos').textContent = data.motoristasAtivos || 0;

      const tbodyChamadas = document.getElementById('corpoTabelaChamadas');
      if (data.ultimasChamadas && data.ultimasChamadas.length > 0) {
        tbodyChamadas.innerHTML = data.ultimasChamadas.map(c => `
          <tr>
            <td><strong>#${String(c.id).substring(0, 8)}</strong></td>
            <td>${c.sub_tipo_label || 'HUBy Corrida'}</td>
            <td>${c.distancia_km ? `${c.distancia_km} km` : '--'}</td>
            <td><strong style="color: #FFF;">R$ ${Number(c.valor_total || 0).toFixed(2).replace('.', ',')}</strong></td>
            <td>${c.motorista_nome || '<span style="color:#64748B;">Aguardando aceite...</span>'}</td>
            <td><span class="badge badge-${c.status}">${c.status}</span></td>
          </tr>
        `).join('');
      } else {
        tbodyChamadas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B;">Nenhuma viagem encontrada.</td></tr>';
      }
    } catch (err) {
      console.error('Erro ao consultar métricas:', err);
    }
  }

  async function carregarMotoristas() {
    const tbodyMotoristas = document.getElementById('corpoTabelaMotoristas');
    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Falha ao listar parceiros.');
      const motoristas = await resp.json();

      if (motoristas && motoristas.length > 0) {
        tbodyMotoristas.innerHTML = motoristas.map(m => `
          <tr>
            <td><strong>${m.nome}</strong><br><small style="color:#64748B;">${m.telefone || m.email || ''}</small></td>
            <td>${m.cnh || '---'}</td>
            <td>${m.veiculo_modelo || 'Veículo'} <span style="color:#64748B;">(${m.veiculo_placa || 'SEM PLACA'})</span></td>
            <td><span style="text-transform:uppercase; font-size:11px; font-weight:700;">${m.categoria_veiculo || 'carro'}</span></td>
            <td><strong style="color: var(--accent-green);">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</strong></td>
            <td><span class="badge badge-${m.status_aprovacao || 'aprovado'}">${m.status_aprovacao || 'aprovado'}</span></td>
          </tr>
        `).join('');
      } else {
        tbodyMotoristas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B;">Nenhum condutor parceiro registado.</td></tr>';
      }
    } catch (err) {
      console.error('Erro na frota:', err);
      tbodyMotoristas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#EF4444;">Erro ao consultar condutores.</td></tr>';
    }
  }

  document.getElementById('btnAtualizarDados')?.addEventListener('click', carregarDashboard);
  carregarDashboard();
});