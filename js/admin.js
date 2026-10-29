import { API_URL } from './config.js';
import { inicializarRadarMaster, carregarZonasDinamicas, atualizarPosicaoCondutorNoMapa } from './admin-radar.js';

// ==========================================
// 1. SEGURANÇA E ACESSO
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
    console.warn('Erro na validação do token:', e);
  }
}

if (!token || (role !== 'admin' && role !== 'administrador')) {
  window.location.replace('./welcome.html');
}

// ==========================================
// 2. SOCKET.IO PARA ALERTAS E RADAR DINÂMICO
// ==========================================
let socket = null;
try {
  socket = io(API_URL);
  socket.on('connect', () => console.log('Admin Master conectado ao Socket.IO'));
  
  socket.on('alerta_sos_admin', (dados) => {
    alert(`🚨 ALERTA SOS CRÍTICO!\nChamada: #${dados.pedidoId}\nO passageiro/motorista acionou socorro imediato!`);
    carregarSeguranca();
  });

  socket.on('alerta_seguranca_admin', () => {
    carregarSeguranca();
  });

  // Atualiza a posição do condutor através do módulo admin-radar.js
  socket.on('posicao_motorista', (dados) => {
    atualizarPosicaoCondutorNoMapa(dados);
  });
} catch(err) {
  console.warn('Socket indisponível:', err);
}

// ==========================================
// 3. NAVEGAÇÃO POR ABAS
// ==========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    
    btn.classList.add('active');
    const pane = document.getElementById(btn.dataset.tab);
    if (pane) pane.classList.add('active');

    if (btn.dataset.tab === 'tabMetricas') carregarMetricas();
    if (btn.dataset.tab === 'tabRadar') inicializarRadarMaster(token);
    if (btn.dataset.tab === 'tabCupons') carregarCupons();
    if (btn.dataset.tab === 'tabSeguranca') carregarSeguranca();
  });
});

const fMoeda = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(val) || 0);

let chartFin = null;
let chartCat = null;

// ==========================================
// 4. CARREGAR MÉTRICAS E GRÁFICOS
// ==========================================
async function carregarMetricas() {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) throw new Error('Falha ao obter dados.');
    const dados = await res.json();

    const bruto = Number(dados.financeiro?.faturamento_total ?? dados.faturamentoBruto ?? 0);
    const repasse = Number(dados.financeiro?.total_pago_motoristas ?? dados.repasseMotoristas ?? 0);
    const liquido = Number(dados.financeiro?.lucro_plataforma ?? dados.receitaPlataforma ?? 0);
    const pedidos = dados.pedidos || { pendentes: dados.chamadasEmAberto || 0, concluidos: dados.totalCorridas || 0, cancelados: 0 };

    document.getElementById('metricBruto').textContent = fMoeda(bruto);
    document.getElementById('metricLiquido').textContent = fMoeda(liquido);
    document.getElementById('metricRepasse').textContent = fMoeda(repasse);
    document.getElementById('metricConcluidas').textContent = pedidos.concluidos || 0;

    renderizarGraficos(bruto, liquido, repasse, pedidos);
  } catch (err) {
    console.error("Erro nas métricas:", err);
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
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#FFF' } } } }
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
// 5. CUPONS DE DESCONTO & MARKETING
// ==========================================
async function carregarCupons() {
  const tbody = document.getElementById('tabelaCuponsBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/cupons`, { headers: { 'Authorization': `Bearer ${token}` } });
    const cupons = await res.json();

    if (!cupons || cupons.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); padding:20px;">Nenhum cupom ativo no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = cupons.map(c => {
      const valTxt = c.tipo === 'porcentagem' ? `${c.valor}% OFF` : fMoeda(c.valor);
      const badgeCss = c.ativo ? 'badge-ativo' : 'badge-inativo';
      const statusTxt = c.ativo ? 'Ativo' : 'Pausado';

      return `<tr>
        <td><strong style="color:var(--blue); font-family:monospace; font-size:14px;">${c.codigo}</strong></td>
        <td><strong style="color:var(--primary);">${valTxt}</strong></td>
        <td>${c.usos_atuais || 0} / ${c.limite_usos || '∞'}</td>
        <td><span class="badge ${badgeCss}">${statusTxt}</span></td>
        <td>
          <button class="btn-tbl alt" onclick="toggleCupom(${c.id})">${c.ativo ? 'Pausar' : 'Ativar'}</button>
          <button class="btn-tbl rej" onclick="excluirCupom(${c.id})" style="margin-left:4px;">✕</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--rose);">Erro ao consultar cupons.</td></tr>';
  }
}

document.getElementById('formNovoCupom')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = document.getElementById('cupomCodigo').value;
  const tipo = document.getElementById('cupomTipo').value;
  const valor = document.getElementById('cupomValor').value;
  const limite_usos = document.getElementById('cupomLimite').value;
  const expira_em = document.getElementById('cupomExpira').value || null;

  try {
    const res = await fetch(`${API_URL}/api/admin/cupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ codigo, tipo, valor, limite_usos, expira_em })
    });
    if (res.ok) {
      alert('Cupom criado com sucesso!');
      e.target.reset();
      carregarCupons();
    } else {
      const err = await res.json();
      alert(`Erro: ${err.erro}`);
    }
  } catch (e) {
    alert('Erro de conexão ao salvar cupom.');
  }
});

