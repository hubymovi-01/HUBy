// js/app-admin.js - Orquestrador do Painel Administrativo HUBy
import { API_URL } from './config.js';
import { inicializarRadarMaster } from './admin-radar.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verificação de Acesso Admin
  const token = localStorage.getItem('huby_token');
  const role = String(localStorage.getItem('huby_user_role') || '').toLowerCase();

  if (!token || (role !== 'admin' && role !== 'administrador')) {
    alert('Acesso negado. Apenas administradores podem visualizar esta página.');
    window.location.replace('./index.html');
    return;
  }

  // 2. Navegação por Abas
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      const pane = document.getElementById(target);
      if (pane) pane.classList.add('active');
      
      // Inicializa o mapa apenas quando a aba Radar for aberta
      if (target === 'tabRadar') {
        inicializarRadarMaster(token);
      }
      
      // Força a atualização do tamanho e redesenho dos gráficos de métricas no mobile
      if (target === 'tabMetricas') {
        setTimeout(() => {
          if (window.chartFinInstance) window.chartFinInstance.update();
          if (window.chartCatInstance) window.chartCatInstance.update();
        }, 150);
      }
    });
  });

  // 3. Ouvintes de Ações do Cabeçalho e Formulários
  document.getElementById('btnSincronizar')?.addEventListener('click', sincronizarTudo);
  document.getElementById('selectFiltroPeriodo')?.addEventListener('change', carregarMetricasKPI);
  document.getElementById('btnBaixarCSV')?.addEventListener('click', exportarCsvCorridas);

  const formTarifas = document.getElementById('formConfiguracoes');
  if (formTarifas) formTarifas.addEventListener('submit', salvarTarifasServidor);

  const formMP = document.getElementById('formMercadoPagoConfig');
  if (formMP) formMP.addEventListener('submit', salvarConfigMercadoPago);

  // 4. Carregar Dados Iniciais
  await sincronizarTudo();
});

async function sincronizarTudo() {
  await Promise.all([
    carregarMetricasKPI(),
    carregarTarifasAtuais(),
    carregarTabelaCorridas(),
    carregarTabelaMotoristas(),
    carregarTabelaSaques(),
    carregarDadosSocios()
  ]);
}

