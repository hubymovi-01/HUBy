// js/app-cliente.js - Orquestrador Principal HUBy Passageiro
import { API_URL, sonsHUBy, sincronizarTarifasServidor } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=6';
import { estadoCliente } from './cliente/cliente-estado.js';
import { carregarSaldoCarteiraCliente, configurarDrawerMenu, verificarAcessoAdminMenu, fecharDrawer, carregarEExibirHistoricoModal } from './cliente/cliente-ui-menu.js';
import { configurarModalAvaliacao, configurarBotoesGorjeta } from './cliente/cliente-avaliacao.js';
import { atualizarBotaoChamar, atualizarResumoValores, submeterPedido, cancelarBusca } from './cliente/cliente-pedidos.js';
import { configurarMultiplasParadas } from './cliente/cliente-paradas.js';

let intervalChatCliente = null;
let intervalChecagemPix = null;

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

  // 8. Modais de Avaliação e Pagamentos com Mercado Pago Real
  configurarModalAvaliacao();
  configurarBotoesGorjeta();
  configurarFluxoPagamentoMercadoPago();

  // Configuração do Chat da Viagem no Passageiro
  configurarChatPassageiro();

  // =========================================================================
  // 9. MONITORAMENTO EM TEMPO REAL: MOTORISTA A CAMINHO / EMBARQUE
  // =========================================================================
  conectarSocketEPollingCliente();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

  window.addEventListener('beforeunload', () => {
    if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
    if (intervalChatCliente) clearInterval(intervalChatCliente);
    if (intervalChecagemPix) clearInterval(intervalChecagemPix);
  });
});

// ============================================================================
// FLUXO DE PAGAMENTO PIX DINÂMICO MERCADO PAGO
// ============================================================================
function configurarFluxoPagamentoMercadoPago() {
  const modalPagamento = document.getElementById('modalPagamento');
  const btnFecharPagamento = document.getElementById('btnFecharPagamento');
  const btnMenuPagamento = document.getElementById('menuItemPagamentos');
  const cardPix = document.getElementById('metodoPixCard');
  const cardDinheiro = document.getElementById('metodoDinheiroCard');
  const areaPixMP = document.getElementById('areaPixMercadoPago');
  const btnCopiarPix = document.getElementById('btnCopiarPix');
  const inputChavePix = document.getElementById('chavePixInput');

  function fecharModalPgto() {
    if (modalPagamento) modalPagamento.style.display = 'none';
    if (intervalChecagemPix) {
      clearInterval(intervalChecagemPix);
      intervalChecagemPix = null;
    }
  }

  btnFecharPagamento?.addEventListener('click', fecharModalPgto);

  btnMenuPagamento?.addEventListener('click', (e) => {
    e.preventDefault();
    fecharDrawer();
    if (modalPagamento) modalPagamento.style.display = 'flex';
  });

  cardPix?.addEventListener('click', async () => {
    cardPix.classList.add('active-method');
    cardDinheiro?.classList.remove('active-method');
    if (areaPixMP) areaPixMP.style.display = 'block';

    let valorRecarga = 15.00;
    if (estadoCliente.rotaAtual?.preco) {
      valorRecarga = Number(estadoCliente.rotaAtual.preco);
    }

    const valorPrompt = prompt('Informe o valor para recarga/pagamento via Pix (R$):', valorRecarga.toFixed(2));
    if (!valorPrompt) return;

    const valorFinal = parseFloat(valorPrompt);
    if (!valorFinal || valorFinal <= 0) {
      alert('Informe um valor válido.');
      return;
    }

    await requisitarPixMercadoPago(valorFinal);
  });

  cardDinheiro?.addEventListener('click', () => {
    cardDinheiro.classList.add('active-method');
    cardPix?.classList.remove('active-method');
    if (areaPixMP) areaPixMP.style.display = 'none';
    if (intervalChecagemPix) {
      clearInterval(intervalChecagemPix);
      intervalChecagemPix = null;
    }
    alert('Modo de pagamento presencial selecionado (Dinheiro/Maquininha com o condutor).');
  });

  btnCopiarPix?.addEventListener('click', () => {
    if (inputChavePix && inputChavePix.value) {
      inputChavePix.select();
      navigator.clipboard.writeText(inputChavePix.value);
      btnCopiarPix.textContent = 'Copiado!';
      setTimeout(() => { btnCopiarPix.textContent = 'Copiar'; }, 2000);
    }
  });
}

