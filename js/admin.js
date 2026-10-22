import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || role !== 'admin') {
    alert('Acesso restrito aos administradores.');
    window.location.replace('./login.html');
    return;
  }

  await carregarMetricasAdmin();
  setInterval(carregarMetricasAdmin, 10000); // Polling executivo a cada 10s
});

async function carregarMetricasAdmin() {
  const token = localStorage.getItem('huby_token');
  try {
    const resp = await fetch(`${API_URL}/api/admin/metricas`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) return;

    const data = await resp.json();

    document.getElementById('mFaturamentoBruto').textContent = `R$ ${data.faturamentoBruto.toFixed(2).replace('.', ',')}`;
    document.getElementById('mReceitaHuby').textContent = `R$ ${data.receitaPlataforma.toFixed(2).replace('.', ',')}`;
    document.getElementById('mRepasseMotoristas').textContent = `R$ ${data.repasseMotoristas.toFixed(2).replace('.', ',')}`;
    document.getElementById('mChamadasAbertas').textContent = data.chamadasEmAberto;

    const tbody = document.getElementById('corpoTabelaChamadas');
    if (!data.ultimasChamadas || data.ultimasChamadas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">Nenhuma chamada registada.</td></tr>';
      return;
    }

    tbody.innerHTML = data.ultimasChamadas.map(p => `
      <tr>
        <td>#${String(p.id).slice(-4)}</td>
        <td>${p.sub_tipo_label || 'Viagem'}</td>
        <td>${p.distancia_km} km</td>
        <td><strong>R$ ${Number(p.valor_total).toFixed(2).replace('.', ',')}</strong></td>
        <td>${p.motorista_nome || 'Aguardando'}</td>
        <td><span class="badge badge-${p.status}">${p.status}</span></td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Erro ao carregar métricas:', err);
  }
}