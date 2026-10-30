// js/admin.js - Orquestrador Geral do Painel Master
import { API_URL } from './config.js';
import { inicializarRadarMaster, atualizarPosicaoCondutorNoMapa } from './admin-radar.js';

let chartFinanceiroInstance = null;
let chartCategoriasInstance = null;
const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || (role !== 'admin' && role !== 'administrador')) {
    alert('Acesso restrito ao Painel Administrativo Master.');
    window.location.replace('./login.html');
    return;
  }

  // 1. Inicializa o Radar no Mapa (Leaflet)
  inicializarRadarMaster(token);

  // 2. Conecta ao Socket.IO para Telemetria em Tempo Real e Alertas
  conectarSocketAdmin();

  // 3. Controle de Troca de Abas
  configurarNavegacaoAbas();

  // 4. Carregamento Inicial de Dados
  await sincronizarTudo(token);

  // 5. Handlers de Formulários
  configurarFormCupons(token);
  configurarFormBroadcast(token);
  configurarFormTarifas(token);
  configurarModalDocumentos();

  // 6. Botões Globais do Topo
  document.getElementById('btnSincronizar')?.addEventListener('click', () => sincronizarTudo(token));
  document.getElementById('btnBaixarCSV')?.addEventListener('click', exportarRelatorioCSV);
});

// ============================================================================
// CARREGAMENTO E SINCRONIZAÇÃO GERAL
// ============================================================================
async function sincronizarTudo(token) {
  await Promise.all([
    carregarMetricasECards(token),
    carregarTabelaCupons(token),
    carregarTabelaSeguranca(token),
    carregarTabelaSaques(token),
    carregarTabelaFrota(token),
    carregarTabelaViagens(token),
    carregarTarifasConfig(token)
  ]);
}

// 1. Métricas e Gráficos
async function carregarMetricasECards(token) {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const m = await res.json();

    const faturamentoBruto = Number(m.faturamento_bruto || (m.receita_huby_hoje ? m.receita_huby_hoje / 0.15 : 0));
    const lucroLiquido = Number(m.receita_huby_hoje || (faturamentoBruto * 0.15));
    const repasseMotoristas = Math.max(0, faturamentoBruto - lucroLiquido);

    document.getElementById('metricBruto').textContent = `R$ ${faturamentoBruto.toFixed(2).replace('.', ',')}`;
    document.getElementById('metricLiquido').textContent = `R$ ${lucroLiquido.toFixed(2).replace('.', ',')}`;
    document.getElementById('metricRepasse').textContent = `R$ ${repasseMotoristas.toFixed(2).replace('.', ',')}`;
    document.getElementById('metricConcluidas').textContent = m.viagens_concluidas || m.corridas_ativas || 0;
    document.getElementById('metricAlertas').textContent = m.incidentes_ativos || 0;

    renderizarGraficos(faturamentoBruto, lucroLiquido, repasseMotoristas, m.distribuicao_categorias || {});
  } catch (err) {
    console.warn('Erro ao ler KPIs:', err);
  }
}

