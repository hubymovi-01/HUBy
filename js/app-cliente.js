import { API_URL, CATEGORIAS, calcularPreco, sincronizarTarifasServidor, MULTIPLICADOR_PICO } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=6'; 

let hubyMapa = null;
let coordsDestino = null;
let rotaAtual = null;
let pedidoAtivoId = null;
let intervalPolling = null;
let categoriaSelecionada = 'carro';
let markerMotoristaAaminho = null;

let corridaParaAvaliarId = null;
let notaSelecionada = 5;
let gorjetaSelecionada = 0;

// Cronómetro de chegada do motorista
let cronometroChegada = null;
let tempoEstimado = 5;

// Saldo da carteira pré-paga
let saldoCarteiraCliente = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('hubySplash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 400);
  }

  await sincronizarTarifasServidor();
  await carregarSaldoCarteiraCliente();

  try {
    hubyMapa = new HubyMapa('mapaCliente');
    hubyMapa.inicializar(async (rota, coords) => {
      if (pedidoAtivoId) return;
      coordsDestino = [coords.lat, coords.lng];
      rotaAtual = rota;

      const txtDestino = document.getElementById('txtDestinoSelecionado');
      const inputPesquisa = document.getElementById('inputPesquisaLocal');
      
      if (txtDestino) {
        txtDestino.textContent = `Destino no mapa (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
      }
      
      if (inputPesquisa) {
        inputPesquisa.value = 'Destino selecionado no mapa';
        const btnLimpar = document.getElementById('btnLimparPesquisa');
        if (btnLimpar) btnLimpar.style.display = 'block';
      }

      atualizarResumoValores();
    });

    setTimeout(() => {
      if (hubyMapa && hubyMapa.map) {
        hubyMapa.map.invalidateSize();
      }
    }, 250);

  } catch (err) {
    console.error('Erro ao inicializar mapa:', err);
  }

  configurarPesquisaLocal(hubyMapa, (rota, coords, nomeCurto) => {
    rotaAtual = rota;
    coordsDestino = coords;

    const txtDestino = document.getElementById('txtDestinoSelecionado');
    if (txtDestino) txtDestino.textContent = nomeCurto;

    atualizarResumoValores(); 
  });

  const btnGPS = document.getElementById('btnLocalizarGPS');
  if (btnGPS) {
    btnGPS.addEventListener('click', (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (hubyMapa) {
        hubyMapa.obterGPS((posicaoReal) => {
          if (coordsDestino) {
            hubyMapa.calcularRota([posicaoReal.lat, posicaoReal.lng], coordsDestino, '#F59E0B', true).then(rota => {
              rotaAtual = rota;
              atualizarResumoValores();
            });
          }
        });
      }
    });
  }

  configurarDrawerMenu();
  verificarAcessoAdminMenu();

  document.getElementById('btnNavViagens')?.addEventListener('click', carregarEExibirHistoricoModal);
  document.getElementById('menuItemViagens')?.addEventListener('click', () => {
    fecharDrawer();
    carregarEExibirHistoricoModal();
  });
  document.getElementById('btnFecharHistorico')?.addEventListener('click', () => {
    const modal = document.getElementById('modalHistorico');
    if (modal) modal.style.display = 'none';
  });

  // Slider de Categorias
  const chips = document.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      categoriaSelecionada = chip.getAttribute('data-id') || 'carro';
      
      const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
      if (blocoEntrega) {
        blocoEntrega.style.display = (categoriaSelecionada === 'entrega') ? 'block' : 'none';
      }

      atualizarBotaoChamar();
      if (rotaAtual) atualizarResumoValores();
    });
  });

  document.getElementById('btnPedirHuby')?.addEventListener('click', () => {
    if (pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  configurarModalAvaliacao();
  configurarBotoesGorjeta();

  // Botão SOS / Pânico do Passageiro
  document.getElementById('btnSosCliente')?.addEventListener('click', acionarSosCliente);
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

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

  window.addEventListener('beforeunload', () => {
    if (intervalPolling) clearInterval(intervalPolling);
  });
});

// ============================================================================
// CARTEIRA PRÉ-PAGA E MÉTODOS DE PAGAMENTO
// ============================================================================
async function carregarSaldoCarteiraCliente() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const res = await fetch(`${API_URL}/api/carteira/saldo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const dados = await res.json();
      saldoCarteiraCliente = Number(dados.saldo || 0);
      const lblSaldo = document.getElementById('lblSaldoCarteira');
      if (lblSaldo) {
        lblSaldo.textContent = `R$ ${saldoCarteiraCliente.toFixed(2).replace('.', ',')}`;
      }
    }
  } catch (err) {
    console.warn('Erro ao consultar saldo da carteira:', err);
  }
}

// ============================================================================
// MENUS E AUTENTICAÇÃO
// ============================================================================
function verificarAcessoAdminMenu() {
  const token = localStorage.getItem('huby_token');
  const btnAdmin = document.getElementById('menuItemAdmin');
  
  if (!btnAdmin) return;
  if (!token) {
    btnAdmin.style.display = 'none';
    return;
  }

  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const payloadUser = JSON.parse(jsonPayload);
    const roleServidor = String(payloadUser.role || payloadUser.tipo || '').toLowerCase();

    if (roleServidor) localStorage.setItem('huby_user_role', roleServidor);

    if (roleServidor === 'admin' || roleServidor === 'administrador') {
      btnAdmin.style.display = 'flex';
    } else {
      btnAdmin.style.display = 'none';
    }
  } catch (e) {
    btnAdmin.style.display = 'none';
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
            <div style="margin-top:4px; font-size:12px; color:#10B981; font-weight:700;">
              Saldo: <span id="lblSaldoCarteira">R$ ${saldoCarteiraCliente.toFixed(2).replace('.', ',')}</span>
            </div>
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
        <p class="profile-guest-sub">Entre para pedir viagens mais rápido e usar sua carteira digital.</p>
      `;
      btnAuth.textContent = 'Entrar ou Cadastrar';
      btnAuth.classList.remove('btn-sair');
      btnAuth.onclick = () => {
        window.location.href = './login.html';
      };
    }
  }

  btnMenu?.addEventListener('click', () => {
    verificarAcessoAdminMenu();
    abrirDrawer();
  });
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

// ============================================================================
// AVALIAÇÕES E GORJETAS
// ============================================================================
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

function configurarBotoesGorjeta() {
  const btnGorjetas = document.querySelectorAll('.btn-gorjeta');
  btnGorjetas.forEach(btn => {
    btn.addEventListener('click', () => {
      btnGorjetas.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      gorjetaSelecionada = Number(btn.getAttribute('data-valor') || 0);
    });
  });
}

function fecharModalAvaliacao() {
  const modal = document.getElementById('modalAvaliacao');
  if (modal) modal.style.display = 'none';

  const comentarioEl = document.getElementById('txtComentarioAvaliacao');
  if (comentarioEl) comentarioEl.value = '';

  notaSelecionada = 5;
  gorjetaSelecionada = 0;
  
  const estrelas = document.querySelectorAll('#estrelasRating span');
  estrelas.forEach(s => s.style.color = '#F59E0B');

  document.querySelectorAll('.btn-gorjeta').forEach(b => b.classList.remove('active'));
  corridaParaAvaliarId = null;
}

// ============================================================================
// DINÂMICA E ESTIMATIVAS
// ============================================================================
function atualizarBotaoChamar() {
  const btn = document.getElementById('btnPedirHuby');
  if (!btn || pedidoAtivoId) return;

  const labels = {
    carro: 'Chamar HUBy Carro',
    moto: 'Chamar HUBy Moto',
    entrega: 'Solicitar Entrega'
  };
  btn.textContent = labels[categoriaSelecionada] || 'Chamar HUBy';
}

function atualizarResumoValores() {
  if (!rotaAtual) return;

  const km = rotaAtual.distanciaKm;
  const precoCalculado = calcularPreco(categoriaSelecionada, km);

  const txtDist = document.getElementById('txtDistanciaEstimada');
  const txtPreco = document.getElementById('txtPrecoEstimado');

  if (txtDist) {
    const dinamicaInfo = MULTIPLICADOR_PICO > 1.0 ? ` • ⚡ Dinâmica ${MULTIPLICADOR_PICO}x` : '';
    txtDist.textContent = `${km} km • ⏱️ ${rotaAtual.duracaoMin} min${dinamicaInfo}`;
  }
  if (txtPreco) {
    txtPreco.textContent = precoCalculado.formatado;
  }
}

// ============================================================================
// SOLICITAÇÃO DE CORRIDA (COM CUPOM E SEGURANÇA)
// ============================================================================
async function submeterPedido() {
  if (!rotaAtual || !coordsDestino) {
    alert('Por favor, indique o destino da viagem.');
    return;
  }

  if (categoriaSelecionada === 'entrega') {
    const recebedorVal = document.getElementById('inputRecebedor')?.value.trim();
    if (!recebedorVal) {
      alert('Para a segurança da sua entrega, informe quem irá receber a encomenda (Nome e Telefone).');
      return;
    }
  }

  const token = localStorage.getItem('huby_token');
  const clienteId = localStorage.getItem('huby_user_id');
  const novoId = 'ped_' + Date.now().toString(36);

  const precoInfo = calcularPreco(categoriaSelecionada, rotaAtual.distanciaKm);
  const cupomCodigo = document.getElementById('inputCupomDesconto')?.value.trim().toUpperCase() || null;

  const latOrig = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[0].toFixed(4) : '-8.3580';
  const lngOrig = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[1].toFixed(4) : '-42.2460';
  
  const txtDestino = document.getElementById('txtDestinoSelecionado');
  let nomeDestino = txtDestino ? txtDestino.textContent : `Destino (${coordsDestino[0].toFixed(4)}, ${coordsDestino[1].toFixed(4)})`;

  if (categoriaSelecionada === 'entrega') {
    const recebedor = document.getElementById('inputRecebedor')?.value || 'Não informado';
    const tipoItemEl = document.getElementById('selectTipoItem');
    const tipoItem = tipoItemEl && tipoItemEl.value !== "" ? tipoItemEl.options[tipoItemEl.selectedIndex].text : 'Encomenda genérica';
    nomeDestino += ` | 📦 Recebedor: ${recebedor} | 🏷️ ${tipoItem}`;
  }

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    tipo: categoriaSelecionada,
    subTipoId: categoriaSelecionada,
    subTipoLabel: precoInfo.categoria,
    origem: `Partida (${latOrig}, ${lngOrig})`,
    destino: nomeDestino,
    coordsOrigem: hubyMapa.coordsOrigem,
    coordsDestino: coordsDestino,
    distanciaKm: rotaAtual.distanciaKm,
    duracaoMin: rotaAtual.duracaoMin,
    valorTotal: precoInfo.valorTotal,
    metodoPgto: 'pix_app',
    cupomCodigo
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
    const dadosResposta = await resp.json();

    if (dadosResposta.desconto > 0) {
      alert(`🎉 Cupom aplicado! Desconto de R$ ${Number(dadosResposta.desconto).toFixed(2).replace('.', ',')}`);
    }

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
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
  const btn = document.getElementById('btnPedirHuby');

  if (blocoResumo) blocoResumo.style.display = 'none';
  if (blocoEntrega) blocoEntrega.style.display = 'none';
  if (cardStatus) cardStatus.style.display = 'block';

  document.getElementById('statusTitulo').textContent = 'Radar Ativo: Procurando motorista...';
  document.getElementById('statusDescricao').textContent = 'O seu pedido foi enviado para os parceiros próximos.';

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Cancelar Chamada';
    btn.style.background = '#ef4444';
  }
}

// ============================================================================
// BOTÃO DE PÂNICO / SOS DO PASSAGEIRO
// ============================================================================
async function acionarSosCliente() {
  if (!pedidoAtivoId) {
    alert('O alerta SOS só pode ser acionado durante uma viagem ativa.');
    return;
  }

  if (!confirm('🚨 ATENÇÃO: Deseja acionar a emergência SOS?\nA central de monitoramento e os contatos de suporte serão alertados com sua localização.')) {
    return;
  }

  const token = localStorage.getItem('huby_token');
  const lat = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[0] : null;
  const lng = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[1] : null;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ lat, lng, relato: 'Emergência acionada pelo passageiro no aplicativo.' })
    });

    if (res.ok) {
      alert('🚨 ALERTA SOS REGISTRADO!\nA equipe da HUBy foi alertada e o suporte está ciente da sua localização.');
    }
  } catch (err) {
    alert('Erro ao transmitir SOS. Ligue imediatamente para a polícia (190).');
  }
}

// ============================================================================
// MONITORAMENTO E ATUALIZAÇÃO DO STATUS
// ============================================================================
function iniciarPollingStatus() {
  if (intervalPolling) clearInterval(intervalPolling);

  intervalPolling = setInterval(async () => {
    if (!pedidoAtivoId) return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAtivoId}/status`);
      if (!resp.ok) return;

      const pedido = await resp.json();

      if (pedido.status === 'aceito' || pedido.status === 'em_viagem') {
        atualizarInterfaceMotoristaAceitou(pedido);

        if (hubyMapa && hubyMapa.map && typeof L !== 'undefined' && !markerMotoristaAaminho) {
          const iconeCondutor = L.divIcon({
            className: 'huby-pin-motorista',
            html: '<div style="width:24px;height:24px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px rgba(16,185,129,0.8);font-size:12px;">🚘</div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          markerMotoristaAaminho = L.marker(hubyMapa.coordsOrigem, { icon: iconeCondutor }).addTo(hubyMapa.map);
        }

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

// ============================================================================
// CARD DO MOTORISTA ACEITO (COM FOTO REAL, PLACA MERCOSUL E AVALIAÇÃO)
// ============================================================================
function atualizarInterfaceMotoristaAceitou(pedido) {
  const sliderCategorias = document.getElementById('sliderCategorias');
  const blocoResumo = document.getElementById('blocoResumo');
  const cardStatusViagem = document.getElementById('cardStatusViagem');
  const btnPedirHuby = document.getElementById('btnPedirHuby');
  
  if (sliderCategorias) sliderCategorias.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'none';
  if (cardStatusViagem) cardStatusViagem.style.display = 'none';
  if (btnPedirHuby) btnPedirHuby.style.display = 'none';

  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  if (!painelMotorista) return;

  painelMotorista.style.display = 'block';

  const foto = pedido.motorista_foto || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80';
  const nome = pedido.motorista_nome || 'Motorista Parceiro';
  const nota = Number(pedido.motorista_avaliacao || 5.0).toFixed(1);
  const totalViagens = pedido.motorista_corridas || 0;
  const modelo = pedido.motorista_veiculo || 'Carro HUBy';
  const cor = pedido.veiculo_cor ? `Cor: ${pedido.veiculo_cor}` : 'Cor padrão';
  const placa = (pedido.motorista_placa || 'HUB-0000').toUpperCase();
  const telefone = pedido.motorista_telefone || '';

  painelMotorista.innerHTML = `
    <!-- CRONÔMETRO DE CHEGADA -->
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 10px; border-radius: 12px;">
      <div style="color: #10B981; font-size: 13px; font-weight: 800; text-transform: uppercase;">
        ${pedido.status === 'aceito' ? '🚘 Motorista a caminho' : '🏁 Viagem em andamento'}
      </div>
      <div style="color: #FFF; font-size: 20px; font-weight: 900; margin-top: 3px;">
        Chega em <span id="txtMinutosChegada" style="color: #38BDF8;">${tempoEstimado} min</span>
      </div>
    </div>

    <!-- CARD DO MOTORISTA -->
    <div class="driver-card-accepted">
      <!-- Topo: Foto, Nome e Reputação -->
      <div class="driver-card-top">
        <div class="driver-avatar-container">
          <img src="${foto}" alt="${nome}" class="driver-avatar-img">
          <span class="badge-verified-driver">✓</span>
        </div>
        <div class="driver-header-meta">
          <h4>${nome}</h4>
          <div class="driver-rating-row">
            <span style="color: #F59E0B; font-weight: 800;">⭐ ${nota}</span>
            <span>•</span>
            <span>${totalViagens} viagens</span>
          </div>
        </div>
      </div>

      <!-- Veículo e Placa Mercosul Estilizada -->
      <div class="driver-vehicle-box">
        <div class="vehicle-desc">
          <strong>${modelo}</strong>
          <small>${cor}</small>
        </div>
        <div class="mercosul-plate-passenger">
          <div class="mercosul-plate-header"><span>BRASIL</span> <span>🇧🇷</span></div>
          <div class="mercosul-plate-body">${placa}</div>
        </div>
      </div>

      <!-- Ações Rápidas -->
      <div class="driver-card-actions">
        ${telefone ? `
          <a href="tel:${telefone}" class="btn-contact-call">
            📞 Ligar
          </a>
        ` : ''}
        <button type="button" id="btnAbrirChatClienteCard" class="btn-contact-chat">
          💬 Mensagem
        </button>
      </div>
    </div>
  `;

  // Gerenciamento do cronômetro regressivo
  if (!cronometroChegada) {
    cronometroChegada = setInterval(() => {
      tempoEstimado--;
      const txtMinutos = document.getElementById('txtMinutosChegada');
      if (tempoEstimado > 0) {
        if (txtMinutos) txtMinutos.textContent = `${tempoEstimado} min`;
      } else {
        if (txtMinutos) txtMinutos.textContent = `A chegar!`;
        clearInterval(cronometroChegada);
      }
    }, 60000);
  }

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'flex';

  configurarChatCliente(pedido.id);
}

// ============================================================================
// CHAT INTERNO DA CORRIDA
// ============================================================================
let chatIntervalCliente = null;

function configurarChatCliente(pedidoId) {
  const btnAbrirChatCard = document.getElementById('btnAbrirChatClienteCard');
  const btnAbrirChatFlut = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  const abrirChat = () => {
    if (modalChat) modalChat.style.display = 'flex';
    carregarMensagensChatCliente(pedidoId);
    if (!chatIntervalCliente) {
      chatIntervalCliente = setInterval(() => carregarMensagensChatCliente(pedidoId), 3000);
    }
  };

  btnAbrirChatCard?.addEventListener('click', abrirChat);
  btnAbrirChatFlut?.addEventListener('click', abrirChat);

  btnFecharChat?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'none';
    if (chatIntervalCliente) {
      clearInterval(chatIntervalCliente);
      chatIntervalCliente = null;
    }
  });

  btnEnviarMsg?.addEventListener('click', () => enviarMensagemChatCliente(pedidoId));
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChatCliente(pedidoId);
  });
}