// ============================================================================
// 1. MÉTRICAS, KPIS E GRÁFICOS (CHART.JS)
// ============================================================================
async function carregarMetricasKPI() {
  const token = localStorage.getItem('huby_token');
  const periodo = document.getElementById('selectFiltroPeriodo')?.value || 'total';

  try {
    const res = await fetch(`${API_URL}/api/admin/metricas?periodo=${periodo}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();

    // Atualiza os Cards Superiores (KPIs)
    const faturamentoBruto = Number(data.faturamentoBruto || 0);
    const lucroHuby = Number(data.lucroHuby || 0);
    const repasseMotoristas = Number(data.repasseMotoristas || 0);

    if (document.getElementById('metricBruto')) document.getElementById('metricBruto').textContent = `R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}`;
    if (document.getElementById('metricLiquido')) document.getElementById('metricLiquido').textContent = `R$ ${lucroHuby.toFixed(2).replace('.', ',')}`;
    if (document.getElementById('metricRepasse')) document.getElementById('metricRepasse').textContent = `R$ ${repasseMotoristas.toFixed(2).replace('.', ',')}`;
    if (document.getElementById('metricConcluidas')) document.getElementById('metricConcluidas').textContent = data.viagensConcluidas || 0;
    if (document.getElementById('metricAlertas')) document.getElementById('metricAlertas').textContent = data.alertasSeguranca || 0;

    // Atualiza os painéis dos sócios
    const saldoCadaSocio = (lucroHuby * 0.40); // 80% do lucro dividido por 2
    if (document.getElementById('socio1Saldo')) document.getElementById('socio1Saldo').textContent = `R$ ${saldoCadaSocio.toFixed(2).replace('.', ',')}`;
    if (document.getElementById('socio2Saldo')) document.getElementById('socio2Saldo').textContent = `R$ ${saldoCadaSocio.toFixed(2).replace('.', ',')}`;

    // Renderiza os Gráficos Visuais
    atualizarGraficos(data);

  } catch (e) {
    console.warn('Falha ao sincronizar KPIs:', e);
  }
}

function atualizarGraficos(data) {
  const ctxFin = document.getElementById('chartFinanceiro');
  const ctxCat = document.getElementById('chartCategorias');

  // Verifica se os elementos canvas existem e se a biblioteca Chart.js foi carregada
  if (!ctxFin || !ctxCat || typeof Chart === 'undefined') {
      console.warn("Elementos do gráfico ou biblioteca Chart.js não encontrados.");
      return;
  }

  // Destrói gráficos antigos se o usuário mudar o filtro de período
  if (window.chartFinInstance) window.chartFinInstance.destroy();
  if (window.chartCatInstance) window.chartCatInstance.destroy();

  // 1. Gráfico de Divisão de Receitas (Rosca)
  window.chartFinInstance = new Chart(ctxFin, {
    type: 'doughnut',
    data: {
      labels: ['Repasse Motoristas (85%)', 'Lucro HUBy (15%)'],
      datasets: [{
        data: [data.repasseMotoristas || 0, data.lucroHuby || 0],
        backgroundColor: ['#F59E0B', '#38BDF8'],
        borderWidth: 0,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94A3B8', font: { size: 11, family: 'system-ui' } } }
      },
      cutout: '70%'
    }
  });

  // 2. Gráfico de Fluxo Operacional por Categoria (Barras)
  const cat = data.distribuicao_categorias || { carro: 0, moto: 0, entrega: 0 };
  window.chartCatInstance = new Chart(ctxCat, {
    type: 'bar',
    data: {
      labels: ['🚗 Carro', '🏍️ Moto', '📦 Entrega'],
      datasets: [{
        label: 'Corridas Concluídas',
        data: [cat.carro || 0, cat.moto || 0, cat.entrega || 0],
        backgroundColor: ['#10B981', '#38BDF8', '#A855F7'],
        borderRadius: 6,
        barThickness: 30
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { 
          beginAtZero: true, 
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          ticks: { color: '#94A3B8', stepSize: 1, font: { size: 11 } }
        },
        x: { 
          grid: { display: false }, 
          ticks: { color: '#94A3B8', font: { size: 12, weight: 'bold' } } 
        }
      }
    }
  });
}

// ============================================================================
// 2. CARREGAMENTO DE TARIFAS E ATUALIZAÇÃO NO BANCO (PUT)
// ============================================================================
async function carregarTarifasAtuais() {
  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas`);
    if (!res.ok) return;
    const tarifas = await res.json();

    if (tarifas.taxa_plataforma && document.getElementById('cfgTaxaPlataforma')) {
      document.getElementById('cfgTaxaPlataforma').value = tarifas.taxa_plataforma;
    }

    if (tarifas.carro) {
      if (document.getElementById('tarifaCarroBase')) document.getElementById('tarifaCarroBase').value = tarifas.carro.base ?? 1.0;
      if (document.getElementById('tarifaCarroKm')) document.getElementById('tarifaCarroKm').value = tarifas.carro.km ?? 0.0;
      if (document.getElementById('tarifaCarroMin')) document.getElementById('tarifaCarroMin').value = tarifas.carro.min ?? 1.0;
    }
    if (tarifas.moto) {
      if (document.getElementById('tarifaMotoBase')) document.getElementById('tarifaMotoBase').value = tarifas.moto.base ?? 1.0;
      if (document.getElementById('tarifaMotoKm')) document.getElementById('tarifaMotoKm').value = tarifas.moto.km ?? 0.0;
      if (document.getElementById('tarifaMotoMin')) document.getElementById('tarifaMotoMin').value = tarifas.moto.min ?? 1.0;
    }
    const entrega = tarifas.entrega || tarifas.flash;
    if (entrega) {
      if (document.getElementById('tarifaFlashBase')) document.getElementById('tarifaFlashBase').value = entrega.base ?? 1.0;
      if (document.getElementById('tarifaFlashKm')) document.getElementById('tarifaFlashKm').value = entrega.km ?? 0.0;
      if (document.getElementById('tarifaFlashMin')) document.getElementById('tarifaFlashMin').value = entrega.min ?? 1.0;
    }
  } catch (err) {
    console.warn('Falha ao carregar tarifas atuais:', err);
  }
}