window.toggleCupom = async (id) => {
  try {
    await fetch(`${API_URL}/api/admin/cupons/${id}/toggle`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    carregarCupons();
  } catch (e) { alert('Erro ao alterar cupom.'); }
};

window.excluirCupom = async (id) => {
  if (!confirm('Deseja realmente eliminar este cupom?')) return;
  try {
    await fetch(`${API_URL}/api/admin/cupons/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    carregarCupons();
  } catch (e) { alert('Erro ao remover cupom.'); }
};

// ==========================================
// 6. CENTRAL DE SEGURANÇA E SOS
// ==========================================
async function carregarSeguranca() {
  const tbody = document.getElementById('tabelaSegurancaBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/incidentes`, { headers: { 'Authorization': `Bearer ${token}` } });
    const incidentes = await res.json();

    const pendentes = (incidentes || []).filter(i => !i.resolvido);
    document.getElementById('metricAlertas').textContent = pendentes.length;

    if (!incidentes || incidentes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:20px;">Nenhum alerta registrado.</td></tr>';
      return;
    }

    tbody.innerHTML = incidentes.map(inc => {
      const isSos = inc.tipo_alerta === 'sos';
      const badgeCls = inc.resolvido ? 'badge-concluido' : (isSos ? 'badge-sos' : 'badge-pendente');
      const dataFmt = new Date(inc.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      return `<tr>
        <td>#${inc.id}</td>
        <td><span class="badge ${badgeCls}">${inc.tipo_alerta.toUpperCase()}</span></td>
        <td><strong>${inc.descricao}</strong><br><small style="color:var(--muted)">Viagem: ${inc.pedido_id || 'N/A'}</small></td>
        <td>${dataFmt}</td>
        <td>${inc.resolvido ? 'Resolvido' : '<strong style="color:var(--rose);">Pendente</strong>'}</td>
        <td>
          ${!inc.resolvido ? `<button class="btn-tbl app" onclick="resolverIncidente(${inc.id})">Arquivar</button>` : '<small style="color:var(--muted);">OK</small>'}
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--rose);">Falha ao sincronizar alertas.</td></tr>';
  }
}

window.resolverIncidente = async (id) => {
  try {
    await fetch(`${API_URL}/api/admin/seguranca/incidentes/${id}/resolver`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
    carregarSeguranca();
  } catch (e) { alert('Erro ao arquivar alerta.'); }
};

// ==========================================
// 7. BROADCAST PUSH EM MASSA
// ==========================================
document.getElementById('formBroadcast')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const publico = document.getElementById('broadPublico').value;
  const titulo = document.getElementById('broadTitulo').value;
  const mensagem = document.getElementById('broadMensagem').value;

  try {
    const res = await fetch(`${API_URL}/api/admin/notificacoes/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ publico, titulo, mensagem })
    });
    if (res.ok) {
      alert('Mensagem enviada com sucesso para os utilizadores online!');
      e.target.reset();
    } else {
      alert('Erro ao disparar mensagem.');
    }
  } catch (err) {
    alert('Erro de conexão ao emitir broadcast.');
  }
});

// ==========================================
// 8. EXPORTAÇÃO CSV
// ==========================================
document.getElementById('btnBaixarCSV')?.addEventListener('click', () => {
  window.open(`${API_URL}/api/admin/relatorios/corridas.csv?token=${token}`, '_blank');
});

// ==========================================
// 9. SAQUES, CONDUTORES E TARIFAS
// ==========================================
async function carregarSaques() {
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/saques`, { headers: { 'Authorization': `Bearer ${token}` } });
    const saques = await res.json();
    if (!saques || saques.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--muted); padding:20px;">Nenhum saque solicitado.</td></tr>';
      return;
    }
    tbody.innerHTML = saques.map(s => `<tr>
      <td>#${s.id}</td>
      <td><strong>${s.motorista_nome}</strong></td>
      <td><span style="color:var(--blue); font-family:monospace;">${s.chave_pix}</span> (${s.tipo_chave})</td>
      <td style="color:var(--primary); font-weight:800;">${fMoeda(s.valor)}</td>
      <td><span class="badge ${s.status === 'pago' ? 'badge-pago' : 'badge-pendente'}">${s.status}</span></td>
      <td>${s.status === 'pendente' ? `<button class="btn-tbl app" onclick="aprovarSaque(${s.id})">Pagar</button><button class="btn-tbl rej" onclick="rejeitarSaque(${s.id})" style="margin-left:4px;">Recusar</button>` : '<small style="color:var(--muted);">Processado</small>'}</td>
    </tr>`).join('');
  } catch (err) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--rose);">Erro ao carregar saques.</td></tr>'; }
}

window.aprovarSaque = async (id) => {
  if (!confirm('Confirma o envio do Pix?')) return;
  await fetch(`${API_URL}/api/admin/saques/${id}/aprovar`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` } });
  carregarSaques();
  carregarMetricas();
};

