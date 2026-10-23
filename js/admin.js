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

      if (!resp.ok) throw new Error('Falha ao consultar métricas');
      const data = await resp.json();

      // Atualizar Cards
      document.getElementById('mFaturamentoBruto').textContent = `R$ ${Number(data.faturamentoBruto || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('mReceitaHuby').textContent = `R$ ${Number(data.receitaPlataforma || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('mRepasseMotoristas').textContent = `R$ ${Number(data.repasseMotoristas || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('mChamadasAbertas').textContent = data.chamadasEmAberto || 0;

      // Renderizar Viagens Recentes
      const tbodyChamadas = document.getElementById('corpoTabelaChamadas');
      if (data.ultimasChamadas && data.ultimasChamadas.length > 0) {
        tbodyChamadas.innerHTML = data.ultimasChamadas.map(c => `
          <tr>
            <td><strong>#${String(c.id).substring(0, 8)}</strong></td>
            <td>${c.sub_tipo_label || 'HUBy Corrida'}</td>
            <td>${c.distancia_km ? `${c.distancia_km} km` : '--'}</td>
            <td><strong>R$ ${Number(c.valor_total || 0).toFixed(2).replace('.', ',')}</strong></td>
            <td>${c.motorista_nome || '<span style="color:#64748B;">Aguardando...</span>'}</td>
            <td><span class="badge badge-${c.status}">${c.status}</span></td>
          </tr>
        `).join('');
      } else {
        tbodyChamadas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B;">Nenhuma corrida realizada ainda.</td></tr>';
      }
    } catch (err) {
      console.error('Erro ao carregar métricas:', err);
    }
  }

  async function carregarMotoristas() {
    const tbodyMotoristas = document.getElementById('corpoTabelaMotoristas');
    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Falha ao consultar motoristas');
      const motoristas = await resp.json();

      if (motoristas && motoristas.length > 0) {
        tbodyMotoristas.innerHTML = motoristas.map(m => `
          <tr>
            <td><strong>${m.nome}</strong><br><small style="color:#64748B;">${m.telefone || m.email || ''}</small></td>
            <td>${m.cnh || '---'}</td>
            <td>${m.veiculo_modelo || 'Veículo'} (${m.veiculo_placa || 'SEM PLACA'})</td>
            <td><span style="text-transform:uppercase; font-size:11px;">${m.categoria_veiculo || 'carro'}</span></td>
            <td><strong>R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</strong></td>
            <td><span class="badge badge-${m.status_aprovacao || 'aprovado'}">${m.status_aprovacao || 'aprovado'}</span></td>
          </tr>
        `).join('');
      } else {
        tbodyMotoristas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748B;">Nenhum motorista parceiro cadastrado.</td></tr>';
      }
    } catch (err) {
      console.error('Erro ao listar frota:', err);
      tbodyMotoristas.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#EF4444;">Erro ao consultar frota.</td></tr>';
    }
  }

  document.getElementById('btnAtualizarDados')?.addEventListener('click', carregarDashboard);

  carregarDashboard();
});