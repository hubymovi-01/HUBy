import { API_URL, CATEGORIAS, calcularPreco, sincronizarTarifasServidor, MULTIPLICADOR_PICO } from './config.js';
import { HubyMapa } from './mapa.js';

let hubyMapa = null;
let coordsDestino = null;
let rotaAtual = null;
let pedidoAtivoId = null;
let intervalPolling = null;
let categoriaSelecionada = 'carro';
let markerMotoristaAaminho = null;

let corridaParaAvaliarId = null;
let notaSelecionada = 5;

document.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('hubySplash');
  if (splash) {
    splash.style.opacity = '0';
    setTimeout(() => {
      if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
    }, 400);
  }

  await sincronizarTarifasServidor();

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
    }, 250);

  } catch (err) {
    console.error('Erro ao inicializar mapa:', err);
  }

  const btnGPS = document.getElementById('btnLocalizarGPS');
  if (btnGPS) {
    btnGPS.addEventListener('click', (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (hubyMapa) {
        hubyMapa.obterGPS((posicaoReal) => {
          if (coordsDestino) {
            hubyMapa.calcularRota([posicaoReal.lat, posicaoReal.lng], coordsDestino).then(rota => {
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

  document.getElementById('btnPedirHuby')?.addEventListener('click', () => {
    if (pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  configurarModalAvaliacao();

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

  if (txtDist) {
    const dinamicaInfo = MULTIPLICADOR_PICO > 1.0 ? ` • ⚡ Dinâmica ${MULTIPLICADOR_PICO}x` : '';
    txtDist.textContent = `${km} km • ${rotaAtual.duracaoMin} min${dinamicaInfo}`;
  }
  if (txtPreco) {
    txtPreco.textContent = precoCalculado.formatado;
  }
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

  const latOrig = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[0].toFixed(4) : '-8.3580';
  const lngOrig = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[1].toFixed(4) : '-42.2460';

  const payload = {
    id: novoId,
    clienteId: clienteId || null,
    tipo: categoriaSelecionada,
    subTipoId: categoriaSelecionada,
    subTipoLabel: precoInfo.categoria,
    origem: `Partida (${latOrig}, ${lngOrig})`,
    destino: `Destino (${coordsDestino[0].toFixed(4)}, ${coordsDestino[1].toFixed(4)})`,
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
  if (painelMotorista) {
    painelMotorista.style.display = 'block';
    
    document.getElementById('lblMotoristaNome').textContent = pedido.motorista_nome || 'Motorista Parceiro';
    document.getElementById('lblMotoristaPlaca').textContent = pedido.motorista_placa || '---';
    document.getElementById('lblMotoristaVeiculo').textContent = pedido.motorista_veiculo || 'Carro HUBy';
    
    const btnLigar = document.getElementById('btnLigarMotorista');
    if (btnLigar) btnLigar.href = `tel:${pedido.motorista_telefone}`;
  }

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'flex';

  configurarChatCliente(pedido.id);
}

// ==========================================
// FUNÇÕES DO CHAT DO PASSAGEIRO
// ==========================================
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
    const { API_URL } = await import('./config.js');
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
    const { API_URL } = await import('./config.js');
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      headers: { 
        ...(token ? { Authorization: `Bearer ${token}` } : {}) 
      }
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
        <div style="display: flex; flex-direction: column; align-items: ${alinhamento}; margin-bottom: 4px;">
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
// OUTRAS FUNÇÕES
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
  if (markerMotoristaAaminho && hubyMapa && hubyMapa.map) {
    hubyMapa.map.removeLayer(markerMotoristaAaminho);
    markerMotoristaAaminho = null;
  }

  const cardStatus = document.getElementById('cardStatusViagem');
  const blocoResumo = document.getElementById('blocoResumo');
  const btn = document.getElementById('btnPedirHuby');
  
  const painelMotorista = document.getElementById('painelMotoristaAceitou');
  if (painelMotorista) painelMotorista.style.display = 'none';

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'none';
  
  const sliderCategorias = document.getElementById('sliderCategorias');
  if (sliderCategorias) sliderCategorias.style.display = 'flex';

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