function renderizarGraficos(bruto, lucro, repasse, categorias) {
  // Gráfico Financeiro (Doughnut)
  const ctxFin = document.getElementById('chartFinanceiro')?.getContext('2d');
  if (ctxFin) {
    if (chartFinanceiroInstance) chartFinanceiroInstance.destroy();
    chartFinanceiroInstance = new Chart(ctxFin, {
      type: 'doughnut',
      data: {
        labels: ['Repasse Condutores (85%)', 'Taxa HUBy (15%)'],
        datasets: [{
          data: [repasse || 85, lucro || 15],
          backgroundColor: ['#F59E0B', '#38BDF8'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#94A3B8' } } }
      }
    });
  }

  // Gráfico de Categorias (Bar)
  const ctxCat = document.getElementById('chartCategorias')?.getContext('2d');
  if (ctxCat) {
    if (chartCategoriasInstance) chartCategoriasInstance.destroy();
    chartCategoriasInstance = new Chart(ctxCat, {
      type: 'bar',
      data: {
        labels: ['HUBy Carro', 'HUBy Moto', 'HUBy Entrega'],
        datasets: [{
          label: 'Viagens',
          data: [categorias.carro || 12, categorias.moto || 8, categorias.entrega || 4],
          backgroundColor: ['#10B981', '#F59E0B', '#A855F7'],
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#94A3B8' }, grid: { display: false } },
          y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  }
}

// 2. Cupons de Desconto
async function carregarTabelaCupons(token) {
  const tbody = document.getElementById('tabelaCuponsBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/cupons`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Nenhum cupom ativo registrado.</td></tr>';
      return;
    }
    const cupons = await res.json();
    if (!cupons.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Nenhum cupom cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = cupons.map(c => `
      <tr>
        <td><strong>${c.codigo}</strong></td>
        <td>${c.tipo === 'porcentagem' ? `${c.valor}%` : `R$ ${Number(c.valor).toFixed(2).replace('.', ',')}`}</td>
        <td>${c.usos_atuais || 0} / ${c.limite_usos || '∞'}</td>
        <td><span class="badge ${c.ativo ? 'badge-ativo' : 'badge-inativo'}">${c.ativo ? 'Ativo' : 'Pausado'}</span></td>
        <td>
          <button class="btn-tbl alt" onclick="alternarCupom('${c.id}')">${c.ativo ? 'Pausar' : 'Ativar'}</button>
          <button class="btn-tbl rej" onclick="excluirCupom('${c.id}')">Excluir</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--rose);">Erro ao ler cupons.</td></tr>';
  }
}

// 3. Incidentes e SOS
async function carregarTabelaSeguranca(token) {
  const tbody = document.getElementById('tabelaSegurancaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/incidentes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const incidentes = await res.json();

    if (!incidentes.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--muted);">Sem incidentes pendentes. Frota segura!</td></tr>';
      return;
    }

    tbody.innerHTML = incidentes.map(i => `
      <tr>
        <td>#${String(i.id).slice(-4)}</td>
        <td><span class="badge ${i.tipo === 'sos' ? 'badge-sos' : 'badge-pendente'}">${i.tipo.toUpperCase()}</span></td>
        <td>${i.descricao || 'Alerta disparado na corrida'}</td>
        <td>${new Date(i.criado_em).toLocaleString('pt-BR')}</td>
        <td><span class="badge ${i.resolvido ? 'badge-concluido' : 'badge-pendente'}">${i.resolvido ? 'Resolvido' : 'Pendente'}</span></td>
        <td>
          ${!i.resolvido ? `<button class="btn-tbl app" onclick="resolverIncidente(${i.id})">Resolver</button>` : '---'}
        </td>
      </tr>
    `).join('');
  } catch (e) {}
}

// 4. Moderação de Saques Pix
async function carregarTabelaSaques(token) {
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/saques`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const saques = await res.json();

    if (!saques.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--muted);">Nenhum pedido de saque registrado.</td></tr>';
      return;
    }

    tbody.innerHTML = saques.map(s => {
      const badgeClass = s.status === 'pago' ? 'badge-pago' : (s.status === 'recusado' ? 'badge-recusado' : 'badge-pendente');
      return `
        <tr>
          <td>#${s.id}</td>
          <td><strong>${s.motorista_nome || 'Condutor'}</strong><br><small style="color:var(--muted);">${s.motorista_telefone || ''}</small></td>
          <td><code>${s.chave_pix}</code> (${s.tipo_chave})</td>
          <td style="font-weight: 800; color: #FFF;">R$ ${Number(s.valor).toFixed(2).replace('.', ',')}</td>
          <td><span class="badge ${badgeClass}">${s.status.toUpperCase()}</span></td>
          <td>
            ${s.status === 'pendente' ? `
              <button class="btn-tbl app" onclick="processarSaqueMaster(${s.id}, 'pago')">Pagar Pix</button>
              <button class="btn-tbl rej" onclick="processarSaqueMaster(${s.id}, 'recusado')">Recusar</button>
            ` : '---'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {}
}

// 5. Gestão de Frota e Documentos
async function carregarTabelaFrota(token) {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const motoristas = await res.json();

    if (!motoristas.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--muted);">Nenhum parceiro cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = motoristas.map(m => {
      const badgeStatus = {
        aprovado: 'badge-aprovado',
        pendente: 'badge-pendente',
        bloqueado: 'badge-recusado'
      }[m.status_aprovacao] || 'badge-pendente';

      return `
        <tr>
          <td>
            <strong>${m.nome}</strong><br>
            <small style="color:var(--muted);">CNH: ${m.cnh || '---'}</small>
          </td>
          <td>
            ${m.veiculo_modelo || 'Não inf.'}<br>
            <small style="color:var(--blue); font-weight:700;">${(m.veiculo_placa || 'SEM PLACA').toUpperCase()}</small>
          </td>
          <td><span class="badge badge-aceito">${(m.categoria || 'carro').toUpperCase()}</span></td>
          <td style="color:var(--primary); font-weight:800;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</td>
          <td><span class="badge ${badgeStatus}">${m.status_aprovacao.toUpperCase()}</span></td>
          <td>
            ${m.foto_perfil_url ? `
              <button class="btn-tbl alt" onclick="abrirFotoDocumento('${m.foto_perfil_url}')">Ver Foto</button>
            ` : '<small style="color:var(--muted);">Sem foto</small>'}
          </td>
          <td>
            <div style="display:flex; gap:4px;">
              ${m.status_aprovacao !== 'aprovado' ? `
                <button class="btn-tbl app" onclick="alterarStatusCondutor('${m.id}', 'aprovado')">Aprovar</button>
              ` : ''}
              ${m.status_aprovacao !== 'bloqueado' ? `
                <button class="btn-tbl rej" onclick="alterarStatusCondutor('${m.id}', 'bloqueado')">Bloquear</button>
              ` : `
                <button class="btn-tbl app" onclick="alterarStatusCondutor('${m.id}', 'aprovado')">Liberar</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {}
}

// 6. Monitor de Viagens em Tempo Real
async function carregarTabelaViagens(token) {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/historico`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const corridas = await res.json();

    if (!corridas.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--muted);">Nenhuma corrida realizada.</td></tr>';
      return;
    }

    tbody.innerHTML = corridas.slice(0, 15).map(c => {
      const taxa = Number(c.valor_total) * 0.15;
      return `
        <tr>
          <td>#${String(c.id).slice(-4)}</td>
          <td>${c.sub_tipo_label || 'HUBy'}</td>
          <td>${c.distancia_km} km</td>
          <td style="font-weight:800; color:#FFF;">R$ ${Number(c.valor_total).toFixed(2).replace('.', ',')}</td>
          <td style="color:var(--blue); font-weight:700;">R$ ${taxa.toFixed(2).replace('.', ',')}</td>
          <td>${c.motorista_nome || 'Buscando...'}</td>
          <td><span class="badge ${c.status === 'concluido' ? 'badge-concluido' : (c.status === 'cancelado' ? 'badge-recusado' : 'badge-aceito')}">${c.status.toUpperCase()}</span></td>
        </tr>
      `;
    }).join('');
  } catch (e) {}
}

// 7. Tarifas e Configurações
async function carregarTarifasConfig(token) {
  try {
    const res = await fetch(`${API_URL}/api/config`);
    if (!res.ok) return;
    const cfg = await res.json();

    if (cfg.taxa_plataforma) document.getElementById('cfgTaxaPlataforma').value = cfg.taxa_plataforma;
    if (cfg.km_carro) document.getElementById('cfgKmCarro').value = cfg.km_carro;
    if (cfg.km_moto) document.getElementById('cfgKmMoto').value = cfg.km_moto;
    if (cfg.km_entrega) document.getElementById('cfgKmEntrega').value = cfg.km_entrega;
  } catch (e) {}
}

// ============================================================================
// FORMULÁRIOS E AÇÕES ADMINISTRATIVAS
// ============================================================================
function configurarFormCupons(token) {
  document.getElementById('formNovoCupom')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = document.getElementById('cupomCodigo').value.trim().toUpperCase();
    const tipo = document.getElementById('cupomTipo').value;
    const valor = parseFloat(document.getElementById('cupomValor').value);
    const limite_usos = parseInt(document.getElementById('cupomLimite').value, 10);
    const expira_em = document.getElementById('cupomExpira').value || null;

    try {
      const res = await fetch(`${API_URL}/api/admin/cupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ codigo, tipo, valor, limite_usos, expira_em })
      });
      if (res.ok) {
        alert('Cupom cadastrado com sucesso!');
        e.target.reset();
        carregarTabelaCupons(token);
      } else {
        const d = await res.json();
        alert(`Erro: ${d.erro || 'Falha ao salvar cupom'}`);
      }
    } catch (err) {
      alert('Falha de conexão.');
    }
  });
}

function configurarFormBroadcast(token) {
  document.getElementById('formBroadcast')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const publico = document.getElementById('broadPublico').value;
    const titulo = document.getElementById('broadTitulo').value.trim();
    const mensagem = document.getElementById('broadMensagem').value.trim();

    try {
      const res = await fetch(`${API_URL}/api/admin/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ publico, titulo, mensagem })
      });
      if (res.ok) {
        alert('📢 Notificação transmitida com sucesso para os usuários conectados!');
        e.target.reset();
      } else {
        alert('Erro ao enviar notificação.');
      }
    } catch (err) {
      alert('Falha de rede.');
    }
  });
}

function configurarFormTarifas(token) {
  document.getElementById('formConfiguracoes')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taxa_plataforma = Number(document.getElementById('cfgTaxaPlataforma').value);
    const km_carro = Number(document.getElementById('cfgKmCarro').value);
    const km_moto = Number(document.getElementById('cfgKmMoto').value);
    const km_entrega = Number(document.getElementById('cfgKmEntrega').value);

    try {
      const res = await fetch(`${API_URL}/api/admin/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ taxa_plataforma, km_carro, km_moto, km_entrega })
      });
      if (res.ok) {
        alert('Parâmetros e tarifas atualizados com sucesso!');
      } else {
        alert('Erro ao atualizar tarifas.');
      }
    } catch (err) {
      alert('Falha ao comunicar com o servidor.');
    }
  });
}

// Modal de visualização de fotos
function configurarModalDocumentos() {
  const modal = document.getElementById('modalPreviewFoto');
  const btnFechar = document.getElementById('btnFecharModalPreview');

  window.abrirFotoDocumento = (url) => {
    const img = document.getElementById('imgPreviewVeiculo');
    if (img && modal) {
      img.src = url;
      modal.style.display = 'flex';
    }
  };

  btnFechar?.addEventListener('click', () => {
    if (modal) modal.style.display = 'none';
  });
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

// Navegação das abas
function configurarNavegacaoAbas() {
  const botoes = document.querySelectorAll('.tab-btn');
  const paineis = document.querySelectorAll('.tab-pane');

  botoes.forEach(btn => {
    btn.addEventListener('click', () => {
      botoes.forEach(b => b.classList.remove('active'));
      paineis.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabAlvo = document.getElementById(btn.getAttribute('data-tab'));
      if (tabAlvo) tabAlvo.classList.add('active');
    });
  });
}

// Conexão em tempo real do Admin
function conectarSocketAdmin() {
  const ioClient = getSocketIO();
  if (!ioClient) return;

  const socket = ioClient(API_URL);
  socket.on('posicao_motorista', (dados) => {
    atualizarPosicaoCondutorNoMapa(dados);
  });

  socket.on('alerta_sos', (dados) => {
    alert(`🚨 ALERTA SOS EM TEMPO REAL!\n\nViagem: #${dados.pedidoId}\nDescrição: ${dados.relato || 'Emergência reportada!'}`);
    const token = localStorage.getItem('huby_token');
    carregarTabelaSeguranca(token);
    carregarMetricasECards(token);
  });
}

// ============================================================================
// AÇÕES INLINE GLOBAIS (WINDOW)
// ============================================================================
window.alterarStatusCondutor = async (id, status) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      await carregarTabelaFrota(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {
    alert('Erro ao alterar status do parceiro.');
  }
};

window.processarSaqueMaster = async (id, acao) => {
  const token = localStorage.getItem('huby_token');
  if (!confirm(`Deseja marcar este saque como ${acao.toUpperCase()}?`)) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/saques/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao })
    });
    if (res.ok) {
      await carregarTabelaSaques(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {
    alert('Erro ao processar saque.');
  }
};

window.resolverIncidente = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/incidentes/${id}/resolver`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      await carregarTabelaSeguranca(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {
    alert('Erro ao resolver incidente.');
  }
};

function exportarRelatorioCSV() {
  const linhas = [
    ['ID', 'Data', 'Tipo', 'Distancia_KM', 'Valor_Total', 'Status']
  ];
  const trs = document.querySelectorAll('#tabelaCorridasBody tr');
  trs.forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\n/g, ' ').trim());
    if (tds.length >= 6) linhas.push(tds);
  });

  const conteudoCSV = 'data:text/csv;charset=utf-8,' + linhas.map(e => e.join(';')).join('\n');
  const encodedUri = encodeURI(conteudoCSV);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `huby_relatorio_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}