window.rejeitarSaque = async (id) => {
  const motivo = prompt("Motivo:");
  if (!motivo) return;
  await fetch(`${API_URL}/api/admin/saques/${id}/rejeitar`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ motivo }) });
  carregarSaques();
};

async function carregarFrota() {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, { headers: { 'Authorization': `Bearer ${token}` } });
    const motoristas = await res.json();
    tbody.innerHTML = motoristas.map(m => `<tr>
      <td><strong>${m.nome}</strong><br><small style="color:var(--muted);">${m.telefone || '---'}</small></td>
      <td>${m.veiculo_modelo || 'Veículo'}<br><strong style="letter-spacing:1px; color:#FFF;">${m.veiculo_placa || '---'}</strong></td>
      <td>${(m.categoria_veiculo || m.categoria || '').toUpperCase()}</td>
      <td style="color:var(--primary); font-weight:800;">${fMoeda(m.saldo_carteira)}</td>
      <td><span class="badge ${m.status_aprovacao === 'aprovado' ? 'badge-aprovado' : 'badge-pendente'}">${m.status_aprovacao}</span></td>
      <td>${m.doc_crlv_url ? `<button class="btn-tbl alt" onclick="verDoc('${m.doc_crlv_url}')">Ver Doc</button>` : '<small>Sem doc</small>'}</td>
      <td>${m.status_aprovacao === 'pendente' ? `<button class="btn-tbl app" onclick="alterarStatusMot('${m.id}', 'aprovar')">Aprovar</button><button class="btn-tbl rej" onclick="alterarStatusMot('${m.id}', 'recusar')" style="margin-left:4px;">Bloquear</button>` : `<button class="btn-tbl rej" onclick="alterarStatusMot('${m.id}', 'recusar')">Suspender</button>`}</td>
    </tr>`).join('');
  } catch (err) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--rose);">Erro ao carregar frota.</td></tr>'; }
}

window.alterarStatusMot = async (id, acao) => {
  if (!confirm(`Deseja aplicar a ação "${acao}"?`)) return;
  await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ acao }) });
  carregarFrota();
};

window.verDoc = (url) => {
  const img = document.getElementById('imgPreviewVeiculo');
  const modal = document.getElementById('modalPreviewFoto');
  if (img && modal) { img.src = url; modal.style.display = 'flex'; }
};

document.getElementById('btnFecharModalPreview')?.addEventListener('click', () => {
  const modal = document.getElementById('modalPreviewFoto');
  if (modal) modal.style.display = 'none';
});

async function carregarViagens() {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, { headers: { 'Authorization': `Bearer ${token}` } });
    const viagens = await res.json();
    tbody.innerHTML = viagens.map(v => `<tr>
      <td><small style="color:var(--muted)">${String(v.id).substring(0,8)}</small></td>
      <td>${v.sub_tipo_label || v.tipo}</td>
      <td>${Number(v.distancia_km || 0).toFixed(1)} km</td>
      <td style="color:var(--amber); font-weight:800;">${fMoeda(v.valor_total)}</td>
      <td style="color:var(--blue); font-weight:800;">+ ${fMoeda(Number(v.valor_total || 0) * 0.15)}</td>
      <td>${v.motorista_nome || 'Aguardando'}</td>
      <td><span class="badge ${v.status === 'concluido' ? 'badge-concluido' : 'badge-pendente'}">${v.status}</span></td>
    </tr>`).join('');
  } catch (e) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--rose);">Erro ao carregar viagens.</td></tr>'; }
}

document.getElementById('formConfiguracoes')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const taxa_plataforma = Number(document.getElementById('cfgTaxaPlataforma').value);
  const tarifa_km_carro = Number(document.getElementById('cfgKmCarro').value);
  const tarifa_km_moto = Number(document.getElementById('cfgKmMoto').value);
  const tarifa_km_entrega = Number(document.getElementById('cfgKmEntrega').value);

  const res = await fetch(`${API_URL}/api/admin/tarifas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ taxa_plataforma, tarifa_km_carro, tarifa_km_moto, tarifa_km_entrega })
  });
  if (res.ok) alert('Parâmetros salvos com sucesso!');
  else alert('Erro ao salvar parâmetros.');
});

document.getElementById('btnSincronizar')?.addEventListener('click', () => {
  carregarMetricas(); carregarSaques(); carregarFrota(); carregarViagens(); carregarCupons(); carregarSeguranca();
  carregarZonasDinamicas(token);
});

// Inicialização imediata
carregarMetricas();
carregarSaques();
carregarFrota();
carregarViagens();
carregarCupons();
carregarSeguranca();