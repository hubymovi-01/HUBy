// js/app-cliente.js - Orquestrador Principal HUBy Passageiro
import { API_URL, sonsHUBy, sincronizarTarifasServidor } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=6';
import { estadoCliente } from './cliente/cliente-estado.js';
import { carregarSaldoCarteiraCliente, configurarDrawerMenu, verificarAcessoAdminMenu, fecharDrawer, carregarEExibirHistoricoModal } from './cliente/cliente-ui-menu.js';
import { configurarModalAvaliacao, configurarBotoesGorjeta } from './cliente/cliente-avaliacao.js';
import { atualizarBotaoChamar, atualizarResumoValores, submeterPedido, cancelarBusca, acionarSosCliente } from './cliente/cliente-pedidos.js';
import { configurarMultiplasParadas } from './cliente/cliente-paradas.js';

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

  // 1. Inicializa o Mapa de forma única e segura
  try {
    if (!estadoCliente.hubyMapa) {
      estadoCliente.hubyMapa = new HubyMapa('mapaCliente');
    }

    estadoCliente.hubyMapa.inicializar(async (rota, coords) => {
      if (estadoCliente.pedidoAtivoId) return;
      estadoCliente.coordsDestino = [coords.lat, coords.lng];
      estadoCliente.rotaAtual = rota;

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
      if (estadoCliente.hubyMapa?.map) {
        estadoCliente.hubyMapa.map.invalidateSize();
      }
    }, 250);
  } catch (err) {
    console.warn('Aviso na inicialização do mapa do cliente:', err);
  }

  // 2. Pesquisa de locais
  if (estadoCliente.hubyMapa) {
    configurarPesquisaLocal(estadoCliente.hubyMapa, (rota, coords, nomeCurto) => {
      estadoCliente.rotaAtual = rota;
      estadoCliente.coordsDestino = coords;

      const txtDestino = document.getElementById('txtDestinoSelecionado');
      if (txtDestino) txtDestino.textContent = nomeCurto;

      atualizarResumoValores(); 
    });
  }

  // 3. Ativa as Múltiplas Paradas
  configurarMultiplasParadas();

  // 4. Botão de Centralização GPS
  const btnGPS = document.getElementById('btnLocalizarGPS');
  if (btnGPS) {
    btnGPS.addEventListener('click', (e) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (estadoCliente.hubyMapa) {
        estadoCliente.hubyMapa.obterGPS((posicaoReal) => {
          if (estadoCliente.coordsDestino) {
            estadoCliente.hubyMapa.calcularRota([posicaoReal.lat, posicaoReal.lng], estadoCliente.coordsDestino, '#F59E0B', true).then(rota => {
              estadoCliente.rotaAtual = rota;
              atualizarResumoValores();
            });
          }
        });
      }
    });
  }

  // 5. Drawer e Menus
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

  // 6. Seletor de Categorias
  const chips = document.querySelectorAll('.category-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      estadoCliente.categoriaSelecionada = chip.getAttribute('data-id') || 'carro';
      
      const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
      if (blocoEntrega) {
        blocoEntrega.style.display = (estadoCliente.categoriaSelecionada === 'entrega') ? 'block' : 'none';
      }

      atualizarBotaoChamar();
      if (estadoCliente.rotaAtual) atualizarResumoValores();
    });
  });

  // 7. Botão de Chamada
  document.getElementById('btnPedirHuby')?.addEventListener('click', () => {
    if (estadoCliente.pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  // 8. Modais de Avaliação e Pagamentos
  configurarModalAvaliacao();
  configurarBotoesGorjeta();

  document.getElementById('btnSosCliente')?.addEventListener('click', acionarSosCliente);

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

  // =========================================================================
  // 9. MONITORAMENTO EM TEMPO REAL: MOTORISTA A CAMINHO / EMBARQUE
  // =========================================================================
  conectarSocketEPollingCliente();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

  window.addEventListener('beforeunload', () => {
    if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  });
});

// ============================================================================
// FUNÇÕES DE COMUNICAÇÃO EM TEMPO REAL COM O MOTORISTA
// ============================================================================
function conectarSocketEPollingCliente() {
  const socket = window.io ? window.io(API_URL) : null;

  if (socket) {
    // 1. Motorista Aceitou e está a caminho
    socket.on('corrida_aceita', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || data.pedidoId === pedidoAtivo) {
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarSucessoAceite) {
          sonsHUBy.tocarSucessoAceite();
        }
        renderizarMotoristaChegando(data.motorista);
      }
    });

    // 2. Passageiro a bordo (indo para o destino)
    socket.on('passageiro_a_bordo', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || data.pedidoId === pedidoAtivo) {
        atualizarParaViagemEmAndamento();
      }
    });

    // 3. Corrida concluída pelo condutor
    socket.on('corrida_finalizada', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || data.pedidoId === pedidoAtivo) {
        finalizarViagemCliente(data);
      }
    });
  }

  // Polling de redundância a cada 3.5 segundos
  if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  estadoCliente.intervalPolling = setInterval(async () => {
    const pedidoId = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
    if (!pedidoId) return;

    try {
      const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/status`);
      if (!res.ok) return;
      const p = await res.json();

      if (p.status === 'a_caminho' || p.status === 'aceito' || p.status === 'em_andamento') {
        renderizarMotoristaChegando({
          nome: p.motorista_nome,
          telefone: p.motorista_telefone,
          veiculo: p.motorista_veiculo,
          placa: p.motorista_placa,
          cor: p.veiculo_cor,
          foto: p.motorista_foto,
          avaliacao: p.motorista_avaliacao
        });
      } else if (p.status === 'em_viagem') {
        atualizarParaViagemEmAndamento();
      } else if (p.status === 'concluido') {
        finalizarViagemCliente({ pedidoId });
      }
    } catch (e) { }
  }, 3500);
}

function renderizarMotoristaChegando(mot = {}) {
  // Oculta os blocos de seleção e busca do formulário
  const sliderCategorias = document.getElementById('sliderCategorias');
  const blocoResumo = document.getElementById('blocoResumo');
  const blocoEntrega = document.getElementById('blocoDetalhesEntrega');
  const cardStatusViagem = document.getElementById('cardStatusViagem');
  const btnPedirHuby = document.getElementById('btnPedirHuby');

  if (sliderCategorias) sliderCategorias.style.display = 'none';
  if (blocoResumo) blocoResumo.style.display = 'none';
  if (blocoEntrega) blocoEntrega.style.display = 'none';
  if (cardStatusViagem) cardStatusViagem.style.display = 'none';
  if (btnPedirHuby) btnPedirHuby.style.display = 'none';

  // Utiliza o contêiner oficial do index.html
  let painel = document.getElementById('painelMotoristaAceitou');
  if (!painel) {
    painel = document.getElementById('cardStatusViagemPassageiro');
  }

  if (!painel) return;

  const nome = mot.nome || 'Carol';
  const veiculo = mot.veiculo || 'Chevrolet Onix';
  const placa = (mot.placa || 'ABC1D23').toUpperCase();
  const cor = mot.cor || 'Prata';
  const foto = mot.foto || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80';
  const nota = Number(mot.avaliacao || 5.0).toFixed(1);
  const telefone = mot.telefone || '';

  painel.style.display = 'block';
  painel.innerHTML = `
    <!-- STATUS E CONTADOR DE CHEGADA -->
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(56, 189, 248, 0.12); border: 1.5px solid rgba(56, 189, 248, 0.35); padding: 12px; border-radius: 14px;">
      <div style="color: #38BDF8; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;" id="lblStatusTextoPassageiro">
        🚘 Motorista a caminho!
      </div>
      <div style="color: #FFF; font-size: 18px; font-weight: 900; margin-top: 2px;">
        Chegando para o seu embarque
      </div>
    </div>

    <!-- CARD DETALHADO DO CONDUTOR E VEÍCULO -->
    <div class="driver-card-accepted" style="background: rgba(18, 24, 38, 0.98); border: 1.5px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
      <div class="driver-card-top" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <img src="${foto}" alt="${nome}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid #10B981;">
          <div>
            <h4 style="margin: 0; color: #FFF; font-size: 15px; font-weight: 800;">${nome}</h4>
            <div style="color: #F59E0B; font-weight: 800; font-size: 12px; margin-top: 2px;">
              ⭐ ${nota} <span style="color: #94A3B8; font-weight: 500;">• Motorista Parceira</span>
            </div>
          </div>
        </div>

        <div style="text-align: right;">
          <strong style="color: #FFF; font-size: 13px; display: block;">${veiculo}</strong>
          <small style="color: #94A3B8; font-size: 11px; display: block; margin-bottom: 3px;">Cor: ${cor}</small>
          <div style="display: inline-block; border: 1.5px solid #FFF; border-radius: 4px; background: #FFF; color: #000; font-family: monospace; font-size: 11px; font-weight: 900; padding: 1px 6px;">
            <span style="color:#003399;">BR</span> ${placa}
          </div>
        </div>
      </div>

      <div class="driver-card-actions" style="display: grid; grid-template-columns: ${telefone ? '1fr 1.5fr' : '1fr'}; gap: 8px; margin-top: 10px;">
        ${telefone ? `
          <a href="tel:${telefone}" style="background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); color: #FFF; font-weight: 800; padding: 10px; border-radius: 10px; text-decoration: none; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 5px;">
            📞 Ligar
          </a>
        ` : ''}
        <button type="button" id="btnAbrirChatClienteCard" 
          style="background: rgba(56,189,248,0.18); border: 1px solid #38BDF8; color: #38BDF8; font-weight: 800; padding: 10px; border-radius: 10px; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px;">
          💬 Mensagem
        </button>
      </div>
    </div>
  `;

  // Listener do botão de chat
  document.getElementById('btnAbrirChatClienteCard')?.addEventListener('click', () => {
    const modalChat = document.getElementById('modalChatCorrida');
    if (modalChat) modalChat.style.display = 'flex';
  });

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'flex';
}

function atualizarParaViagemEmAndamento() {
  const lblStatus = document.getElementById('lblStatusTextoPassageiro');
  const boxCronometro = document.getElementById('boxCronometroChegada');

  if (lblStatus) lblStatus.textContent = '🚀 Em viagem ao destino!';
  if (boxCronometro) {
    boxCronometro.style.background = 'rgba(16, 185, 129, 0.12)';
    boxCronometro.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    const subtitulo = boxCronometro.querySelector('div:last-child');
    if (subtitulo) subtitulo.textContent = 'Aproveite a sua viagem com segurança';
  }
}

function finalizarViagemCliente(data) {
  if (estadoCliente.intervalPolling) {
    clearInterval(estadoCliente.intervalPolling);
    estadoCliente.intervalPolling = null;
  }

  const pedidoFinalizadoId = data?.pedidoId || estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  if (pedidoFinalizadoId) {
    estadoCliente.corridaParaAvaliarId = pedidoFinalizadoId;
    localStorage.setItem('huby_ultima_corrida_id', pedidoFinalizadoId);
  }

  const painel = document.getElementById('painelMotoristaAceitou');
  if (painel) {
    painel.style.display = 'none';
    painel.innerHTML = '';
  }

  const dockTemp = document.getElementById('cardStatusViagemPassageiro');
  if (dockTemp) dockTemp.style.display = 'none';

  localStorage.removeItem('huby_pedido_ativo_id');
  estadoCliente.pedidoAtivoId = null;

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) btnChatFlutuante.style.display = 'none';

  if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
    sonsHUBy.tocarMetaBatida();
  }

  const modalAvaliacao = document.getElementById('modalAvaliacao');
  if (modalAvaliacao) {
    modalAvaliacao.style.display = 'flex';
  } else {
    alert('Viagem concluída com sucesso! Obrigado por viajar com a HUBy.');
    location.reload();
  }
}