async function enviarMensagemChatCliente(pedidoId) {
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  if (!txt || !pedidoId) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return; 
  }

  const token = localStorage.getItem('huby_token');
  if (inputMsg) inputMsg.value = '';

  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ mensagem: txt })
    });
    carregarMensagensChatCliente(pedidoId);
  } catch (err) {
    console.warn('Erro ao enviar mensagem:', err);
  }
}

async function carregarMensagensChatCliente(pedidoId) {
  if (!pedidoId) return;
  const token = localStorage.getItem('huby_token');
  
  let meuId = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      meuId = payload.id;
    } catch(e) {}
  }

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();
    
    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat foi iniciado. Evite partilhar dados pessoais.</div>';
    
    msgs.forEach(m => {
      const souEu = (String(m.remetente_id) === String(meuId));
      const alinhamento = souEu ? 'flex-end' : 'flex-start';
      const corFundo = souEu ? '#38BDF8' : '#1F2937';
      const corTexto = souEu ? '#000' : '#FFF';
      const borderRadius = souEu ? '12px 12px 0 12px' : '12px 12px 12px 0';
      
      html += `
        <div style="display: flex; flex-direction: column; align-items: ${alinhamento}; margin-bottom: 6px;">
          <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${m.remetente_nome}</small>
          <div style="background: ${corFundo}; color: ${corTexto}; padding: 8px 12px; border-radius: ${borderRadius}; font-size: 13px; max-width: 80%; word-wrap: break-word;">
            ${m.mensagem}
          </div>
        </div>
      `;
    });

    areaMensagens.innerHTML = html;
    areaMensagens.scrollTop = areaMensagens.scrollHeight; 
  } catch (err) {
    console.warn('Erro ao carregar mensagens:', err);
  }
}

