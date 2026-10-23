import { API_URL, CATEGORIAS, calcularPreco } from './config.js';
import { HubyMapa } from './mapa.js';

let hubyMapa = null;
let coordsDestino = null;
let rotaAtual = null;
let pedidoAtivoId = null;
let intervalPolling = null;
let categoriaSelecionada = 'carro';

let corridaParaAvaliarId = null;
let notaSelecionada = 5;

document.addEventListener('DOMContentLoaded', () => {
  // 1. Garante a remoção da Splash Screen
  const splash = document.getElementById('hubySplash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 400);
  }

  // 2. Inicializar o Mapa Leaflet com tratamento de erro
  try {
    hubyMapa = new HubyMapa('mapaCliente');
    hubyMapa.inicializar(async (rota, coords) => {
      if (pedidoAtivoId) return;
      coordsDestino = [coords.lat, coords.lng];
      rotaAtual = rota;

      const txtDestino = document.getElementById('txtDestinoSelecionado');
      if (txtDestino) {
        txtDestino.textContent = `Destino marcado (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
      }

      atualizarResumoValores();
    });

    setTimeout(() => {
      if (hubyMapa && hubyMapa.map) {
        hubyMapa.map.invalidateSize();
      }
    }, 300);

    hubyMapa.obterGPS();
  } catch (err) {
    console.error('Erro ao inicializar mapa:', err);
  }

  // 3. Botão GPS Recenter
  document.getElementById('btnLocalizarGPS')?.addEventListener('click', () => {
    if (hubyMapa) hubyMapa.obterGPS();
  });

  // 4. Drawer / Menu Lateral e Checagem do Admin
  configurarDrawerMenu();
  verificarAcessoAdminMenu();

  // 5. Histórico Modal
  document.getElementById('btnNavViagens')?.addEventListener('click', carregarEExibirHistoricoModal);
  document.getElementById('menuItemViagens')?.addEventListener('click', () => {
    fecharDrawer();
    carregarEExibirHistoricoModal();
  });
  document.getElementById('btnFecharHistorico')?.addEventListener('click', () => {
    const modal = document.getElementById('modalHistorico');
    if (modal) modal.style.display = 'none';
  });

  // 6. Seleção de Categorias
  const chips = document.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      categoriaSelecionada = chip.getAttribute('data-id') || 'carro';
      atualizarBotaoChamar();
      if (rotaAtual) atualizarResumoValores();
    });
  });

  // 7. Botão Pedir / Cancelar HUBy
  document.getElementById('btnPedirHuby')?.addEventListener('click', () => {
    if (pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  // 8. Modal de Avaliação
  configurarModalAvaliacao();

  // Registo do Service Worker PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

  // Ouvintes do Modal de Pagamentos
  document.getElementById('menuItemPagamentos')?.addEventListener('click', () => {
    fecharDrawer();
    const modal = document.getElementById('modalPagamento');
    if (modal) modal.style.display = 'flex';
  });

  document.getElementById('btnFecharPagamento')?.addEventListener('click', () => {
    const modal = document.getElementById('modalPagamento');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('btnCopiarPix')?.addEventListener('click', () => {
    const input = document.getElementById('chavePixInput');
    if (input) {
      input.select();
      navigator.clipboard.writeText(input.value);
      alert('Chave Pix copiada com sucesso!');
    }
  });
});

// Exibe o botão de Admin no Drawer se a role autenticada for 'admin'
function verificarAcessoAdminMenu() {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');
  const btnAdmin = document.getElementById('menuItemAdmin');

  if (btnAdmin) {
    if (token && role === 'admin') {
      btnAdmin.style.display = 'flex';
    } else {
      btnAdmin.style.display = 'none';
    }
  }
}

function configurarDrawerMenu() {
  const btnMenu = document.getElementById('btnAbrirMenu');
  const backdrop = document.getElementById('menuBackdrop');
  const perfilBox = document.getElementById('drawerPerfilBox');
  const btnAuth = document.getElementById('btnAcaoConta');

  const token = localStorage.getItem('huby_token');
  const userName = localStorage.getItem('huby_user_name') || 'Passageiro HUBy';
  const userPhone = localStorage.getItem('huby_user_phone') || 'Conta cadastrada';

  if (perfilBox && btnAuth) {
    if (token) {
      perfilBox.innerHTML = `
        <div class="profile-card-logged">
          <div class="profile-avatar">${userName.charAt(0).toUpperCase()}</div>
          <div class="profile-meta">
            <strong>${userName}</strong>
            <small>${userPhone}</small>
          </div>
        </div>
      `;
      btnAuth.textContent = 'Sair da Conta';
      btnAuth.classList.add('btn-sair');
      btnAuth.onclick = () => {
        localStorage.clear();
        window.location.reload();
      };
    } else {
      perfilBox.innerHTML = `
        <h4 class="profile-guest-title">Bem-vindo ao HUBy</h4>
        <p class="profile-guest-sub">Entre para pedir viagens mais rápido e ver seu histórico.</p>
      `;
      btnAuth.textContent = 'Entrar ou Cadastrar';
      btnAuth.classList.remove('btn-sair');
      btnAuth.onclick = () => {
        window.location.href = './login.html';
      };
    }
  }

  btnMenu?.addEventListener('click', abrirDrawer);
  backdrop?.addEventListener('click', fecharDrawer);
}

function abrirDrawer() {
  document.getElementById('drawerMenu')?.classList.add('active');
  document.getElementById('menuBackdrop')?.classList.add('active');
}

function fecharDrawer() {
  document.getElementById('drawerMenu')?.classList.remove('active');
  document.getElementById('menuBackdrop')?.classList.remove('active');
}

function configurarModalAvaliacao() {
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(star => {
    star.addEventListener('click', () => {
      notaSelecionada = parseInt(star.getAttribute('data-val'), 10);
      estrelas.forEach((s, idx) => {
        s.style.color = idx < notaSelecionada ? '#F59E0B' : '#4B5563';
      });
    });
  });

  document.getElementById('btnEnviarAvaliacao')?.addEventListener('click', enviarAvaliacaoCorrida);
  document.getElementById('btnPularAvaliacao')?.addEventListener('click', fecharModalAvaliacao);

  const modal = document.getElementById('modalAvaliacao');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) fecharModalAvaliacao();
  });
}

function fecharModalAvaliacao() {
  const modal = document.getElementById('modalAvaliacao');
  if (modal) modal.style.display = 'none';

  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  if (comentarioEl) comentarioEl.value = '';

  notaSelecionada = 5;
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(s => s.style.color = '#F59E0B');

  corridaParaAvaliarId = null;
}

function atualizarBotaoChamar() {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn || pedidoAtivoId) return;

  const labels = {
    carro: 'Chamar HUBy Carro',
    moto: 'Chamar HUBy Moto',
    flash_moto: 'Chamar HUBy Flash',
    cargo_pickup: 'Chamar HUBy Frete'
  };
  btn.textContent = labels[categoriaSelecionada] || 'Chamar HUBy';
}

function atualizarResumoValores() {
  if (!rotaAtual) return;

  const km = rotaAtual.distanciaKm;
  const precoCalculado = calcularPreco(categoriaSelecionada, km);

  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDist) txtDist.textContent = `${km} km • ${rotaAtual.duracaoMin} min`;
  if (txtPreco) txtPreco.textContent = precoCalculado.formatado;
}

async function submeterPedido() {
  if (!rotaAtual || !coordsDestino) {
    alert('Toque no mapa para indicar o destino da viagem.');
    return;
  }

  const token = localStorage.getItem('huby_token');
  const clienteId = localStorage.getItem('huby_user_id');
  const novoId = 'ped_' + Date.now().toString(36);

  const precoInfo = calcularPreco(categoriaSelecionada, rotaAtual.distanciaKm);

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    tipo: categoriaSelecionada,
    subTipoId: categoriaSelecionada,
    subTipoLabel: precoInfo.categoria,
    origem: 'Local de Partida',
    destino: `Lat: ${coordsDestino[0].toFixed(4)}, Lng: ${coordsDestino[1].toFixed(4)}`,
    coordsOrigem: hubyMapa.coordsOrigem,
    coordsDestino: coordsDestino,
    distanciaKm: rotaAtual.distanciaKm,
    duracaoMin: rotaAtual.duracaoMin,
    valorTotal: precoInfo.valorTotal,
    metodoPgto: 'pix_app'
  };

  const btn = document.getElementById('btnPedirHuby');

  try {
    btn.disabled = true;
    btn.textContent = 'A solicitar condutor...';

    const resp = await fetch(`${API_URL}/api/pedidos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error('Falha ao registar pedido na base de dados.');

    pedidoAtivoId = novoId;
    mostrarAguardandoMotorista();
    iniciarPollingStatus();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    atualizarBotaoChamar();
  }
}

function mostrarAguardandoMotorista() {
  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const btn = document.getElementById('btnPedirHuby');

  if (blocoResumo) blocoResumo.style.display = 'none';
  if (cardStatus) cardStatus.style.display = 'block';

  document.getElementById('statusTitulo').textContent = 'Radar Ativo: Procurando motorista...';
  document.getElementById('statusDescricao').textContent = 'O seu pedido foi enviado para os parceiros próximos.';

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Cancelar Chamada';
    btn.style.background = '#ef4444';
  }
}

function iniciarPollingStatus() {
  if (intervalPolling) clearInterval(intervalPolling);

  intervalPolling = setInterval(async () => {
    if (!pedidoAtivoId) return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/status`);
      if (!resp.ok) return;

      const pedido = await resp.json();

      if (pedido.status === 'aceito') {
        document.getElementById('statusTitulo').textContent = '✅ Condutor a caminho!';
        document.getElementById('statusDescricao').innerHTML = `
          <strong>Motorista:</strong> ${pedido.motorista_nome || 'Parceiro HUBy'}<br>
          <strong>Veículo:</strong> ${pedido.motorista_veiculo || ''} (${pedido.motorista_placa || ''})<br>
          <strong>Contato:</strong> ${pedido.motorista_telefone || 'Disponível no app'}
        `;
        const btn = document.getElementById('btnPedirHuby');
        if (btn) btn.style.display = 'none';
      } else if (pedido.status === 'concluido') {
        clearInterval(intervalPolling);
        corridaParaAvaliarId = pedidoAtivoId;
        resetarPainelCliente();

        const modal = document.getElementById('modalAvaliacao');
        if (modal) {
          modal.style.display = 'flex';
        } else {
          alert('Viagem concluída com sucesso!');
        }
      } else if (pedido.status === 'cancelado') {
        clearInterval(intervalPolling);
        alert('A corrida foi cancelada.');
        resetarPainelCliente();
      }
    } catch (e) {
      console.warn('Polling status:', e);
    }
  }, 3000);
}

async function enviarAvaliacaoCorrida() {
  if (!corridaParaAvaliarId) return;

  const token = localStorage.getItem('huby_token');
  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  const comentario = comentarioEl ? comentarioEl.value : '';
  const btn = document.getElementById('btnEnviarAvaliacao');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

    const resp = await fetch(`${API_URL}/api/pedidos/${corridaParaAvaliarId}/avaliar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ nota: notaSelecionada, comentario })
    });

    if (!resp.ok) throw new Error('Não foi possível registrar a avaliação.');

    alert('Obrigado pela sua avaliação!');
  } catch (err) {
    console.warn('Erro ao avaliar:', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Avaliação';
    }
    fecharModalAvaliacao();
  }
}

