/**
 * HUBy 2.0 - Orquestrador Central do Motorista Parceiro (js/app-motorista.js)
 * Conecta os submódulos modulares da pasta ./motorista/
 */

import { API_URL, sonsHUBy } from './config.js';
import { configurarRecursosInteligentes } from './motorista/motorista-heatmap.js';

// Coordenadas padrão e estado central
const estado = {
  token: localStorage.getItem('huby_token') || null,
  motoristaId: localStorage.getItem('huby_user_id') || null,
  mapa: null,
  markerVeiculo: null,
  coords: [-8.3580, -42.2460],
  statusOnline: false,
  saldoCarteira: 0.0,
  intervalRadar: null
};

// Utilitário para cabeçalhos HTTP autenticados limpos
function obterHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = estado.token || localStorage.getItem('huby_token');
  if (token && token !== 'null' && token !== 'undefined') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ============================================================================
// 1. INICIALIZAÇÃO DO MAPA LEAFLET
// ============================================================================
function inicializarMapa() {
  const container = document.getElementById('mapaMotorista');
  if (!container) return;

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  try {
    estado.mapa = L.map('mapaMotorista', {
      zoomControl: false,
      attributionControl: false
    }).setView(estado.coords, 15);

    // Servidor 100% público do OpenStreetMap (Livre de qualquer bloqueio ou API Key)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarro = L.divIcon({
      className: 'huby-driver-pin',
      html: '<div style="width:36px;height:36px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(16,185,129,0.8);font-size:18px;">🚘</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarro }).addTo(estado.mapa);

    // Força o Leaflet a renderizar as dimensões corretas e eliminar a tela cinza
    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 300);

    // Conecta as ferramentas inteligentes (Calor, Pausa, Casa) passando a instância do mapa
    configurarRecursosInteligentes(estado.mapa, estado.token);

    // Geolocalização contínua com fallback
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        estado.coords = [latitude, longitude];
        if (estado.mapa && estado.markerVeiculo) {
          estado.mapa.setView([latitude, longitude], 16);
          estado.markerVeiculo.setLatLng([latitude, longitude]);
          estado.mapa.invalidateSize();
        }
      }, null, { enableHighAccuracy: true });
    }
  } catch (err) {
    console.error('Erro na inicialização do mapa:', err);
  }
}

// ============================================================================
// 2. STATUS ONLINE / RADAR
// ============================================================================
async function alternarStatusOnline() {
  const btn = document.getElementById('btnToggleStatusOnline');
  if (!btn) return;

  estado.statusOnline = !estado.statusOnline;

  if (estado.statusOnline) {
    btn.style.background = 'rgba(16, 185, 129, 0.2)';
    btn.style.borderColor = 'var(--emerald)';
    btn.style.color = 'var(--emerald)';
    btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
    sonsHUBy.tocarSucessoAceite();
    iniciarRadar();
  } else {
    btn.style.background = '#1F2937';
    btn.style.borderColor = 'rgba(255,255,255,0.12)';
    btn.style.color = '#94A3B8';
    btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
    pararRadar();
  }

  try {
    await fetch(`${API_URL}/api/motoristas/status-online`, {
      method: 'PUT',
      headers: obterHeaders(),
      body: JSON.stringify({ online: estado.statusOnline, coords: estado.coords })
    });
  } catch (e) {
    console.warn('Sincronização de status online em contingência');
  }
}

function iniciarRadar() {
  if (estado.intervalRadar) clearInterval(estado.intervalRadar);
  buscarChamadas();
  estado.intervalRadar = setInterval(buscarChamadas, 4000);
}

function pararRadar() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  const lista = document.getElementById('listaChamadasPendentes');
  if (lista) {
    lista.innerHTML = '<div class="dock-empty">Você está offline. Fique online para receber corridas.</div>';
  }
}