async function requisitarPixMercadoPago(valor) {
  const token = localStorage.getItem('huby_token');
  const areaPixMP = document.getElementById('areaPixMercadoPago');
  const imgQrCode = document.getElementById('imgPixQrCode');
  const inputChavePix = document.getElementById('chavePixInput');
  const txtStatus = document.getElementById('statusPagamentoPixTexto');

  if (txtStatus) {
    txtStatus.textContent = '🔄 Gerando QR Code oficial no Mercado Pago...';
    txtStatus.style.color = '#38BDF8';
  }

  try {
    const res = await fetch(`${API_URL}/api/carteira/pix/gerar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ valor, pedidoId: estadoCliente.pedidoAtivoId || null })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao gerar cobrança Pix.');

    if (areaPixMP) areaPixMP.style.display = 'block';
    if (imgQrCode && data.qrCodeUrl) imgQrCode.src = data.qrCodeUrl;
    if (inputChavePix && data.copiaCola) inputChavePix.value = data.copiaCola;

    if (txtStatus) {
      txtStatus.textContent = `⏳ Pix de R$ ${Number(valor).toFixed(2).replace('.', ',')} aguardando liquidação...`;
      txtStatus.style.color = '#F59E0B';
    }

    iniciarMonitoramentoPix(data.txid, valor);

  } catch (err) {
    if (txtStatus) {
      txtStatus.textContent = `❌ ${err.message}`;
      txtStatus.style.color = '#EF4444';
    }
  }
}

function iniciarMonitoramentoPix(txid, valor) {
  if (intervalChecagemPix) clearInterval(intervalChecagemPix);
  const token = localStorage.getItem('huby_token');
  const txtStatus = document.getElementById('statusPagamentoPixTexto');

  intervalChecagemPix = setInterval(async () => {
    try {
      const res = await fetch(`${API_URL}/api/carteira/pix/status/${txid}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
      });
      if (!res.ok) return;
      const statusData = await res.json();

      if (statusData.status === 'pago') {
        clearInterval(intervalChecagemPix);
        intervalChecagemPix = null;

        if (txtStatus) {
          txtStatus.textContent = `✅ Pagamento de R$ ${Number(valor).toFixed(2).replace('.', ',')} aprovado!`;
          txtStatus.style.color = '#10B981';
        }

        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
          sonsHUBy.tocarMetaBatida();
        }

        await carregarSaldoCarteiraCliente();

        setTimeout(() => {
          const modalPagamento = document.getElementById('modalPagamento');
          if (modalPagamento) modalPagamento.style.display = 'none';
        }, 2200);
      }
    } catch (e) {}
  }, 3000);
}