// ============================================================================
// ENVIO DE AVALIAÇÃO E GORJETA
// ============================================================================
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

    // 1. Enviar Avaliação
    await fetch(`${API_URL}/api/pedidos/${corridaParaAvaliarId}/avaliar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ nota: notaSelecionada, comentario })
    });

    // 2. Enviar Gorjeta (se selecionada)
    if (gorjetaSelecionada > 0) {
      const resGorjeta = await fetch(`${API_URL}/api/carteira/gorjeta`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          pedidoId: corridaParaAvaliarId,
          valorGorjeta: gorjetaSelecionada
        })
      });

      if (resGorjeta.ok) {
        await carregarSaldoCarteiraCliente();
      }
    }

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

// ============================================================================
// CANCELAMENTO E RESET
// ============================================================================
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

  if (cronometroChegada) {
    clearInterval(cronometroChegada);
    cronometroChegada = null;
  }
  const divTempo = document.getElementById('boxCronometroChegada');
  if (divTempo) divTempo.remove();

  if (hubyMapa && hubyMapa.rotaLayer && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.rotaLayer);
    hubyMapa.rotaLayer = null;
  }
  if (hubyMapa && hubyMapa.markerDestino && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.markerDestino);
    hubyMapa.markerDestino = null;
  }
  if (markerMotoristaAaminho && hubyMapa && hubyMapa.map) {
    hubyMapa.map.removeLayer(markerMotoristaAaminho);
    markerMotoristaAaminho = null;
  }

  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
  const btn = document.getElementById('btnPedirHuby');
  const inputPesquisa = document.getElementById('inputPesquisaLocal');
  const btnLimpar = document.getElementById('btnLimparPesquisa');
  
  if (inputPesquisa) inputPesquisa.value = '';
  if (btnLimpar) btnLimpar.style.display = 'none';

  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  if (painelMotorista) {
    painelMotorista.style.display = 'none';
    painelMotorista.innerHTML = '';
  }

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'none';
  
  const sliderCategorias = document.getElementById('sliderCategorias');
  if (sliderCategorias) sliderCategorias.style.display = 'flex';

  if (cardStatus) cardStatus.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'flex';
  
  if (blocoEntrega) {
    blocoEntrega.style.display = (categoriaSelecionada === 'entrega') ? 'block' : 'none';
  }

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
  
  if (chatIntervalCliente) {
    clearInterval(chatIntervalCliente);
    chatIntervalCliente = null;
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