// ./js/modules/app-motorista.js

import { MapaService } from '../services/mapa-service.js';
import { ApiClient } from '../services/api-client.js';

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  // 1. INICIALIZAÇÃO DO SERVIÇO DE MAPA
  const mapaService = new MapaService('mapaMotorista');
  mapaService.inicializarMapa();

  let motoristaCoords = [-8.358, -41.895];
  let pontoDestinoCoords = null;
  let corridaEmAndamentoId = null;

  // Estado financeiro do dia
  let corridasConcluidas = parseInt(localStorage.getItem('huby_driver_runs') || '0', 10);
  let ganhosHoje = parseFloat(localStorage.getItem('huby_driver_earnings') || '0.00');

  function atualizarPainelGanhos() {
    const txtGanhos = document.getElementById('txtGanhosHoje');
    const txtCorridas = document.getElementById('txtQtdCorridas');
    if (txtGanhos) {
      txtGanhos.textContent = `R$ ${ganhosHoje.toFixed(2).replace('.', ',')}`;
    }
    if (txtCorridas) {
      txtCorridas.textContent = `${corridasConcluidas} corrida${corridasConcluidas === 1 ? '' : 's'}`;
    }
  }

  atualizarPainelGanhos();

  // 2. GPS EM TEMPO REAL COM ACOMPANHAMENTO CONTÍNUO
  mapaService.obterGPSAtual((pos) => {
    motoristaCoords = [pos.lat, pos.lng];

    // Se estiver em rota ativa, recalcula dinamicamente a rota urbana pelas vias
    if (corridaEmAndamentoId && pontoDestinoCoords) {
      mapaService.calcularRotaOSRM(motoristaCoords, pontoDestinoCoords, '#10B981');
    }
  }, true);

  document.getElementById('btnRecenterGPS')?.addEventListener('click', () => {
    mapaService.obterGPSAtual((pos) => {
      motoristaCoords = [pos.lat, pos.lng];
      if (corridaEmAndamentoId && pontoDestinoCoords) {
        mapaService.calcularRotaOSRM(motoristaCoords, pontoDestinoCoords, '#10B981');
      }
    }, false);
  });

  // 3. GESTÃO DE STATUS ONLINE / OFFLINE
  const btnToggleStatus = document.getElementById('btnToggleStatus');
  const txtStatusMotorista = document.getElementById('txtStatusMotorista');
  const badgeRadar = document.getElementById('badgeRadarStatus');
  const txtRadarStatus = document.getElementById('txtRadarStatus');
  const feedChamadas = document.getElementById('feedChamadas');
  let isOnline = true;
  let filtroAtual = 'todos';

  btnToggleStatus?.addEventListener('click', () => {
    isOnline = !isOnline;
    if (isOnline) {
      btnToggleStatus.className = 'btn-toggle-online status-online';
      txtStatusMotorista.textContent = 'ONLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
      if (badgeRadar) badgeRadar.style.display = 'flex';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-toggle-online status-offline';
      txtStatusMotorista.textContent = 'OFFLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'Modo pausa ativo';
      if (feedChamadas) {
        feedChamadas.innerHTML = `
          <div class="radar-empty-box">
            <div class="radar-empty-icon">⏸️</div>
            <div class="radar-empty-title">Modo Offline Ativo</div>
            <div class="radar-empty-sub">Fique online para voltar a receber solicitações em tempo real.</div>
          </div>
        `;
      }
    }
  });

  // 4. FILTROS DE CATEGORIA
  document.querySelectorAll('.filter-pill, .filter-chip').forEach(pill => {
    pill.addEventListener('click', () => {
      if (corridaEmAndamentoId) return;
      document.querySelectorAll('.filter-pill, .filter-chip').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      filtroAtual = pill.getAttribute('data-filter') || 'todos';
      carregarFilaDePedidos();
    });
  });

  function gerarCardHtml(p) {
    const isCargo = p.tipo === 'cargo';
    const isFlash = p.tipo === 'flash';
    const badgeClasse = isCargo ? 'cargo' : (isFlash ? 'flash' : 'viagem');

    return `
      <div class="job-card-premium" id="card-${p.id}">
        <div class="job-header-row">
          <span class="job-type-pill ${badgeClasse}">${p.subTipoLabel || 'HUBy'} #${p.id}</span>
          <span class="job-price-highlight">${p.preco}</span>
        </div>

        <div class="job-address-block">
          <div class="address-line-row">
            <span class="pin-indicator green"></span>
            <div class="address-text-desc">
              ${p.origem}
              <small>Ponto de partida do passageiro</small>
            </div>
          </div>
          <div class="address-line-row">
            <span class="pin-indicator orange"></span>
            <div class="address-text-desc">
              ${p.destino}
              <small>Distância estimada: ${p.distancia || '1.0 km'}</small>
            </div>
          </div>
        </div>

        <div class="job-actions-row">
          <button type="button" class="btn-reject-action" onclick="rejeitarPedido('${p.id}')">Recusar</button>
          <button type="button" class="btn-accept-action" onclick="aceitarPedido('${p.id}')">
            Aceitar Corrida ➔
          </button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="radar-empty-box">
        <div class="radar-empty-icon">📡</div>
        <div class="radar-empty-title">Radar de Chamadas Ativo</div>
        <div class="radar-empty-sub">Aguardando novas solicitações de passageiros e fretes nas proximidades...</div>
      </div>
    `;
  }

  let listaPedidosCache = [];

  // 5. CARREGAMENTO CENTRALIZADO VIA API-CLIENT
  async function carregarFilaDePedidos() {
    if (!feedChamadas || !isOnline || corridaEmAndamentoId) return;

    listaPedidosCache = await ApiClient.obterPedidosPendentes(filtroAtual);

    if (listaPedidosCache.length === 0) {
      feedChamadas.innerHTML = renderEmptyState();
      return;
    }

    feedChamadas.innerHTML = listaPedidosCache.map(p => gerarCardHtml(p)).join('');
  }

  // 6. ACEITAR CORRIDA E INICIAR NAVEGAÇÃO REAL
  window.aceitarPedido = async (id) => {
    const pedido = listaPedidosCache.find(p => String(p.id) === String(id));

    let pontoDest = null;
    if (pedido?.coordsDestino && Array.isArray(pedido.coordsDestino)) {
      pontoDest = pedido.coordsDestino;
    } else if (pedido?.destino && pedido.destino.includes('(')) {
      const partes = pedido.destino.split('(')[1]?.replace(')', '').split(',');
      if (partes && partes.length === 2) {
        pontoDest = [parseFloat(partes[0].trim()), parseFloat(partes[1].trim())];
      }
    }

    if (!pontoDest || isNaN(pontoDest[0])) {
      pontoDest = [motoristaCoords[0] + 0.007, motoristaCoords[1] + 0.007];
    }

    corridaEmAndamentoId = id;
    pontoDestinoCoords = pontoDest;

    // Define o pino de destino e traça a rota viária pelas ruas
    mapaService.definirMarcadorDestino(pontoDest[0], pontoDest[1]);
    await mapaService.calcularRotaOSRM(motoristaCoords, pontoDest, '#10B981');

    // Notifica o backend Render/Neon
    await ApiClient.atualizarStatusCorrida(id, 'em_andamento', {
      motoristaNome: localStorage.getItem('huby_motorista_nome') || 'Motorista Parceiro'
    });

    if (badgeRadar && txtRadarStatus) {
      txtRadarStatus.textContent = `Em rota para entrega #${id}`;
    }

    // Isola o feed e exibe o card de navegação ativa
    if (feedChamadas) {
      feedChamadas.innerHTML = `
        <div class="active-navigation-card">
          <div class="nav-header-row">
            <span class="nav-status-badge">🧭 NAVEGAÇÃO ATIVA #${id}</span>
            <span class="nav-price">${pedido?.preco || 'R$ 16,10'}</span>
          </div>
          
          <div class="nav-destination-title">
            Destino: ${pedido?.destino || 'Ponto selecionado'}
          </div>
          <small style="color: #94A3B8; font-size: 11px;">
            Siga a rota traçada no mapa por vias pavimentadas.
          </small>

          <button type="button" class="btn-complete-delivery" onclick="finalizarCorrida('${id}', '${pedido?.preco || 'R$ 16,10'}')">
            ✅ Concluir Corrida
          </button>
        </div>
      `;
    }
  };

  // 7. FINALIZAR CORRIDA
  window.finalizarCorrida = async (id, precoTexto = 'R$ 0,00') => {
    mapaService.limparRota();
    corridaEmAndamentoId = null;
    pontoDestinoCoords = null;

    // Atualiza o status no backend
    await ApiClient.atualizarStatusCorrida(id, 'concluida');

    // Acumula os ganhos diários
    const valorNumerico = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0;
    ganhosHoje += valorNumerico;
    corridasConcluidas += 1;

    localStorage.setItem('huby_driver_earnings', ganhosHoje.toFixed(2));
    localStorage.setItem('huby_driver_runs', corridasConcluidas.toString());
    atualizarPainelGanhos();

    if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
    mapaService.invalidarTamanho();

    carregarFilaDePedidos();
  };

  // 8. REJEITAR PEDIDO (COM NOTIFICAÇÃO AO SERVIDOR)
  window.rejeitarPedido = async (id) => {
    // 1. Remove da tela imediatamente para resposta visual rápida
    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();

    // 2. Tenta notificar o servidor da recusa
    try {
      await ApiClient.atualizarStatusCorrida(id, 'rejeitada');
    } catch (e) {
      console.warn(`Ocorreu um erro ao rejeitar o pedido #${id} no backend. Removendo localmente apenas.`);
    }

    // 3. Atualiza cache local de fallback
    let pedidosLocais = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    pedidosLocais = pedidosLocais.filter(p => String(p.id) !== String(id));
    localStorage.setItem('huby_pedidos_fila', JSON.stringify(pedidosLocais));

    carregarFilaDePedidos();
  };

  // 9. CICLO DE ATUALIZAÇÃO AUTOMÁTICA
  setInterval(() => {
    if (isOnline && !corridaEmAndamentoId) carregarFilaDePedidos();
  }, 5000);

  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO' && isOnline && !corridaEmAndamentoId) {
        carregarFilaDePedidos();
      }
    };
  } catch (err) {}

  carregarFilaDePedidos();
});