async function cancelarBusca() {
  if (pedidoAtivoId) {
    const token = localStorage.getItem('huby_token');
    try {
      await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/cancelar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ motivo: 'Cancelado pelo passageiro' })
      });
    } catch (err) {
      console.warn('Erro ao cancelar pedido no backend:', err);
    }
  }

  if (intervalPolling) clearInterval(intervalPolling);
  resetarPainelCliente();
}

function resetarPainelCliente() {
  pedidoAtivoId = null;
  rotaAtual = null;
  coordsDestino = null;

  if (hubyMapa && hubyMapa.rotaLayer && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.rotaLayer);
    hubyMapa.rotaLayer = null;
  }
  if (hubyMapa && hubyMapa.markerDestino && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.markerDestino);
    hubyMapa.markerDestino = null;
  }

  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const btn = document.getElementById('btnPedirHuby');

  if (cardStatus) cardStatus.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'flex';

  const txtDestino = document.getElementById('txtDestinoSelecionado');
  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDestino) txtDestino.textContent = 'Toque no mapa para indicar o destino';
  if (txtDist) txtDist.textContent = '-- km';
  if (txtPreco) txtPreco.textContent = 'R$ 10,00';

  if (btn) {
    btn.disabled = false;
    btn.style.display = 'block';
    btn.style.background = '';
    atualizarBotaoChamar();
  }
}

async function carregarEExibirHistoricoModal() {
  const token = localStorage.getItem('huby_token');
  const modal = document.getElementById('modalHistorico');
  const container = document.getElementById('listaHistoricoCorridas');

  if (!token) {
    window.location.href = './login.html';
    return;
  }

  if (modal) modal.style.display = 'flex';
  if (container) container.innerHTML = '<p class="loading-txt">Carregando viagens...</p>';

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/historico`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) throw new Error('Não foi possível obter o histórico.');

    const viagens = await resp.json();
    if (!viagens || viagens.length === 0) {
      container.innerHTML = '<p class="loading-txt">Você ainda não realizou nenhuma corrida.</p>';
      return;
    }

    container.innerHTML = viagens.map(v => `
      <div class="card-historico-item">
        <div class="h-row">
          <span class="h-title">${v.sub_tipo_label || 'Viagem HUBy'}</span>
          <span class="h-val">R$ ${Number(v.valor_total).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="h-route">${v.distancia_km} km • ${v.status}</div>
      </div>
    `).join('');
  } catch (err) {
    if (container) container.innerHTML = `<p class="loading-txt" style="color: #EF4444;">${err.message}</p>`;
  }
}