// ============================================================================
// MODAL PIX AUTOMÁTICO NA TELA DO PASSAGEIRO (AO FINALIZAR VIAGEM)
// ============================================================================
function exibirModalPixCorridaCliente(pix) {
  // Remove modal anterior caso exista
  document.getElementById('modalPixCorridaAtivaCliente')?.remove();

  const modalHTML = `
    <div id="modalPixCorridaAtivaCliente" style="position:fixed;inset:0;background:rgba(9,13,22,0.92);backdrop-filter:blur(10px);z-index:10010;display:flex;align-items:center;justify-content:center;padding:16px;">
      <div style="background:#111726;border:1.5px solid rgba(139,92,246,0.5);border-radius:20px;max-width:370px;width:100%;padding:22px;text-align:center;box-shadow:0 12px 35px rgba(0,0,0,0.8);color:#FFF;">
        
        <div style="display:inline-block;padding:5px 12px;border-radius:20px;background:rgba(139,92,246,0.2);color:#A78BFA;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
          📱 Pagamento da Corrida
        </div>

        <h3 style="margin:4px 0 2px;font-size:17px;font-weight:900;color:#FFF;">Pague via Pix</h3>
        <p style="color:#94A3B8;font-size:12px;margin:0 0 12px;">Escaneie o QR Code ou use a chave Copia e Cola no app do seu banco</p>

        <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:10px;margin-bottom:14px;">
          <small style="color:#94A3B8;font-size:10px;font-weight:800;text-transform:uppercase;display:block;">Valor Total</small>
          <div style="color:#10B981;font-size:24px;font-weight:900;">R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}</div>
        </div>

        <div style="background:#FFF;padding:12px;border-radius:14px;display:inline-block;box-shadow:0 6px 20px rgba(0,0,0,0.5);">
          <img src="data:image/png;base64,${pix.qr_code_base64}" alt="QR Code Pix" style="width:190px;height:190px;display:block;object-fit:contain;">
        </div>

        <div style="margin-top:14px;">
          <input type="text" id="inputPixCopiaColaCliente" readonly value="${pix.qr_code || ''}" 
            style="width:100%;background:#080C14;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px 10px;color:#94A3B8;font-size:11px;font-family:monospace;outline:none;text-align:center;margin-bottom:8px;">
          
          <button type="button" id="btnCopiarPixCorridaCliente"
            style="width:100%;background:#8B5CF6;border:none;color:#FFF;padding:12px;border-radius:10px;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.2s;">
            📋 Copiar Código Pix
          </button>
        </div>

        <div style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#F59E0B;animation:pulse 1.5s infinite;"></span>
          <small style="color:#94A3B8;font-size:11px;font-weight:700;">Aguardando liquidação no banco...</small>
        </div>

      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const btnCopiar = document.getElementById('btnCopiarPixCorridaCliente');
  btnCopiar?.addEventListener('click', () => {
    if (pix.qr_code) {
      navigator.clipboard.writeText(pix.qr_code);
      btnCopiar.textContent = '✅ Código Pix Copiado!';
      btnCopiar.style.background = '#10B981';
      setTimeout(() => {
        btnCopiar.textContent = '📋 Copiar Código Pix';
        btnCopiar.style.background = '#8B5CF6';
      }, 2500);
    }
  });
}

// ============================================================================
// FUNÇÕES DE COMUNICAÇÃO EM TEMPO REAL COM O MOTORISTA
// ============================================================================
function conectarSocketEPollingCliente() {
  const socket = window.io ? window.io(API_URL) : null;

  if (socket) {
    socket.on('corrida_aceita', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarSucessoAceite) {
          sonsHUBy.tocarSucessoAceite();
        }
        renderizarMotoristaChegando(data.motorista);
      }
    });

    socket.on('passageiro_a_bordo', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        atualizarParaViagemEmAndamento();
      }
    });

    // 1. Escuta a exibição do Pix gerado pelo motorista no encerramento da corrida
    socket.onAny((evento, dados) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (pedidoAtivo && evento === `exibir_pix_corrida_${pedidoAtivo}`) {
        exibirModalPixCorridaCliente(dados);
      }
      if (pedidoAtivo && evento === `corrida_finalizada_${pedidoAtivo}`) {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente({ pedidoId: pedidoAtivo, ...dados });
      }
    });

    // 2. Escuta finalização padrão do pedido
    socket.on('corrida_finalizada', (data) => {
      const pedidoAtivo = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
      if (!pedidoAtivo || String(data.pedidoId) === String(pedidoAtivo)) {
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente(data);
      }
    });
  }

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
        document.getElementById('modalPixCorridaAtivaCliente')?.remove();
        finalizarViagemCliente({ pedidoId });
      }
    } catch (e) { }
  }, 3500);
}

function renderizarMotoristaChegando(mot = {}) {
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
    <div id="boxCronometroChegada" style="text-align: center; margin-bottom: 12px; background: rgba(56, 189, 248, 0.12); border: 1.5px solid rgba(56, 189, 248, 0.35); padding: 12px; border-radius: 14px;">
      <div style="color: #38BDF8; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;" id="lblStatusTextoPassageiro">
        🚘 Motorista a caminho!
      </div>
      <div style="color: #FFF; font-size: 18px; font-weight: 900; margin-top: 2px;">
        Chegando para o seu embarque
      </div>
    </div>

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

  document.getElementById('btnAbrirChatClienteCard')?.addEventListener('click', () => {
    abrirModalChat();
  });

  const btnChatFlutuante = document.getElementById('btnAbrirChat');
  if (btnChatFlutuante) {
    btnChatFlutuante.style.display = 'flex';
    btnChatFlutuante.onclick = abrirModalChat;
  }
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

// ============================================================================
// CHAT DO PASSAGEIRO
// ============================================================================
function configurarChatPassageiro() {
  const btnFechar = document.getElementById('btnFecharChat');
  const btnEnviar = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  btnFechar?.addEventListener('click', () => {
    const modalChat = document.getElementById('modalChatCorrida');
    if (modalChat) modalChat.style.display = 'none';
    if (intervalChatCliente) {
      clearInterval(intervalChatCliente);
      intervalChatCliente = null;
    }
  });

  btnEnviar?.addEventListener('click', enviarMensagemPassageiro);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemPassageiro();
  });
}

function abrirModalChat() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) {
    modalChat.style.display = 'flex';
    sincronizarChatPassageiro();
    if (!intervalChatCliente) {
      intervalChatCliente = setInterval(sincronizarChatPassageiro, 3000);
    }
  }
}

async function sincronizarChatPassageiro() {
  const pedidoId = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  const token = localStorage.getItem('huby_token');
  const area = document.getElementById('chatAreaMensagens');
  if (!pedidoId || !area) return;

  try {
    const res = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!res.ok) return;
    const msgs = await res.json();

    const meuId = localStorage.getItem('huby_user_id');
    area.innerHTML = msgs.map(m => {
      const souEu = m.remetente_id === meuId;
      return `
        <div style="align-self: ${souEu ? 'flex-end' : 'flex-start'}; max-width: 80%; background: ${souEu ? '#10B981' : '#1E293B'}; color: ${souEu ? '#02261C' : '#FFF'}; font-weight: 600; padding: 8px 12px; border-radius: 12px; font-size: 13px;">
          <small style="display:block; font-size:9px; opacity:0.8; margin-bottom:2px;">${m.remetente_nome || 'Mensagem'}</small>
          ${m.mensagem}
        </div>
      `;
    }).join('');
    area.scrollTop = area.scrollHeight;
  } catch (e) { }
}

async function enviarMensagemPassageiro() {
  const input = document.getElementById('inputChatMsg');
  const msg = input?.value?.trim();
  const pedidoId = estadoCliente.pedidoAtivoId || localStorage.getItem('huby_pedido_ativo_id');
  const token = localStorage.getItem('huby_token');
  const meuNome = localStorage.getItem('huby_user_name') || 'Passageiro';

  if (!msg || !pedidoId) return;

  try {
    input.value = '';
    await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ mensagem: msg, remetenteNome: meuNome })
    });
    sincronizarChatPassageiro();
  } catch (e) { }
}