async function buscarChamadas() {
  if (!estado.statusOnline) return;
  try {
    const res = await fetch(`${API_URL}/api/pedidos/pendentes`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const chamadas = await res.json();
    renderizarChamadas(chamadas);
  } catch (e) { }
}

function renderizarChamadas(chamadas = []) {
  const container = document.getElementById('listaChamadasPendentes');
  if (!container) return;

  if (!chamadas.length) {
    container.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  container.innerHTML = chamadas.map(ped => {
    const valorBruto = Number(ped.valor_total || 0);
    const repasse = (valorBruto * 0.85).toFixed(2).replace('.', ',');
    const km = Number(ped.distancia_km || 1.0).toFixed(1);

    return `
      <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-dark); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 800; color: #38BDF8; background: rgba(56,189,248,0.15); padding: 3px 8px; border-radius: 6px;">
            ${(ped.sub_tipo_label || ped.tipo || 'HUBy Carro').toUpperCase()}
          </span>
          <strong style="font-size: 17px; color: var(--emerald); font-weight: 900;">
            R$ ${repasse}
          </strong>
        </div>
        <div style="font-size: 12px; color: #FFF; line-height: 1.4;">
          <div>📍 <strong>Destino:</strong> ${ped.destino_endereco || ped.destino || 'Destino informado'}</div>
          <div style="font-size: 11px; color: var(--text-sec); margin-top: 2px;">📏 Distância: ${km} km</div>
        </div>
        <button type="button" class="btn-aceitar" data-id="${ped.id}"
          style="width: 100%; background: var(--emerald); border: none; color: #02261C; font-weight: 900; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer;">
          ⚡ Aceitar Viagem
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-aceitar').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      try {
        const r = await fetch(`${API_URL}/api/pedidos/${id}/aceitar`, {
          method: 'PUT',
          headers: obterHeaders(),
          body: JSON.stringify({ motoristaId: estado.motoristaId })
        });
        if (r.ok) {
          sonsHUBy.tocarSucessoAceite();
          alert('Corrida aceita com sucesso!');
          buscarChamadas();
        } else {
          alert('Esta corrida já não está disponível.');
        }
      } catch (err) {
        alert('Erro ao aceitar corrida.');
      }
    });
  });
}

// ============================================================================
// 3. PERFIL, DRAWER, EXTRATO E METAS
// ============================================================================
async function carregarPerfil() {
  try {
    const res = await fetch(`${API_URL}/api/motoristas/perfil`, {
      headers: obterHeaders()
    });
    if (!res.ok) return;
    const m = await res.json();

    if (m.id) {
      estado.motoristaId = m.id;
      localStorage.setItem('huby_motorista_id', m.id);
    }

    // Top Bar
    const topNome = document.getElementById('topNomeMotorista');
    const topNota = document.getElementById('topNotaMotorista');
    const topAvatar = document.getElementById('topAvatarImg');
    const elSaldo = document.getElementById('saldoCarteiraValor');
    const elDrawerSaldo = document.getElementById('drawerSaldoValor');

    const primeiroNome = (m.nome || 'Motorista').split(' ')[0];
    if (topNome) topNome.textContent = primeiroNome;
    if (topNota) topNota.textContent = `⭐ ${Number(m.avaliacao_media || 5.0).toFixed(1)}`;
    if (topAvatar && m.foto_perfil_url) topAvatar.src = m.foto_perfil_url;

    // Saldo disponível
    estado.saldoCarteira = Number(m.saldo_carteira || 0);
    const saldoTxt = `R$ ${estado.saldoCarteira.toFixed(2).replace('.', ',')}`;
    if (elSaldo) elSaldo.textContent = saldoTxt;
    if (elDrawerSaldo) elDrawerSaldo.textContent = saldoTxt;

    // Drawer lateral do motorista
    const drawerNome = document.getElementById('drawerNomeCondutor');
    const drawerPlaca = document.getElementById('drawerCarroPlaca');
    const drawerModelo = document.getElementById('drawerCarroModelo');
    const drawerDetalhes = document.getElementById('drawerCarroDetalhes');
    const drawerFoto = document.getElementById('drawerFotoImg');
    const drawerTotalViagens = document.getElementById('drawerTotalViagensTxt');
    const drawerInputPix = document.getElementById('drawerInputChavePix');
    const badgeCategoria = document.getElementById('drawerCategoriaBadge');

    if (drawerNome) drawerNome.textContent = m.nome || 'Motorista Parceiro';
    if (drawerPlaca) drawerPlaca.textContent = (m.veiculo_placa || 'HUB-0000').toUpperCase();
    if (drawerModelo) drawerModelo.textContent = m.veiculo_modelo || 'Veículo Padrão';
    if (drawerDetalhes) drawerDetalhes.textContent = `Cor: ${m.veiculo_cor || '---'} • Ano: ${m.veiculo_ano || '---'}`;
    if (drawerFoto && m.foto_perfil_url) drawerFoto.src = m.foto_perfil_url;
    if (drawerTotalViagens) drawerTotalViagens.textContent = `${m.total_corridas || 0} viagens`;
    if (drawerInputPix && m.chave_pix_padrao) drawerInputPix.value = m.chave_pix_padrao;
    if (badgeCategoria) badgeCategoria.textContent = (m.categoria || 'HUBY CARRO').toUpperCase();

    // Preenche os campos do modal de edição
    const editNome = document.getElementById('editNome');
    const editTel = document.getElementById('editTelefone');
    const editMod = document.getElementById('editCarroModelo');
    const editPlaca = document.getElementById('editCarroPlaca');
    const editCor = document.getElementById('editCarroCor');
    const editAno = document.getElementById('editCarroAno');
    if (editNome) editNome.value = m.nome || '';
    if (editTel) editTel.value = m.telefone || '';
    if (editMod) editMod.value = m.veiculo_modelo || '';
    if (editPlaca) editPlaca.value = m.veiculo_placa || '';
    if (editCor) editCor.value = m.veiculo_cor || '';
    if (editAno) editAno.value = m.veiculo_ano || '';

    // Sincroniza o extrato e os ganhos diários
    await sincronizarExtratoDiario();
  } catch (e) {
    console.warn('Erro ao carregar perfil do motorista:', e);
  }
}

async function sincronizarExtratoDiario() {
  const containerExtrato = document.getElementById('drawerListaExtrato');
  const lblGanhosHoje = document.getElementById('lblGanhosHojeValor');
  const lblViagensHoje = document.getElementById('lblCorridasHojeQtd');
  const barraMeta = document.getElementById('barraProgressoMeta');
  const lblMetaTxt = document.getElementById('lblMetaDiariaTxt');

  try {
    const res = await fetch(`${API_URL}/api/motoristas/extrato`, { headers: obterHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    const corridas = data.corridas || data.historico || [];

    let totalGanhos = 0;
    let qtdViagens = 0;

    if (corridas.length && containerExtrato) {
      containerExtrato.innerHTML = corridas.map(c => {
        const repasse = Number(c.repasse_liquido || c.valor_total * 0.85);
        totalGanhos += repasse;
        qtdViagens++;
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-dark); font-size: 12px;">
            <div style="max-width: 65%;">
              <div style="color: #FFF; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${c.destino_endereco || 'Viagem Concluída'}
              </div>
              <small style="color: var(--text-sec); font-size: 10px;">${new Date(c.criado_em || c.concluido_em).toLocaleDateString('pt-BR')}</small>
            </div>
            <strong style="color: var(--emerald);">+ R$ ${repasse.toFixed(2).replace('.', ',')}</strong>
          </div>
        `;
      }).join('');
    } else if (containerExtrato) {
      containerExtrato.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 0;">Nenhuma corrida realizada ainda.</div>';
    }

    if (lblGanhosHoje) lblGanhosHoje.textContent = `R$ ${totalGanhos.toFixed(2).replace('.', ',')}`;
    if (lblViagensHoje) lblViagensHoje.textContent = `${qtdViagens} viagens`;

    const meta = 200.0;
    const perc = Math.min(100, Math.round((totalGanhos / meta) * 100));
    if (barraMeta) barraMeta.style.width = `${perc}%`;
    if (lblMetaTxt) lblMetaTxt.textContent = `Meta: R$ ${meta.toFixed(2).replace('.', ',')} (${perc}%)`;
  } catch (e) {
    if (containerExtrato) {
      containerExtrato.innerHTML = '<div style="text-align: center; color: var(--text-sec); font-size: 11px; padding: 12px 0;">Sem movimentações registradas.</div>';
    }
  }
}

