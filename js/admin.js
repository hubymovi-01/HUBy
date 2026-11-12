// js/admin.js - Orquestrador Geral do Painel Master HUBy
import { API_URL } from './config.js';
import { inicializarRadarMaster, atualizarPosicaoCondutorNoMapa } from './admin-radar.js';

let chartFinanceiroInstance = null;
let chartCategoriasInstance = null;
let motoristaFocadoModalId = null;

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

// ============================================================================
// SISTEMA DE NOTIFICAÇÃO TOAST EXECUTIVO (SEM BLOQUEAR A TELA)
// ============================================================================
function notificarAdmin(mensagem, tipo = 'sucesso') {
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    container.className = 'admin-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `admin-toast ${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 260);
  }, 3600);
}

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('huby_token');
  const role = (localStorage.getItem('huby_user_role') || '').toLowerCase();

  if (!token || (role !== 'admin' && role !== 'administrador')) {
    notificarAdmin('Acesso restrito ao Painel Administrativo Master.', 'erro');
    setTimeout(() => window.location.replace('./login.html'), 900);
    return;
  }

  // 1. Registra eventos e navegação
  configurarNavegacaoAbas();
  configurarFiltroPeriodo(token);
  configurarFormZonasRisco(token);
  configurarFormCupons(token);
  configurarFormBroadcast(token);
  configurarFormTarifas(token);
  configurarFormMercadoPago(token);
  configurarModalDocumentos(token);
  configurarFormMarketplace(token);

  document.getElementById('btnSincronizar')?.addEventListener('click', async () => {
    await sincronizarTudo(token);
    notificarAdmin('Dados sincronizados com o servidor!', 'sucesso');
  });
  document.getElementById('btnBaixarCSV')?.addEventListener('click', () => exportarRelatorioCSV(token));

  // 2. Inicializa Radar
  try {
    inicializarRadarMaster(token);
  } catch (err) {
    console.warn('Radar inicializado em segundo plano:', err);
  }

  // 3. Conexão Socket.IO
  try {
    conectarSocketAdmin();
  } catch (err) {
    console.warn('Socket indisponível:', err);
  }

  // 4. Carrega todos os módulos
  sincronizarTudo(token);
});

// ============================================================================
// CARREGAMENTO EM ORDEM SEQUENCIAL GARANTIDA
// ============================================================================
async function sincronizarTudo(token) {
  if (!token) return;

  const periodoAtual = document.getElementById('selectFiltroPeriodo')?.value || 'total';

  await carregarTabelaFrota(token);
  await carregarMetricasECards(token, periodoAtual);
  await carregarDadosSocios(token);

  Promise.allSettled([
    carregarTabelaZonasRisco(token),
    carregarTabelaCupons(token),
    carregarTabelaSeguranca(token),
    carregarTabelaSaques(token),
    carregarTabelaViagens(token),
    carregarTabelaMarketplace(token),
    carregarTarifasConfig(token),
    carregarGatewayConfig(token)
  ]);
}

function configurarFiltroPeriodo(token) {
  const select = document.getElementById('selectFiltroPeriodo');
  if (!select) return;

  select.addEventListener('change', () => {
    carregarMetricasECards(token, select.value);
  });
}

