import { API_URL } from './config.js';

let chartFin = null;
let chartCat = null;

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('huby_token');

  // CONTROLE DE NAVEGAÇÃO POR ABAS
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const pane = document.getElementById(targetId);
      if (pane) pane.classList.add('active');

      // Redesenha gráficos se abrir a aba de Resumo
      if (targetId === 'tab-geral') {
        if (chartFin) chartFin.resize();
        if (chartCat) chartCat.resize();
      }
    });
  });

  async function carregarTudo() {
    await Promise.all([
      carregarMetricas(),
      carregarTarifas(),
      carregarSaques(),
      carregarFrota()
    ]);
  }

  // 1. CARREGAR MÉTRICAS & GRÁFICOS
  async function carregarMetricas() {
    try {
      const resp = await fetch(`${API_URL}/api/admin/metricas`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();

      document.getElementById('metricBruto').textContent = `R$ ${Number(data.faturamentoBruto || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('metricLiquido').textContent = `R$ ${Number(data.receitaPlataforma || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('metricRepasse').textContent = `R$ ${Number(data.repasseMotoristas || 0).toFixed(2).replace('.', ',')}`;
      document.getElementById('metricRadar').textContent = data.chamadasEmAberto || 0;

      renderizarCorridas(data.ultimasChamadas || []);
      renderizarGraficos(data);
    } catch (e) {
      console.warn('Erro métricas:', e);
    }
  }

  function renderizarCorridas(corridas) {
    const tbody = document.getElementById('tabelaCorridasBody');
    if (!corridas || corridas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">Nenhuma corrida registrada.</td></tr>';
      return;
    }

    tbody.innerHTML = corridas.map(c => `
      <tr>
        <td><strong>#${String(c.id).substring(0, 8)}</strong></td>
        <td>${c.sub_tipo_label || 'HUBy Pop'}</td>
        <td>${c.distancia_km ? `${c.distancia_km} km` : '--'}</td>
        <td><strong>R$ ${Number(c.valor_total || 0).toFixed(2).replace('.', ',')}</strong></td>
        <td style="color: var(--cyan);">R$ ${(Number(c.valor_total || 0) * 0.15).toFixed(2).replace('.', ',')}</td>
        <td>${c.motorista_nome || '<span style="color: var(--muted);">Aguardando...</span>'}</td>
        <td><span class="badge badge-${c.status}">${c.status}</span></td>
      </tr>
    `).join('');
  }

  function renderizarGraficos(data) {
    const ctxFin = document.getElementById('chartFinanceiro')?.getContext('2d');
    const ctxCat = document.getElementById('chartCategorias')?.getContext('2d');
    if (!ctxFin || !ctxCat) return;

    if (chartFin) chartFin.destroy();
    if (chartCat) chartCat.destroy();

    chartFin = new Chart(ctxFin, {
      type: 'bar',
      data: {
        labels: ['Bruto', 'Repasse 85%', 'HUBy 15%'],
        datasets: [{
          data: [
            Number(data.faturamentoBruto || 0),
            Number(data.repasseMotoristas || 0),
            Number(data.receitaPlataforma || 0)
          ],
          backgroundColor: ['#10B981', '#F59E0B', '#38BDF8'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#64748B', font: { size: 10 } } },
          x: { grid: { display: false }, ticks: { color: '#64748B', font: { size: 10 } } }
        }
      }
    });

    const contagem = { carro: 0, moto: 0, flash: 0, frete: 0 };
    (data.ultimasChamadas || []).forEach(c => {
      const tipo = String(c.tipo || '').toLowerCase();
      if (tipo.includes('moto')) contagem.moto++;
      else if (tipo.includes('flash')) contagem.flash++;
      else if (tipo.includes('cargo') || tipo.includes('frete')) contagem.frete++;
      else contagem.carro++;
    });

    chartCat = new Chart(ctxCat, {
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
          legend: { position: 'bottom', labels: { color: '#94A3B8', boxWidth: 10, font: { size: 10 } } }
        }
      }
    });
  }

  // 2. GESTÃO DE TARIFAS
  async function carregarTarifas() {
    try {
      const resp = await fetch(`${API_URL}/api/config/tarifas`);
      if (!resp.ok) return;
      const t = await resp.json();

      if (t.carro) {
        document.getElementById('tarifa_carro_base').value = t.carro.base;
        document.getElementById('tarifa_carro_km').value = t.carro.km;
        document.getElementById('tarifa_carro_min').value = t.carro.min;
      }
      if (t.moto) {
        document.getElementById('tarifa_moto_base').value = t.moto.base;
        document.getElementById('tarifa_moto_km').value = t.moto.km;
        document.getElementById('tarifa_moto_min').value = t.moto.min;
      }
      if (t.flash_moto) {
        document.getElementById('tarifa_flash_base').value = t.flash_moto.base;
        document.getElementById('tarifa_flash_km').value = t.flash_moto.km;
        document.getElementById('tarifa_flash_min').value = t.flash_moto.min;
      }
      if (t.cargo_pickup) {
        document.getElementById('tarifa_cargo_base').value = t.cargo_pickup.base;
        document.getElementById('tarifa_cargo_km').value = t.cargo_pickup.km;
        document.getElementById('tarifa_cargo_min').value = t.cargo_pickup.min;
      }
      if (t.multiplicador_pico) {
        document.getElementById('tarifa_multiplicador').value = t.multiplicador_pico;
      }
    } catch (e) {
      console.warn('Erro tarifas:', e);
    }
  }

  async function salvarTarifas() {
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
      if (!resp.ok) throw new Error();
      alert('Tarifas atualizadas com sucesso!');
    } catch (e) {
      alert('Erro ao atualizar tarifas.');
    }
  }

  document.getElementById('btnSalvarTarifas')?.addEventListener('click', salvarTarifas);
  document.getElementById('btnAplicarPico')?.addEventListener('click', salvarTarifas);

  // 3. SAQUES PIX
  async function carregarSaques() {
    const tbody = document.getElementById('tabelaSaquesBody');
    try {
      const resp = await fetch(`${API_URL}/api/admin/saques`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const saques = await resp.json();

      if (!saques || saques.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted);">Nenhum pedido de saque.</td></tr>';
        return;
      }

      tbody.innerHTML = saques.map(s => `
        <tr>
          <td><strong>#${s.id}</strong></td>
          <td>${s.motorista_nome}</td>
          <td><code>${s.chave_pix}</code></td>
          <td><strong style="color: var(--emerald);">R$ ${Number(s.valor).toFixed(2).replace('.', ',')}</strong></td>
          <td><span class="badge badge-${s.status}">${s.status}</span></td>
          <td>
            ${s.status === 'pendente' ? `
              <button class="btn-tbl app" onclick="window.processarSaque(${s.id}, 'pago')">Pagar</button>
              <button class="btn-tbl rej" onclick="window.processarSaque(${s.id}, 'recusado')">Recusar</button>
            ` : '<span style="color: var(--muted);">Finalizado</span>'}
          </td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--rose);">Erro ao consultar saques.</td></tr>';
    }
  }

  window.processarSaque = async (saqueId, status) => {
    if (!confirm(`Confirma marcar este saque como ${status}?`)) return;
    try {
      const resp = await fetch(`${API_URL}/api/admin/saques/${saqueId}/processar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (!resp.ok) throw new Error();
      alert(`Saque marcado como ${status}!`);
      carregarSaques();
      carregarFrota();
    } catch (e) {
      alert('Falha ao processar saque.');
    }
  };

  // 4. FROTA DE MOTORISTAS
  async function carregarFrota() {
    const tbody = document.getElementById('tabelaFrotaBody');
    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const motoristas = await resp.json();

      if (!motoristas || motoristas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">Nenhum motorista cadastrado.</td></tr>';
        return;
      }

      tbody.innerHTML = motoristas.map(m => `
        <tr>
          <td><strong>${m.nome}</strong><br><small style="color: var(--muted);">${m.telefone || ''}</small></td>
          <td>${m.veiculo_modelo || 'Veículo'} (${m.veiculo_placa || 'SEM PLACA'})</td>
          <td><span style="text-transform: uppercase; font-size: 10px; font-weight: 800;">${m.categoria_veiculo || 'carro'}</span></td>
          <td><strong style="color: var(--emerald);">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</strong></td>
          <td><span class="badge badge-${m.status_aprovacao || 'aprovado'}">${m.status_aprovacao || 'aprovado'}</span></td>
          <td>
            ${m.doc_crlv_url ? `
              <button class="btn-tbl" style="background: rgba(255,255,255,0.06); color: #FFF;" onclick="window.abrirFotoModal('${m.doc_crlv_url}')">📷 Foto</button>
            ` : '<span style="color: var(--muted);">Sem foto</span>'}
          </td>
          <td>
            <button class="btn-tbl app" onclick="window.alterarStatusMotorista('${m.id}', 'aprovar')">Aprovar</button>
            <button class="btn-tbl rej" onclick="window.alterarStatusMotorista('${m.id}', 'recusar')">Suspender</button>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--rose);">Erro ao carregar parceiros.</td></tr>';
    }
  }

  window.abrirFotoModal = (url) => {
    const modal = document.getElementById('modalPreviewFoto');
    const img = document.getElementById('imgPreviewVeiculo');
    if (modal && img) {
      img.src = url;
      modal.style.display = 'flex';
    }
  };

  document.getElementById('btnFecharModalPreview')?.addEventListener('click', () => {
    const modal = document.getElementById('modalPreviewFoto');
    if (modal) modal.style.display = 'none';
  });

  window.alterarStatusMotorista = async (motoristaId, acao) => {
    if (!confirm(`Confirma ${acao === 'aprovar' ? 'aprovação' : 'suspensão'} deste motorista?`)) return;
    try {
      const resp = await fetch(`${API_URL}/api/admin/motoristas/${motoristaId}/triagem`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ acao })
      });
      if (!resp.ok) throw new Error();
      alert('Status atualizado com sucesso!');
      carregarFrota();
    } catch (e) {
      alert('Erro ao alterar status.');
    }
  };

  // 5. EXPORTAÇÃO CSV
  document.getElementById('btnExportarCsv')?.addEventListener('click', () => {
    fetch(`${API_URL}/api/admin/relatorios/corridas.csv`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Falha ao gerar CSV');
        return res.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `huby-relatorio-${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(err => alert(err.message));
  });

  document.getElementById('btnSincronizar')?.addEventListener('click', carregarTudo);

  carregarTudo();
});