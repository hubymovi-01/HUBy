// js/app-cliente.js - Orquestrador Principal HUBy Passageiro
import { sincronizarTarifasServidor } from './config.js';
import { HubyMapa } from './mapa.js';
import { configurarPesquisaLocal } from './pesquisa.js?v=6';
import { estadoCliente } from './cliente/cliente-estado.js';
import { carregarSaldoCarteiraCliente, configurarDrawerMenu, verificarAcessoAdminMenu, fecharDrawer, carregarEExibirHistoricoModal } from './cliente/cliente-ui-menu.js';
import { configurarModalAvaliacao, configurarBotoesGorjeta } from './cliente/cliente-avaliacao.js';
import { atualizarBotaoChamar, atualizarResumoValores, submeterPedido, cancelarBusca, acionarSosCliente } from './cliente/cliente-pedidos.js';

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

  // 1. Inicializa o Mapa
  try {
    estadoCliente.hubyMapa = new HubyMapa('mapaCliente');
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
    console.error('Erro ao inicializar mapa:', err);
  }

  // 2. Pesquisa de locais
  configurarPesquisaLocal(estadoCliente.hubyMapa, (rota, coords, nomeCurto) => {
    estadoCliente.rotaAtual = rota;
    estadoCliente.coordsDestino = coords;

    const txtDestino = document.getElementById('txtDestinoSelecionado');
    if (txtDestino) txtDestino.textContent = nomeCurto;

    atualizarResumoValores(); 
  });

  // 3. Botão GPS
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

  // 4. Drawer e Menus
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

  // 5. Seletor de Categorias
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

  // 6. Botão de Chamada
  document.getElementById('btnPedirHuby')?.addEventListener('click', () => {
    if (estadoCliente.pedidoAtivoId) {
      cancelarBusca();
    } else {
      submeterPedido();
    }
  });

  // 7. Modais de Avaliação e Pagamentos
  configurarModalAvaliacao();
  configurarBotoesGorjeta();

  document.getElementById('btnSosCliente')?.addEventListener('click', acionarSosCliente);

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }

  window.addEventListener('beforeunload', () => {
    if (estadoCliente.intervalPolling) clearInterval(estadoCliente.intervalPolling);
  });
});