async function salvarTarifasServidor(e) {
  if (e) e.preventDefault();
  const token = localStorage.getItem('huby_token');

  const tarifasPayload = {
    taxa_plataforma: Number(document.getElementById('cfgTaxaPlataforma')?.value) || 15,
    carro: {
      base: parseFloat(document.getElementById('tarifaCarroBase')?.value || '1.0'),
      km: parseFloat(document.getElementById('tarifaCarroKm')?.value || '0.0'),
      min: parseFloat(document.getElementById('tarifaCarroMin')?.value || '1.0')
    },
    moto: {
      base: parseFloat(document.getElementById('tarifaMotoBase')?.value || '1.0'),
      km: parseFloat(document.getElementById('tarifaMotoKm')?.value || '0.0'),
      min: parseFloat(document.getElementById('tarifaMotoMin')?.value || '1.0')
    },
    entrega: {
      base: parseFloat(document.getElementById('tarifaFlashBase')?.value || '1.0'),
      km: parseFloat(document.getElementById('tarifaFlashKm')?.value || '0.0'),
      min: parseFloat(document.getElementById('tarifaFlashMin')?.value || '1.0')
    }
  };

  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(tarifasPayload)
    });
    
    // Tratamento de erro melhorado
    if (!res.ok) {
        let errorMessage = 'Falha ao gravar tarifas no Neon.';
        try {
            const data = await res.json();
            errorMessage = data.erro || errorMessage;
        } catch (jsonErr) {
             console.error("Erro ao analisar resposta de erro JSON", jsonErr);
        }
        throw new Error(errorMessage);
    }
    
    alert('✅ Tarifas calibradas com sucesso!');
  } catch (err) {
    alert(`Erro ao salvar tarifas: ${err.message}`);
  }
}

// ============================================================================
// 3. CONFIGURAÇÕES DO MERCADO PAGO VIA PAINEL
// ============================================================================
async function salvarConfigMercadoPago(e) {
  if (e) e.preventDefault();
  const token = localStorage.getItem('huby_token');

  const body = {
    access_token: document.getElementById('mpAccessToken')?.value?.trim(),
    public_key: document.getElementById('mpPublicKey')?.value?.trim(),
    taxa_percentual: parseFloat(document.getElementById('mpTaxaPercentual')?.value || '0.99')
  };

  if (!body.access_token) {
    alert('Informe o Access Token de produção do Mercado Pago.');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/admin/gateway/mercadopago`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
    
     if (!res.ok) {
        let errorMessage = 'Falha ao atualizar chaves.';
        try {
            const data = await res.json();
            errorMessage = data.erro || errorMessage;
        } catch (jsonErr) {
             console.error("Erro ao analisar resposta de erro JSON", jsonErr);
        }
        throw new Error(errorMessage);
    }
    
    alert('✅ Credenciais do Mercado Pago salvas com sucesso no banco!');
  } catch (err) {
    alert(`Erro ao salvar Mercado Pago: ${err.message}`);
  }
}

// ============================================================================
// 4. TABELA DE CORRIDAS
// ============================================================================
async function carregarTabelaCorridas() {
  const token = localStorage.getItem('huby_token');
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Falha na resposta');
    const corridas = await res.json();

    if (!corridas || corridas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row">Nenhuma viagem encontrada.</td></tr>`;
      return;
    }

    tbody.innerHTML = corridas.map(c => `
      <tr>
        <td><strong>#${c.id}</strong></td>
        <td><span class="badge badge-aceito">${(c.sub_tipo_label || c.tipo || 'CARRO').toUpperCase()}</span></td>
        <td>${Number(c.distancia_km || 0).toFixed(1)} km</td>
        <td><strong class="text-primary">R$ ${Number(c.valor_total || c.valor || 0).toFixed(2).replace('.', ',')}</strong></td>
        <td class="text-blue">R$ ${(Number(c.valor_total || c.valor || 0) * 0.15).toFixed(2).replace('.', ',')}</td>
        <td>${c.motorista_nome || '<span style="color: var(--muted);">Aguardando...</span>'}</td>
        <td><span class="badge badge-${obterBadgeStatus(c.status)}">${c.status}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row" style="color:var(--rose);">Erro ao carregar viagens.</td></tr>`;
  }
}

