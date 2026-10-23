import { API_URL } from './config.js';

let chartFinanceiroInstance = null;
let chartCategoriasInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('huby_token');

  async function inicializarDashboard() {
    await Promise.all([
      carregarMetricasEInformacoes(),
      carregarFrotaMotoristas()
    ]);
  }

  // 1. CARREGAR MÉTRICAS GERAIS, CORRIDAS E GERAR GRÁFICOS
  async function carregarMetricasEInformacoes() {
    try {
      const resp = await fetch(`${API_URL}/api/admin/metricas`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Não foi possível obter dados administrativos.');
      const data = await resp.json();

      const faturamentoBruto = Number(data.faturamentoBruto || 0);
      const receitaHuby = Number(data.receitaPlataforma || 0);
      const repasseMotoristas = Number(data.repasseMotoristas || 0);

      // Atualizar Cards
      document.getElementById('metricBruto').textContent = `R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}`;
      document.getElementById('metricLiquido').textContent = `R$ ${receitaHuby.toFixed(2).replace('.', ',')}`;
      document.getElementById('metricRepasse').textContent = `R$ ${repasseMotoristas.toFixed(2).replace('.', ',')}`;
      document.getElementById('metricRadar').textContent = data.chamadasEmAberto || 0;

      // Renderizar Tabela de Corridas
      renderizarTabelaCorridas(data.ultimasChamadas || []);

      // Renderizar Gráficos Chart.js
      renderizarGraficos(data);
    } catch (err) {
      console.error('Erro ao carregar métricas:', err);
    }
  }

  function renderizarTabelaCorridas(corridas) {
    const tbody = document.getElementById('tabelaCorridasBody');
    if (!corridas || corridas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748B;">Nenhuma viagem encontrada.</td></tr>';
      return;
    }

    tbody.innerHTML = corridas.map(c => {
      const valor = Number(c.valor_total || 0);
      const taxa = valor * 0.15;

      return `
        <tr>
          <td><strong>#${String(c.id).substring(0, 8)}</strong></td>
          <td>${c.sub_tipo_label || 'HUBy Corrida'}</td>
          <td>${c.distancia_km ? `${c.distancia_km} km` : '--'}</td>
          <td><strong>R$ ${valor.toFixed(2).replace('.', ',')}</strong></td>
          <td style="color: #38BDF8;">R$ ${taxa.toFixed(2).replace('.', ',')}</td>
          <td>${c.motorista_nome || '<span style="color: #64748B;">Aguardando aceite...</span>'}</td>
          <td><span class="badge badge-${c.status}">${c.status}</span></td>
        </tr>
      `;
    }).join('');
  }

  // 2. CONFIGURAÇÃO E PLOTAGEM DOS GRÁFICOS CHART.JS
  function renderizarGraficos(data) {
    const ctxFin = document.getElementById('chartFinanceiro')?.getContext('2d');
    const ctxCat = document.getElementById('chartCategorias')?.getContext('2d');

    if (!ctxFin || !ctxCat) return;

    // Destruir instâncias antigas ao atualizar dados
    if (chartFinanceiroInstance) chartFinanceiroInstance.destroy();
    if (chartCategoriasInstance) chartCategoriasInstance.destroy();

    // Gráfico de Barras Financeiras
    chartFinanceiroInstance = new Chart(ctxFin, {
      type: 'bar',
      data: {
        labels: ['Volume Bruto', 'Repasse Parceiros (85%)', 'Receita HUBy (15%)'],
        datasets: [{
          label: 'Valores em R$',
          data: [
            Number(data.faturamentoBruto || 0),
            Number(data.repasseMotoristas || 0),
            Number(data.receitaPlataforma || 0)
          ],
          backgroundColor: ['#10B981', '#F59E0B', '#38BDF8'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94A3B8' }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#94A3B8' }
          }
        }
      }
    });

    // Gráfico de Donut por Modalidades
    // Contagem baseada nas últimas chamadas
    const contagem = { carro: 0, moto: 0, flash: 0, frete: 0 };
    (data.ultimasChamadas || []).forEach(c => {
      const tipo = String(c.tipo || '').toLowerCase();
      if (tipo.includes('moto')) contagem.moto++;
      else if (tipo.includes('flash')) contagem.flash++;
      else if (tipo.includes('cargo') || tipo.includes('frete')) contagem.frete++;
      else contagem.carro++;
    });

    chartCategoriasInstance = new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: ['Carro', 'Moto', 'Flash', 'Frete'],
        datasets: [{
          data: [contagem.carro, contagem.moto, contagem.flash, contagem.frete],
          backgroundColor: ['#10B981', '#38BDF8', '#F59E0B', '#A855F7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94A3B8', boxWidth: 12 }
          }
        }
      }
    });
  }

  // 3. GESTÃO E CONTROLE DE MOTORISTAS
  async function carregarFrotaMotoristas() {
    const tbody = document.getElementById('tabelaFrotaBody');
    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) throw new Error('Falha ao listar parceiros.');
      const motoristas = await resp.json();

      if (!motoristas || motoristas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748B;">Nenhum condutor parceiro cadastrado.</td></tr>';
        return;
      }

      tbody.innerHTML = motoristas.map(m => `
        <tr>
          <td>
            <strong>${m.nome}</strong><br>
            <small style="color: #64748B;">${m.telefone || m.email || ''}</small>
          </td>
          <td>${m.cnh || '---'}</td>
          <td>${m.veiculo_modelo || 'Veículo'} (${m.veiculo_placa || 'SEM PLACA'})</td>
          <td><span style="text-transform: uppercase; font-size: 11px; font-weight: 800;">${m.categoria_veiculo || 'carro'}</span></td>
          <td><strong style="color: #10B981;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</strong></td>
          <td><span class="badge badge-${m.status_aprovacao || 'aprovado'}">${m.status_aprovacao || 'aprovado'}</span></td>
          <td>
            <button class="btn-table-action btn-approve" onclick="window.alterarStatusMotorista('${m.id}', 'aprovar')">Aprovar</button>
            <button class="btn-table-action btn-suspend" onclick="window.alterarStatusMotorista('${m.id}', 'recusar')">Suspender</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Erro na frota:', err);
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #EF4444;">Erro ao carregar parceiros.</td></tr>';
    }
  }

  // Ação Global para o Administrador controlar o parceiro
  window.alterarStatusMotorista = async (motoristaId, acao) => {
    if (!confirm(`Confirma ${acao === 'aprovar' ? 'aprovação' : 'suspensão'} deste motorista?`)) return;

    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas/${motoristaId}/triagem`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ acao })
      });

      if (!resp.ok) throw new Error('Não foi possível alterar status.');

      alert(`Motorista ${acao === 'aprovar' ? 'aprovado' : 'suspenso'} com sucesso!`);
      inicializarDashboard();
    } catch (e) {
      alert(e.message);
    }
  };

  document.getElementById('btnSincronizar')?.addEventListener('click', inicializarDashboard);

  inicializarDashboard();
});