// ============================================================================
// 4. REGISTRO DE EVENTOS DA INTERFACE (DRAWER, MODAIS E SAQUE)
// ============================================================================
function registrarEventosUI() {
  // Toggle Online
  document.getElementById('btnToggleStatusOnline')?.addEventListener('click', alternarStatusOnline);

  // Drawer Lateral
  const drawer = document.getElementById('driverDrawer');
  const overlay = document.getElementById('drawerOverlay');
  document.getElementById('btnAbrirDrawerPerfil')?.addEventListener('click', () => {
    drawer?.classList.add('active');
    overlay?.classList.add('active');
  });
  const fecharDrawer = () => {
    drawer?.classList.remove('active');
    overlay?.classList.remove('active');
  };
  document.getElementById('btnFecharDrawerPerfil')?.addEventListener('click', fecharDrawer);
  overlay?.addEventListener('click', fecharDrawer);

  // Salvar Chave Pix no Drawer
  document.getElementById('btnSalvarChavePix')?.addEventListener('click', async () => {
    const chave = document.getElementById('drawerInputChavePix')?.value?.trim();
    if (!chave) return alert('Digite uma chave Pix válida.');

    try {
      const res = await fetch(`${API_URL}/api/motoristas/chave-pix`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ chavePix: chave })
      });
      if (res.ok) alert('Chave Pix salva com sucesso!');
      else alert('Erro ao registrar chave Pix.');
    } catch (e) {
      alert('Erro de conexão ao salvar chave.');
    }
  });

  // Modal Edição de Perfil
  const modalEdicao = document.getElementById('modalEdicaoPerfil');
  document.getElementById('btnAbrirModalEdicaoPerfil')?.addEventListener('click', () => {
    if (modalEdicao) modalEdicao.style.display = 'flex';
  });
  document.getElementById('btnFecharModalEdicao')?.addEventListener('click', () => {
    if (modalEdicao) modalEdicao.style.display = 'none';
  });
  document.getElementById('btnCancelarEdicao')?.addEventListener('click', () => {
    if (modalEdicao) modalEdicao.style.display = 'none';
  });

  // Salvar Edição de Perfil e Veículo
  document.getElementById('btnSalvarEdicaoPerfil')?.addEventListener('click', async () => {
    const payload = {
      nome: document.getElementById('editNome')?.value,
      telefone: document.getElementById('editTelefone')?.value,
      veiculo_modelo: document.getElementById('editCarroModelo')?.value,
      veiculo_placa: document.getElementById('editCarroPlaca')?.value,
      veiculo_cor: document.getElementById('editCarroCor')?.value,
      veiculo_ano: document.getElementById('editCarroAno')?.value
    };

    try {
      const res = await fetch(`${API_URL}/api/motoristas/perfil`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert('Dados salvos com sucesso!');
        if (modalEdicao) modalEdicao.style.display = 'none';
        carregarPerfil();
      } else {
        alert('Falha ao atualizar dados.');
      }
    } catch (e) {
      alert('Erro de conexão ao salvar perfil.');
    }
  });

  // Modal Saque Pix
  const modalSaque = document.getElementById('modalSaquePix');
  document.getElementById('btnAbrirModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'flex';
  });
  document.getElementById('btnFecharModalSaque')?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'none';
  });

  // Confirmar Solicitação de Saque
  document.getElementById('btnConfirmarSaquePix')?.addEventListener('click', async () => {
    const valor = document.getElementById('saqueValor')?.value;
    const chavePix = document.getElementById('saqueChavePix')?.value;
    const tipoChave = document.getElementById('saqueTipoChave')?.value;

    if (!valor || !chavePix) return alert('Informe o valor e a chave Pix.');

    try {
      const res = await fetch(`${API_URL}/api/motoristas/saque`, {
        method: 'POST',
        headers: obterHeaders(),
        body: JSON.stringify({ valor, chavePix, tipoChave })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.mensagem || 'Saque solicitado com sucesso!');
        if (modalSaque) modalSaque.style.display = 'none';
        carregarPerfil();
      } else {
        alert(data.erro || 'Falha ao solicitar saque.');
      }
    } catch (e) {
      alert('Erro de conexão ao solicitar saque.');
    }
  });

  // Modal Incidentes
  const modalIncidente = document.getElementById('modalReportarIncidente');
  document.getElementById('btnAbrirModalIncidente')?.addEventListener('click', () => {
    if (modalIncidente) modalIncidente.style.display = 'flex';
  });
  document.getElementById('btnFecharModalIncidente')?.addEventListener('click', () => {
    if (modalIncidente) modalIncidente.style.display = 'none';
  });

  // Logout
  document.getElementById('btnLogoutMotorista')?.addEventListener('click', () => {
    if (confirm('Deseja realmente encerrar a sessão de parceiro?')) {
      localStorage.removeItem('huby_token');
      localStorage.removeItem('huby_user_id');
      localStorage.removeItem('huby_motorista_id');
      window.location.href = './index.html';
    }
  });
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  inicializarMapa();
  registrarEventosUI();
  carregarPerfil();
});