// ============================================================================
// 5. TABELA DE MOTORISTAS
// ============================================================================
async function carregarTabelaMotoristas() {
  const token = localStorage.getItem('huby_token');
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Falha na resposta');
    const motoristas = await res.json();

    if (!motoristas || motoristas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>`;
      return;
    }

    tbody.innerHTML = motoristas.map(m => `
      <tr>
        <td><strong>${m.nome}</strong><br><small style="color: var(--muted);">${m.telefone || m.email || ''}</small></td>
        <td>${m.veiculo_modelo || m.veiculo || '--'}<br><span style="font-family:monospace; font-weight:800;" class="text-blue">${m.veiculo_placa || m.placa || ''}</span></td>
        <td>${(m.categoria_veiculo || 'Carro').toUpperCase()}</td>
        <td class="text-primary" style="font-weight:800;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</td>
        <td><span class="badge badge-${m.status_aprovacao === 'aprovado' ? 'aprovado' : 'pendente'}">${m.status_aprovacao || 'Pendente'}</span></td>
        <td>
          <button type="button" class="btn-tbl alt" onclick="verDocumentos('${m.doc_cnh_url || ''}', '${m.doc_crlv_url || ''}')">Ver Docs</button>
        </td>
        <td>
          ${m.status_aprovacao !== 'aprovado'
            ? `<button type="button" class="btn-tbl app" onclick="alterarStatusMotorista(${m.id}, 'aprovar')">Aprovar</button>`
            : `<button type="button" class="btn-tbl rej" onclick="alterarStatusMotorista(${m.id}, 'recusar')">Suspender</button>`
          }
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty-row" style="color:var(--rose);">Erro ao carregar motoristas.</td></tr>`;
  }
}

// ============================================================================
// 6. EXTRATO DE SAQUES
// ============================================================================
async function carregarTabelaSaques() {
  const token = localStorage.getItem('huby_token');
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/saques`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const saques = await res.json();

    if (!saques || saques.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty-row">Nenhum registro de repasse.</td></tr>`;
      return;
    }

    tbody.innerHTML = saques.map(s => `
      <tr>
        <td><strong>#${s.id}</strong></td>
        <td>${s.motorista_nome || `Motorista #${s.motorista_id}`}</td>
        <td style="font-family: monospace;">${s.chave_pix}</td>
        <td><strong class="text-amber">R$ ${Number(s.valor || 0).toFixed(2).replace('.', ',')}</strong></td>
        <td><span class="badge badge-${s.status === 'pago' ? 'pago' : (s.status === 'processando' ? 'aceito' : 'pendente')}">${s.status}</span></td>
        <td>${s.criado_em ? new Date(s.criado_em).toLocaleString('pt-BR') : '--'}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.warn('Falha ao carregar extrato de saques:', e);
  }
}

// ============================================================================
// 7. GESTÃO DOS SÓCIOS (50% / 50%) - HUBy Diretoria
// ============================================================================
function carregarDadosSocios() {
  // Define valores iniciais caso o localStorage esteja vazio
  const s1Nome = localStorage.getItem('huby_socio_1_nome') || 'Sócio 1 (50%)';
  const s1Pix = localStorage.getItem('huby_socio_1_pix') || 'pix1@huby.app.br';
  const s2Nome = localStorage.getItem('huby_socio_2_nome') || 'Sócio 2 (50%)';
  const s2Pix = localStorage.getItem('huby_socio_2_pix') || 'pix2@huby.app.br';

  if (document.getElementById('socio1Nome')) document.getElementById('socio1Nome').textContent = s1Nome;
  if (document.getElementById('socio1Chave')) document.getElementById('socio1Chave').textContent = `Chave Pix: ${s1Pix}`;
  if (document.getElementById('socio2Nome')) document.getElementById('socio2Nome').textContent = s2Nome;
  if (document.getElementById('socio2Chave')) document.getElementById('socio2Chave').textContent = `Chave Pix: ${s2Pix}`;
}