async function carregarMetricasECards(token, periodo = 'total') {
  try {
    const res = await fetch(`${API_URL}/api/admin/metricas?periodo=${periodo}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    let dados = {};
    if (res.ok) {
      dados = await res.json();
    }

    let faturamentoBruto = Number(dados.faturamentoBruto || 0);
    let lucroLiquido = Number(dados.lucroHuby || 0);
    let repasseMotoristas = Number(dados.repasseMotoristas || 0);
    let viagensConcluidas = Number(dados.viagensConcluidas || 0);
    let incidentesAtivos = Number(dados.alertasSeguranca || 0);

    if (faturamentoBruto === 0 && window._ultimoSaldoAcumuladoFrota > 0) {
      repasseMotoristas = Number(window._ultimoSaldoAcumuladoFrota.toFixed(2));
      faturamentoBruto = Number((repasseMotoristas / 0.85).toFixed(2));
      lucroLiquido = Number((faturamentoBruto * 0.15).toFixed(2));
      if (viagensConcluidas === 0) viagensConcluidas = 1;
    }

    const setTexto = (id, valor) => {
      const el = document.getElementById(id);
      if (el) el.textContent = valor;
    };

    setTexto('metricBruto', `R$ ${faturamentoBruto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTexto('metricLiquido', `R$ ${lucroLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTexto('metricRepasse', `R$ ${repasseMotoristas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTexto('metricConcluidas', viagensConcluidas);
    setTexto('metricAlertas', incidentesAtivos);

    setTimeout(() => {
      renderizarGraficos(
        faturamentoBruto,
        lucroLiquido,
        repasseMotoristas,
        dados.distribuicao_categorias || { carro: viagensConcluidas || 1, moto: 0, entrega: 0 }
      );
    }, 150);

  } catch (err) {
    console.warn('Erro ao ler KPIs:', err);
  }
}

function renderizarGraficos(bruto, lucro, repasse, categorias) {
  if (typeof Chart === 'undefined') return;

  const canvasFin = document.getElementById('chartFinanceiro');
  const ctxFin = canvasFin?.getContext('2d');
  if (ctxFin) {
    if (chartFinanceiroInstance) {
      chartFinanceiroInstance.destroy();
      chartFinanceiroInstance = null;
    }

    const valRepasse = repasse > 0 ? repasse : 85;
    const valLucro = lucro > 0 ? lucro : 15;

    chartFinanceiroInstance = new Chart(ctxFin, {
      type: 'doughnut',
      data: {
        labels: ['Repasse Condutores (85%)', 'Taxa HUBy (15%)'],
        datasets: [{
          data: [valRepasse, valLucro],
          backgroundColor: ['#F59E0B', '#38BDF8'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94A3B8', boxWidth: 12, font: { size: 12 } }
          }
        }
      }
    });
  }

  const canvasCat = document.getElementById('chartCategorias');
  const ctxCat = canvasCat?.getContext('2d');
  if (ctxCat) {
    if (chartCategoriasInstance) {
      chartCategoriasInstance.destroy();
      chartCategoriasInstance = null;
    }

    const totalCarro = Number(categorias.carro || (bruto > 0 ? 1 : 0));
    const totalMoto = Number(categorias.moto || 0);
    const totalEntrega = Number(categorias.entrega || 0);

    chartCategoriasInstance = new Chart(ctxCat, {
      type: 'bar',
      data: {
        labels: ['HUBy Carro', 'HUBy Moto', 'HUBy Entrega'],
        datasets: [{
          label: 'Viagens',
          data: [totalCarro, totalMoto, totalEntrega],
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
          y: {
            ticks: { color: '#94A3B8', precision: 0 },
            grid: { color: 'rgba(255,255,255,0.05)' },
            suggestedMax: 5
          }
        }
      }
    });
  }
}

// ============================================================================
// 3. DIVISÃO DOS SÓCIOS (50% / 50%)
// ============================================================================
async function carregarDadosSocios(token) {
  const tbodyRetiradas = document.getElementById('tabelaRetiradasSociosBody');
  try {
    const res = await fetch(`${API_URL}/api/socios/saldo-divisao`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const socios = data.socios || [];

    if (socios[0]) {
      document.getElementById('socio1Nome').textContent = `${socios[0].nome} (${socios[0].porcentagem}%)`;
      document.getElementById('socio1Chave').textContent = `Chave Pix: ${socios[0].chave_pix}`;
      document.getElementById('socio1Saldo').textContent = `R$ ${Number(socios[0].saldoDisponivel).toFixed(2).replace('.', ',')}`;
      const elSacado1 = document.getElementById('socio1TotalSacado');
      if (elSacado1) elSacado1.textContent = `Total já retirado: R$ ${Number(socios[0].jaSacado).toFixed(2).replace('.', ',')}`;
      window._socio1Max = Number(socios[0].saldoDisponivel);
    }

    if (socios[1]) {
      document.getElementById('socio2Nome').textContent = `${socios[1].nome} (${socios[1].porcentagem}%)`;
      document.getElementById('socio2Chave').textContent = `Chave Pix: ${socios[1].chave_pix}`;
      document.getElementById('socio2Saldo').textContent = `R$ ${Number(socios[1].saldoDisponivel).toFixed(2).replace('.', ',')}`;
      const elSacado2 = document.getElementById('socio2TotalSacado');
      if (elSacado2) elSacado2.textContent = `Total já retirado: R$ ${Number(socios[1].jaSacado).toFixed(2).replace('.', ',')}`;
      window._socio2Max = Number(socios[1].saldoDisponivel);
    }

    if (tbodyRetiradas && data.historicoRetiradas) {
      if (!data.historicoRetiradas.length) {
        tbodyRetiradas.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma retirada registrada até o momento.</td></tr>';
      } else {
        tbodyRetiradas.innerHTML = data.historicoRetiradas.map(r => `
          <tr>
            <td><strong>#${r.id}</strong></td>
            <td><strong>${r.socio_nome}</strong></td>
            <td><code>${r.chave_pix}</code></td>
            <td style="color: var(--primary); font-weight: 800;">R$ ${Number(r.valor).toFixed(2).replace('.', ',')}</td>
            <td>${new Date(r.criado_em).toLocaleString('pt-BR')}</td>
          </tr>
        `).join('');
      }
    }
  } catch (e) {
    if (tbodyRetiradas) {
      tbodyRetiradas.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma retirada registrada até o momento.</td></tr>';
    }
  }
}

window.editarDadosSocio = async (socioId) => {
  const token = localStorage.getItem('huby_token');
  const nome = prompt(`Informe o Nome do Sócio ${socioId}:`);
  if (!nome) return;
  const chave_pix = prompt(`Informe a Chave Pix de recebimento do Sócio ${socioId}:`);
  if (!chave_pix) return;

  try {
    const res = await fetch(`${API_URL}/api/socios/atualizar/${socioId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nome, chave_pix })
    });
    if (res.ok) {
      notificarAdmin('Dados do sócio atualizados com sucesso!', 'sucesso');
      carregarDadosSocios(token);
    } else {
      notificarAdmin('Erro ao atualizar dados do sócio.', 'erro');
    }
  } catch (e) {
    notificarAdmin('Erro de conexão ao atualizar dados do sócio.', 'erro');
  }
};

window.solicitarSaqueSocio = async (socioId) => {
  const token = localStorage.getItem('huby_token');
  const maxDisponivel = socioId === 1 ? (window._socio1Max || 0) : (window._socio2Max || 0);

  if (maxDisponivel <= 0) {
    notificarAdmin('Não há saldo disponível para retirada no momento.', 'aviso');
    return;
  }

  const valorStr = prompt(`Informe o valor da retirada (Disponível: R$ ${maxDisponivel.toFixed(2).replace('.', ',')}):`, maxDisponivel.toFixed(2));
  if (!valorStr) return;

  const valor = parseFloat(valorStr);
  if (!valor || valor <= 0 || valor > maxDisponivel) {
    notificarAdmin('Valor inválido ou superior ao saldo disponível.', 'erro');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/socios/retirar/${socioId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ valor })
    });

    const data = await res.json();
    if (res.ok) {
      notificarAdmin(data.mensagem || 'Retirada registrada com sucesso!', 'sucesso');
      carregarDadosSocios(token);
    } else {
      notificarAdmin(data.erro || 'Falha ao registrar retirada.', 'erro');
    }
  } catch (e) {
    notificarAdmin('Erro de conexão ao processar retirada.', 'erro');
  }
};

// ============================================================================
// GESTÃO DO CLUBE HUBy / MARKETPLACE
// ============================================================================
async function carregarTabelaMarketplace(token) {
  const tbody = document.getElementById('tabelaMarketplaceBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhuma parceria cadastrada no momento.</td></tr>';
      return;
    }
    const itens = await res.json();

    if (!Array.isArray(itens) || !itens.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum benefício ou parceria cadastrada no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = itens.map(i => `
      <tr>
        <td><strong>${i.titulo}</strong><br><small style="color:var(--muted);">${i.empresa_nome}</small></td>
        <td><span class="badge badge-aceito">${i.categoria}</span></td>
        <td style="color:var(--rose); text-decoration:line-through;">R$ ${Number(i.preco_original).toFixed(2).replace('.', ',')}</td>
        <td style="color:var(--primary); font-weight:800;">R$ ${Number(i.preco_parceiro).toFixed(2).replace('.', ',')}</td>
        <td><span class="badge ${i.ativo ? 'badge-ativo' : 'badge-inativo'}">${i.ativo ? 'Disponível' : 'Oculto'}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn-tbl alt" onclick="alternarStatusMarketplace('${i.id}')">${i.ativo ? 'Ocultar' : 'Exibir'}</button>
            <button class="btn-tbl rej" onclick="excluirItemMarketplace('${i.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhuma parceria cadastrada no momento.</td></tr>';
  }
}

function configurarFormMarketplace(token) {
  document.getElementById('formNovoMarketplace')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = e.target.querySelector('button[type="submit"]');
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Publicando...';
    }

    const titulo = document.getElementById('mkpTitulo').value.trim();
    const empresa_nome = document.getElementById('mkpEmpresa').value.trim();
    const categoria = document.getElementById('mkpCategoria').value;
    const descricao = document.getElementById('mkpDescricao').value.trim();
    const preco_original = parseFloat(document.getElementById('mkpPrecoDe').value) || 0;
    const preco_parceiro = parseFloat(document.getElementById('mkpPrecoPor').value) || 0;
    const whatsapp_contato = document.getElementById('mkpWhatsapp').value.replace(/\D/g, '');
    const imagem_url = document.getElementById('mkpImagemUrl').value.trim() || null;

    try {
      const res = await fetch(`${API_URL}/api/marketplace/admin/itens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          titulo, empresa_nome, categoria, descricao, 
          preco_original, preco_parceiro, whatsapp_contato, imagem_url,
          endereco: 'Atendimento Local'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        notificarAdmin('Nova parceria adicionada com sucesso ao Clube HUBy!', 'sucesso');
        e.target.reset();
        await carregarTabelaMarketplace(token);
      } else {
        notificarAdmin(data.erro || 'Erro ao guardar a parceria.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao salvar parceria.', 'erro');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Publicar Parceria no App';
      }
    }
  });
}

window.alternarStatusMarketplace = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens/${id}/toggle`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Visibilidade da oferta atualizada.', 'sucesso');
      carregarTabelaMarketplace(token);
    }
  } catch (e) {}
};

window.excluirItemMarketplace = async (id) => {
  if (!confirm('Tem certeza de que deseja remover esta oferta permanentemente?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/marketplace/admin/itens/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Oferta removida do Clube HUBy.', 'aviso');
      carregarTabelaMarketplace(token);
    }
  } catch (e) {}
};

// ============================================================================
// 4. GESTÃO DE FROTA E DOCUMENTOS
// ============================================================================
async function carregarTabelaFrota(token) {
  const tbody = document.getElementById('tabelaFrotaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
      return;
    }
    const motoristas = await res.json();

    if (!Array.isArray(motoristas) || !motoristas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
      return;
    }

    window._ultimoSaldoAcumuladoFrota = motoristas.reduce((acc, m) => acc + Number(m.saldo_carteira || 0), 0);

    tbody.innerHTML = motoristas.map(m => {
      const statusLimpo = m.status_aprovacao || 'pendente';
      const badgeStatus = {
        aprovado: 'badge-aprovado',
        pendente: 'badge-pendente',
        bloqueado: 'badge-recusado',
        recusado: 'badge-recusado'
      }[statusLimpo] || 'badge-pendente';

      return `
        <tr>
          <td>
            <strong>${m.nome}</strong><br>
            <small style="color:var(--muted);">CNH: ${m.cnh || m.cnh_numero || '---'}</small>
          </td>
          <td>
            ${m.veiculo_modelo || 'Não inf.'}<br>
            <small style="color:var(--blue); font-weight:700;">${(m.veiculo_placa || 'SEM PLACA').toUpperCase()}</small>
          </td>
          <td><span class="badge badge-aceito">${(m.categoria || m.categoria_veiculo || 'carro').toUpperCase()}</span></td>
          <td style="color:var(--primary); font-weight:800;">R$ ${Number(m.saldo_carteira || 0).toFixed(2).replace('.', ',')}</td>
          <td><span class="badge ${badgeStatus}">${statusLimpo.toUpperCase()}</span></td>
          <td>
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              ${m.doc_crlv_url ? `<button class="btn-tbl alt" onclick="abrirFotoDocumento('${m.doc_crlv_url}', 'CRLV do Veículo - ${m.nome}', '${m.id}')">CRLV</button>` : ''}
              ${m.doc_cnh_url ? `<button class="btn-tbl alt" onclick="abrirFotoDocumento('${m.doc_cnh_url}', 'CNH - ${m.nome}', '${m.id}')">CNH</button>` : ''}
              ${!m.doc_crlv_url && !m.doc_cnh_url ? '<small style="color:var(--muted);">Sem doc</small>' : ''}
            </div>
          </td>
          <td>
            <div style="display:flex; gap:4px;">
              ${statusLimpo !== 'aprovado' ? `
                <button class="btn-tbl app" onclick="alterarStatusCondutor('${m.id}', 'aprovar')">Aprovar</button>
              ` : ''}
              ${statusLimpo !== 'recusado' && statusLimpo !== 'bloqueado' ? `
                <button class="btn-tbl rej" onclick="alterarStatusCondutor('${m.id}', 'recusar')">Recusar</button>
              ` : `
                <button class="btn-tbl app" onclick="alterarStatusCondutor('${m.id}', 'aprovar')">Liberar</button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhum parceiro cadastrado.</td></tr>';
  }
}

// 5. Zonas de Risco
async function carregarTabelaZonasRisco(token) {
  const tbody = document.getElementById('tabelaZonasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
      return;
    }
    const zonas = await res.json();
    if (!Array.isArray(zonas) || !zonas.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
      return;
    }

    tbody.innerHTML = zonas.map(z => `
      <tr>
        <td><strong>${z.nome}</strong><br><small style="color:var(--muted);">${z.descricao || 'Área demarcada'}</small></td>
        <td><span class="badge ${z.nivel_risco === 'alto' ? 'badge-recusado' : 'badge-pendente'}">${(z.nivel_risco || 'ALTO').toUpperCase()}</span></td>
        <td>${z.raio_metros || 500}m</td>
        <td><code style="color:var(--blue);">${z.horario_inicio || '20:00'} às ${z.horario_fim || '05:00'}</code></td>
        <td><button class="btn-tbl rej" onclick="excluirZonaRisco(${z.id})">Remover</button></td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhuma zona de risco cadastrada.</td></tr>';
  }
}

function configurarFormZonasRisco(token) {
  document.getElementById('formZonaRisco')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('zonaNome').value.trim();
    const nivel_risco = document.getElementById('zonaNivel').value;
    const lat = parseFloat(document.getElementById('zonaLat').value);
    const lng = parseFloat(document.getElementById('zonaLng').value);
    const raio_metros = parseInt(document.getElementById('zonaRaio').value, 10) || 500;
    const horario_inicio = document.getElementById('zonaHoraInicio').value || '20:00:00';
    const horario_fim = document.getElementById('zonaHoraFim').value || '05:00:00';

    try {
      const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, nivel_risco, lat, lng, raio_metros, horario_inicio, horario_fim })
      });
      if (res.ok) {
        notificarAdmin('Zona de risco delimitada com sucesso!', 'sucesso');
        e.target.reset();
        carregarTabelaZonasRisco(token);
      } else {
        notificarAdmin('Erro ao registrar zona de risco.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao registrar zona.', 'erro');
    }
  });
}

// 6. Cupons de Desconto
async function carregarTabelaCupons(token) {
  const tbody = document.getElementById('tabelaCuponsBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/cupons`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
      return;
    }
    const cupons = await res.json();
    if (!Array.isArray(cupons) || !cupons.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
      return;
    }

    tbody.innerHTML = cupons.map(c => `
      <tr>
        <td><strong>${c.codigo}</strong></td>
        <td>${c.tipo === 'porcentagem' ? `${c.valor}%` : `R$ ${Number(c.valor).toFixed(2).replace('.', ',')}`}</td>
        <td>${c.usos_atuais || 0} / ${c.limite_usos || '∞'}</td>
        <td><span class="badge ${c.ativo ? 'badge-ativo' : 'badge-inativo'}">${c.ativo ? 'Ativo' : 'Pausado'}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn-tbl alt" onclick="alternarCupom('${c.id}')">${c.ativo ? 'Pausar' : 'Ativar'}</button>
            <button class="btn-tbl rej" onclick="excluirCupom('${c.id}')">Excluir</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty-row">Nenhum cupom promocional cadastrado.</td></tr>';
  }
}

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
        notificarAdmin('Cupom cadastrado com sucesso!', 'sucesso');
        e.target.reset();
        carregarTabelaCupons(token);
      } else {
        notificarAdmin('Erro ao salvar cupom promocional.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao salvar cupom.', 'erro');
    }
  });
}

// 7. Incidentes e SOS
async function carregarTabelaSeguranca(token) {
  const tbody = document.getElementById('tabelaSegurancaBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/incidentes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
      return;
    }
    const incidentes = await res.json();
    if (!Array.isArray(incidentes) || !incidentes.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
      return;
    }

    tbody.innerHTML = incidentes.map(i => `
      <tr>
        <td>#${String(i.id).slice(-4)}</td>
        <td><span class="badge ${i.tipo_alerta === 'sos' ? 'badge-sos' : 'badge-pendente'}">${(i.tipo_alerta || 'ALERTA').toUpperCase()}</span></td>
        <td>${i.descricao || 'Alerta reportado'}</td>
        <td>${new Date(i.criado_em).toLocaleString('pt-BR')}</td>
        <td><span class="badge ${i.resolvido ? 'badge-concluido' : 'badge-pendente'}">${i.resolvido ? 'Resolvido' : 'Pendente'}</span></td>
        <td>${!i.resolvido ? `<button class="btn-tbl app" onclick="resolverIncidente(${i.id})">Resolver</button>` : '---'}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Sem incidentes pendentes. Frota segura!</td></tr>';
  }
}

// 8. Moderação e Extrato de Saques dos Motoristas
async function carregarTabelaSaques(token) {
  const tbody = document.getElementById('tabelaSaquesBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/carteira/admin/saques`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
      return;
    }
    const saques = await res.json();

    if (!Array.isArray(saques) || !saques.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
      return;
    }

    tbody.innerHTML = saques.map(s => {
      const badgeClass = s.status === 'pago' ? 'badge-pago' : (s.status === 'recusado' ? 'badge-recusado' : 'badge-pendente');
      const dataFormatada = s.criado_em ? new Date(s.criado_em).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--';

      return `
        <tr>
          <td><strong>#${s.id}</strong></td>
          <td>
            <strong>${s.motorista_nome || 'Condutor'}</strong><br>
            <small style="color:var(--muted);">${dataFormatada}</small>
          </td>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <code style="background:rgba(255,255,255,0.06); padding:3px 6px; border-radius:4px; font-family:monospace; color:#38BDF8;">
                ${s.chave_pix}
              </code>
              <button type="button" class="btn-copiar-chave-pix" data-chave="${s.chave_pix}" title="Copiar Chave Pix" 
                style="background:transparent; border:none; cursor:pointer; color:var(--muted); font-size:13px;">
                📋
              </button>
            </div>
          </td>
          <td style="font-weight: 800; color: var(--primary);">R$ ${Number(s.valor).toFixed(2).replace('.', ',')}</td>
          <td><span class="badge ${badgeClass}">${s.status.toUpperCase()}</span></td>
          <td>
            ${s.status === 'pendente' ? `
              <div style="display:flex; gap:6px;">
                <button class="btn-tbl app" onclick="processarSaqueMaster(${s.id}, 'pago')">Pagar Pix</button>
                <button class="btn-tbl rej" onclick="processarSaqueMaster(${s.id}, 'recusado')">Recusar</button>
              </div>
            ` : `<small style="color:var(--muted);">${s.status === 'pago' ? 'Liquidado' : 'Estornado'}</small>`}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-copiar-chave-pix').forEach(btn => {
      btn.addEventListener('click', () => {
        const chave = btn.getAttribute('data-chave');
        navigator.clipboard.writeText(chave);
        notificarAdmin('Chave Pix copiada!', 'sucesso');
      });
    });

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty-row">Nenhum pedido de saque registrado até o momento.</td></tr>';
  }
}

// 9. Monitor de Viagens
async function carregarTabelaViagens(token) {
  const tbody = document.getElementById('tabelaCorridasBody');
  if (!tbody) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/pedidos`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
      return;
    }
    const corridas = await res.json();
    if (!Array.isArray(corridas) || !corridas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
      return;
    }

    tbody.innerHTML = corridas.slice(0, 25).map(c => {
      const taxa = Number(c.valor_total || 0) * 0.15;
      return `
        <tr>
          <td><strong>#${String(c.id).slice(-4)}</strong></td>
          <td>${c.sub_tipo_label || c.tipo || 'HUBy'}</td>
          <td>${c.distancia_km || '0.0'} km</td>
          <td style="font-weight:800; color:#FFF;">R$ ${Number(c.valor_total || 0).toFixed(2).replace('.', ',')}</td>
          <td style="color:var(--blue); font-weight:700;">R$ ${taxa.toFixed(2).replace('.', ',')}</td>
          <td>${c.motorista_nome || 'Aguardando...'}</td>
          <td><span class="badge ${c.status === 'concluido' ? 'badge-concluido' : (c.status === 'cancelado' ? 'badge-recusado' : 'badge-aceito')}">${(c.status || 'pendente').toUpperCase()}</span></td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-empty-row">Nenhuma viagem registrada no histórico.</td></tr>';
  }
}

// 10. Parâmetros e Tarifas Dinâmicas (Sincronizado com os 9 campos do HTML)
async function carregarTarifasConfig(token) {
  try {
    const res = await fetch(`${API_URL}/api/admin/tarifas`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const cfg = await res.json();

    if (cfg.taxa_plataforma !== undefined) {
      document.getElementById('cfgTaxaPlataforma').value = cfg.taxa_plataforma;
    }

    if (cfg.carro) {
      if (cfg.carro.base !== undefined) document.getElementById('tarifaCarroBase').value = Number(cfg.carro.base).toFixed(2);
      if (cfg.carro.km !== undefined) document.getElementById('tarifaCarroKm').value = Number(cfg.carro.km).toFixed(2);
      if (cfg.carro.min !== undefined) document.getElementById('tarifaCarroMin').value = Number(cfg.carro.min).toFixed(2);
    }

    if (cfg.moto) {
      if (cfg.moto.base !== undefined) document.getElementById('tarifaMotoBase').value = Number(cfg.moto.base).toFixed(2);
      if (cfg.moto.km !== undefined) document.getElementById('tarifaMotoKm').value = Number(cfg.moto.km).toFixed(2);
      if (cfg.moto.min !== undefined) document.getElementById('tarifaMotoMin').value = Number(cfg.moto.min).toFixed(2);
    }

    if (cfg.entrega) {
      if (cfg.entrega.base !== undefined) document.getElementById('tarifaFlashBase').value = Number(cfg.entrega.base).toFixed(2);
      if (cfg.entrega.km !== undefined) document.getElementById('tarifaFlashKm').value = Number(cfg.entrega.km).toFixed(2);
      if (cfg.entrega.min !== undefined) document.getElementById('tarifaFlashMin').value = Number(cfg.entrega.min).toFixed(2);
    }
  } catch (e) {}
}

function configurarFormTarifas(token) {
  document.getElementById('formConfiguracoes')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      taxa_plataforma: Number(document.getElementById('cfgTaxaPlataforma').value) || 15,
      carro: {
        base: Number(document.getElementById('tarifaCarroBase').value) || 6.0,
        km: Number(document.getElementById('tarifaCarroKm').value) || 2.2,
        min: Number(document.getElementById('tarifaCarroMin').value) || 0.30
      },
      moto: {
        base: Number(document.getElementById('tarifaMotoBase').value) || 4.0,
        km: Number(document.getElementById('tarifaMotoKm').value) || 1.4,
        min: Number(document.getElementById('tarifaMotoMin').value) || 0.20
      },
      entrega: {
        base: Number(document.getElementById('tarifaFlashBase').value) || 5.0,
        km: Number(document.getElementById('tarifaFlashKm').value) || 1.8,
        min: Number(document.getElementById('tarifaFlashMin').value) || 0.25
      }
    };

    try {
      const res = await fetch(`${API_URL}/api/admin/tarifas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        notificarAdmin('Tabela tarifária dinâmica atualizada no banco!', 'sucesso');
      } else {
        notificarAdmin('Falha ao atualizar tabela tarifária.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Erro de conexão ao salvar tarifas.', 'erro');
    }
  });
}

// 11. Gateway de Pagamento (Mercado Pago)
async function carregarGatewayConfig(token) {
  try {
    const res = await fetch(`${API_URL}/api/admin/gateway/mercadopago`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.access_token) document.getElementById('mpAccessToken').value = data.access_token;
    if (data.public_key) document.getElementById('mpPublicKey').value = data.public_key;
    if (data.taxa_percentual) document.getElementById('mpTaxaPercentual').value = data.taxa_percentual;
  } catch (e) {}
}

function configurarFormMercadoPago(token) {
  document.getElementById('formMercadoPagoConfig')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const access_token = document.getElementById('mpAccessToken').value.trim();
    const public_key = document.getElementById('mpPublicKey').value.trim();
    const taxa_percentual = parseFloat(document.getElementById('mpTaxaPercentual').value) || 0.99;

    try {
      const res = await fetch(`${API_URL}/api/admin/gateway/mercadopago`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ access_token, public_key, taxa_percentual })
      });
      if (res.ok) {
        notificarAdmin('Credenciais do Mercado Pago salvas com sucesso!', 'sucesso');
      } else {
        notificarAdmin('Falha ao salvar chaves do Mercado Pago.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Erro de conexão ao salvar gateway.', 'erro');
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
      const res = await fetch(`${API_URL}/api/admin/notificacoes/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ publico, titulo, mensagem })
      });
      if (res.ok) {
        notificarAdmin('Notificação Push transmitida para a frota!', 'sucesso');
        e.target.reset();
      } else {
        notificarAdmin('Erro ao enviar broadcast.', 'erro');
      }
    } catch (err) {
      notificarAdmin('Falha de conexão ao disparar alerta.', 'erro');
    }
  });
}

function configurarModalDocumentos(token) {
  const modal = document.getElementById('modalPreviewFoto');
  const btnFechar = document.getElementById('btnFecharModalPreview');
  const btnAprovar = document.getElementById('btnAprovarDocModal');
  const btnRecusar = document.getElementById('btnRecusarDocModal');

  window.abrirFotoDocumento = (url, titulo = 'Documento do Condutor', motoristaId = null) => {
    const img = document.getElementById('imgPreviewVeiculo');
    const lblTitulo = document.getElementById('lblTituloDocModal');
    motoristaFocadoModalId = motoristaId;

    if (img && modal) {
      img.src = url;
      if (lblTitulo) lblTitulo.textContent = titulo;
      modal.style.display = 'flex';
      if (btnAprovar && btnRecusar) {
        btnAprovar.style.display = motoristaId ? 'inline-block' : 'none';
        btnRecusar.style.display = motoristaId ? 'inline-block' : 'none';
      }
    }
  };

  btnAprovar?.addEventListener('click', async () => {
    if (motoristaFocadoModalId) {
      await window.alterarStatusCondutor(motoristaFocadoModalId, 'aprovar');
      if (modal) modal.style.display = 'none';
    }
  });

  btnRecusar?.addEventListener('click', async () => {
    if (motoristaFocadoModalId) {
      await window.alterarStatusCondutor(motoristaFocadoModalId, 'recusar');
      if (modal) modal.style.display = 'none';
    }
  });

  btnFechar?.addEventListener('click', () => { if (modal) modal.style.display = 'none'; });
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

function configurarNavegacaoAbas() {
  const botoes = document.querySelectorAll('.tab-btn, [data-tab]');
  const paineis = document.querySelectorAll('.tab-pane, section[id^="tab"]');

  botoes.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tabAlvoId = btn.getAttribute('data-tab');
      if (!tabAlvoId) return;

      botoes.forEach(b => b.classList.remove('active'));
      paineis.forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });

      btn.classList.add('active');
      const tabAlvo = document.getElementById(tabAlvoId);
      if (tabAlvo) {
        tabAlvo.classList.add('active');
        tabAlvo.style.display = 'block';

        const token = localStorage.getItem('huby_token');

        if (tabAlvoId === 'tabMetricas') {
          setTimeout(() => {
            if (chartFinanceiroInstance) chartFinanceiroInstance.resize();
            if (chartCategoriasInstance) chartCategoriasInstance.resize();
          }, 150);
        }

        if (tabAlvoId === 'tabSocios') carregarDadosSocios(token);
        if (tabAlvoId === 'tabSaques') carregarTabelaSaques(token);
        if (tabAlvoId === 'tabCupons') carregarTabelaCupons(token);
        if (tabAlvoId === 'tabViagens') carregarTabelaViagens(token);
        if (tabAlvoId === 'tabMarketplace') carregarTabelaMarketplace(token);

        if (tabAlvoId.toLowerCase().includes('radar')) {
          setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
          }, 200);
        }
      }
    });
  });
}

function conectarSocketAdmin() {
  const ioClient = getSocketIO();
  if (!ioClient) return;

  const socket = ioClient(API_URL);
  socket.on('posicao_motorista', (dados) => {
    atualizarPosicaoCondutorNoMapa(dados);
  });

  socket.on('alerta_sos', (dados) => {
    notificarAdmin(`🚨 ALERTA SOS: Viagem #${dados.pedidoId} - ${dados.relato || 'Emergência reportada!'}`, 'erro');
    const token = localStorage.getItem('huby_token');
    carregarTabelaSeguranca(token);
    carregarMetricasECards(token);
  });
}

// Ações Globais
window.excluirZonaRisco = async (id) => {
  if (!confirm('Deseja realmente remover esta zona de risco?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/zonas-risco/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Zona de risco removida.', 'aviso');
      carregarTabelaZonasRisco(token);
    }
  } catch (e) {}
};

window.alternarCupom = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/cupons/${id}/toggle`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Status do cupom alterado.', 'sucesso');
      carregarTabelaCupons(token);
    }
  } catch (e) {}
};

window.excluirCupom = async (id) => {
  if (!confirm('Deseja excluir este cupom?')) return;
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/cupons/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Cupom excluído.', 'aviso');
      carregarTabelaCupons(token);
    }
  } catch (e) {}
};

window.alterarStatusCondutor = async (id, acao) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/motoristas/${id}/triagem`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ acao })
    });
    if (res.ok) {
      notificarAdmin(acao === 'aprovar' ? 'Condutor aprovado e liberado!' : 'Condutor recusado/bloqueado.', acao === 'aprovar' ? 'sucesso' : 'aviso');
      await carregarTabelaFrota(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {}
};

window.processarSaqueMaster = async (id, status) => {
  const token = localStorage.getItem('huby_token');
  let motivo = '';

  if (status === 'recusado') {
    motivo = prompt('Informe o motivo da recusa (o valor será estornado para a carteira do parceiro):');
    if (motivo === null) return;
  } else {
    if (!confirm('Confirma que realizou a transferência Pix para a chave indicada?')) return;
  }

  try {
    const res = await fetch(`${API_URL}/api/carteira/admin/saques/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ status, motivo_recusa: motivo })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao processar saque.');

    notificarAdmin(status === 'pago' ? 'Saque marcado como PAGO!' : 'Saque recusado e valor estornado.', status === 'pago' ? 'sucesso' : 'aviso');
    await carregarTabelaSaques(token);
    await carregarMetricasECards(token);
  } catch (e) {
    notificarAdmin(e.message, 'erro');
  }
};

window.resolverIncidente = async (id) => {
  const token = localStorage.getItem('huby_token');
  try {
    const res = await fetch(`${API_URL}/api/admin/seguranca/incidentes/${id}/resolver`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      notificarAdmin('Incidente marcado como resolvido.', 'sucesso');
      await carregarTabelaSeguranca(token);
      await carregarMetricasECards(token);
    }
  } catch (e) {}
};

function exportarRelatorioCSV(token) {
  const tokenUrl = token || localStorage.getItem('huby_token') || '';
  window.open(`${API_URL}/api/admin/relatorios/corridas.csv?token=${encodeURIComponent(tokenUrl)}`, '_blank');
}