// Expõe a função globalmente sem causar erro no parsing
window.editarDadosSocio = function(numSocio) {
  const elemNome = document.getElementById(`socio${numSocio}Nome`);
  const elemChave = document.getElementById(`socio${numSocio}Chave`);

  const nomeAtual = elemNome ? elemNome.textContent : `Sócio ${numSocio} (50%)`;
  const chaveAtual = elemChave ? elemChave.textContent.replace('Chave Pix: ', '').trim() : `pix${numSocio}@huby.app.br`;

  // Utiliza prompt simples, que não causará JSON parse error se não houver requisição subsequente
  const novoNome = prompt(`Nome para exibição do Sócio ${numSocio}:`, nomeAtual);
  if (novoNome === null || novoNome.trim() === '') return;

  const novaChave = prompt(`Chave Pix oficial de destino para ${novoNome}:`, chaveAtual);
  if (novaChave === null || novaChave.trim() === '') return;

  // Guarda no LocalStorage e atualiza a UI
  localStorage.setItem(`huby_socio_${numSocio}_nome`, novoNome.trim());
  localStorage.setItem(`huby_socio_${numSocio}_pix`, novaChave.trim());

  if (elemNome) elemNome.textContent = novoNome.trim();
  if (elemChave) elemChave.textContent = `Chave Pix: ${novaChave.trim()}`;

  alert(`✅ Dados do Sócio ${numSocio} salvos com sucesso!`);
};

window.solicitarSaqueSocio = async function(numSocio) {
  const token = localStorage.getItem('huby_token');
  const nome = document.getElementById(`socio${numSocio}Nome`)?.textContent || `Sócio ${numSocio}`;
  const chavePix = document.getElementById(`socio${numSocio}Chave`)?.textContent.replace('Chave Pix: ', '').trim();
  const saldoTxt = document.getElementById(`socio${numSocio}Saldo`)?.textContent || 'R$ 0,00';

  const valorStr = prompt(`Retirada de lucros para ${nome}\nChave Pix: ${chavePix}\nSaldo Disponível: ${saldoTxt}\n\nInforme o valor do repasse (R$):`, '1.00');
  if (!valorStr) return;

  const valor = parseFloat(valorStr.replace(',', '.'));
  if (isNaN(valor) || valor <= 0) {
    alert('⚠️ Informe um valor numérico válido.');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/admin/saques/automatico`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ valor, chavePix, tipoChave: 'chave' })
    });
    
     if (!res.ok) {
        let errorMessage = 'Falha ao processar saque do sócio.';
        try {
            const data = await res.json();
            errorMessage = data.erro || errorMessage;
        } catch (jsonErr) {
             console.error("Erro ao analisar resposta de erro JSON", jsonErr);
        }
        throw new Error(errorMessage);
    }

    alert(`✅ Saque de R$ ${valor.toFixed(2)} transferido com sucesso para ${nome}!`);
    await sincronizarTudo();
  } catch (err) {
    console.error(err);
    alert(`❌ Erro no saque: ${err.message}`);
  }
};

// ============================================================================
// 8. FUNÇÕES AUXILIARES
// ============================================================================
function obterBadgeStatus(status) {
  const st = String(status).toLowerCase();
  if (st === 'concluido' || st === 'pago' || st === 'finalizado') return 'concluido';
  if (st === 'em_viagem' || st === 'a_caminho' || st === 'aceito') return 'aceito';
  if (st === 'cancelado' || st === 'recusado') return 'recusado';
  return 'pendente';
}

function exportarCsvCorridas() {
  const token = localStorage.getItem('huby_token');
  window.open(`${API_URL}/api/admin/relatorios/corridas.csv?token=${token}`, '_blank');
}

window.alterarStatusMotorista = async function(id, acao) {
  const token = localStorage.getItem('huby_token');
  if (!confirm(`Confirma ${acao} este condutor?`)) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ acao })
    });
    if (!res.ok) throw new Error('Falha na requisição.');
    alert('Status atualizado!');
    carregarTabelaMotoristas();
  } catch (e) {
    alert(e.message);
  }
};

window.verDocumentos = function(cnh, crlv) {
  const url = cnh || crlv;
  if (!url) {
    alert('Este condutor não enviou anexos legíveis.');
    return;
  }
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