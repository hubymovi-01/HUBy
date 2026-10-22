// ./js/modules/app-motorista.js

import { MapaService } from '../services/mapa-service.js';
import { ApiClient } from '../services/api-client.js';

document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('mapaMotorista');
  if (!mapElement) return;

  // 1. INICIALIZAÇÃO BLINDADA DO MAPA DO PARCEIRO
  const mapaService = new MapaService('mapaMotorista');
  mapaService.inicializarMapa();

  // Força ciclos de renderização para evitar mapa em branco no mobile
  const forcarRenderizacaoMapa = () => {
    mapaService.invalidarTamanho();
  };
  requestAnimationFrame(forcarRenderizacaoMapa);
  setTimeout(forcarRenderizacaoMapa, 150);
  setTimeout(forcarRenderizacaoMapa, 450);
  setTimeout(forcarRenderizacaoMapa, 1000);

  let motoristaCoords = [-8.358, -41.895];
  let pontoDestinoCoords = null;
  let corridaEmAndamentoId = null;

  // Estado financeiro do dia
  let corridasConcluidas = parseInt(localStorage.getItem('huby_driver_runs') || '0', 10);
  let ganhosHoje = parseFloat(localStorage.getItem('huby_driver_earnings') || '0.00');

  function atualizarPainelGanhos() {
    const txtGanhos = document.getElementById('txtGanhosHoje') || document.getElementById('statGanhosHoje');
    const txtCorridas = document.getElementById('txtQtdCorridas');
    if (txtGanhos) {
      txtGanhos.innerHTML = `Hoje: <strong>R$ ${ganhosHoje.toFixed(2).replace('.', ',')}</strong> (${corridasConcluidas} fretes)`;
    }
    if (txtCorridas) {
      txtCorridas.textContent = `${corridasConcluidas} corrida${corridasConcluidas === 1 ? '' : 's'}`;
    }
  }

  atualizarPainelGanhos();

  // 2. GPS EM TEMPO REAL COM ACOMPANHAMENTO CONTÍNUO
  mapaService.obterGPSAtual((pos) => {
    motoristaCoords = [pos.lat, pos.lng];

    if (corridaEmAndamentoId && pontoDestinoCoords) {
      mapaService.calcularRotaOSRM(motoristaCoords, pontoDestinoCoords, '#10B981');
    }
    forcarRenderizacaoMapa();
  }, true);

  document.getElementById('btnRecenterGPS')?.addEventListener('click', () => {
    mapaService.obterGPSAtual((pos) => {
      motoristaCoords = [pos.lat, pos.lng];
      if (corridaEmAndamentoId && pontoDestinoCoords) {
        mapaService.calcularRotaOSRM(motoristaCoords, pontoDestinoCoords, '#10B981');
      }
      forcarRenderizacaoMapa();
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
      if (txtStatusMotorista) txtStatusMotorista.textContent = 'ONLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
      if (badgeRadar) badgeRadar.style.display = 'flex';
      carregarFilaDePedidos();
    } else {
      btnToggleStatus.className = 'btn-toggle-online status-offline';
      if (txtStatusMotorista) txtStatusMotorista.textContent = 'OFFLINE';
      if (txtRadarStatus) txtRadarStatus.textContent = 'Modo pausa ativo';
      if (feedChamadas) {
        feedChamadas.innerHTML = `
          <div class="radar-empty-box" style="text-align: center; padding: 20px; color: #94A3B8;">
            <div style="font-size: 28px; margin-bottom: 6px;">⏸️</div>
            <strong style="color: #FFFFFF; font-size: 13px;">Modo Offline Ativo</strong>
            <p style="font-size: 11px; margin-top: 4px;">Fique online para voltar a receber solicitações em tempo real.</p>
          </div>
        `;
      }
    }
    forcarRenderizacaoMapa();
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
      <div class="job-card-premium" id="card-${p.id}" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 12px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span class="job-type-pill ${badgeClasse}" style="font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 6px; background: rgba(16,185,129,0.15); color: #10B981;">
            ${p.subTipoLabel || 'HUBy'} #${p.id}
          </span>
          <span style="font-size: 15px; font-weight: 900; color: #FFFFFF;">${p.preco}</span>
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 12px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981; flex-shrink: 0;"></span>
            <div>${p.origem} <br><small style="color: #64748B;">Ponto de partida</small></div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #FF6B00; flex-shrink: 0;"></span>
            <div>${p.destino} <br><small style="color: #64748B;">Distância: ${p.distancia || '1.0 km'}</small></div>
          </div>
        </div>

        <div style="display: flex; gap: 8px;">
          <button type="button" class="btn-reject-action" onclick="window.rejeitarPedido('${p.id}')" style="flex: 1; padding: 9px; border-radius: 10px; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); color: #EF4444; font-weight: 800; cursor: pointer;">
            Recusar
          </button>
          <button type="button" class="btn-accept-action" onclick="window.aceitarPedido('${p.id}')" style="flex: 2; padding: 9px; border-radius: 10px; border: none; background: #10B981; color: #03251E; font-weight: 900; cursor: pointer;">
            Aceitar Corrida ➔
          </button>
        </div>
      </div>
    `;
  }

  function renderEmptyState() {
    return `
      <div class="radar-empty-box" style="text-align: center; padding: 24px; color: #94A3B8;">
        <div style="font-size: 32px; margin-bottom: 8px;">📡</div>
        <strong style="color: #FFFFFF; font-size: 13px;">Radar de Chamadas Ativo</strong>
        <p style="font-size: 11px; margin-top: 4px;">Aguardando novas solicitações de passageiros e fretes nas proximidades...</p>
      </div>
    `;
  }

  let listaPedidosCache = [];

  // 5. CARREGAMENTO VIA API-CLIENT
  async function carregarFilaDePedidos() {
    if (!feedChamadas || !isOnline || corridaEmAndamentoId) return;

    listaPedidosCache = await ApiClient.obterPedidosPendentes(filtroAtual);

    if (listaPedidosCache.length === 0) {
      feedChamadas.innerHTML = renderEmptyState();
      return;
    }

    feedChamadas.innerHTML = listaPedidosCache.map(p => gerarCardHtml(p)).join('');
  }

  // 6. ACEITAR CORRIDA E INICIAR NAVEGAÇÃO
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

    mapaService.definirMarcadorDestino(pontoDest[0], pontoDest[1]);
    await mapaService.calcularRotaOSRM(motoristaCoords, pontoDest, '#10B981');
    forcarRenderizacaoMapa();

    await ApiClient.atualizarStatusCorrida(id, 'em_andamento', {
      motoristaNome: localStorage.getItem('huby_motorista_nome') || 'Motorista Parceiro'
    });

    if (badgeRadar && txtRadarStatus) {
      txtRadarStatus.textContent = `Em rota para entrega #${id}`;
    }

    if (feedChamadas) {
      feedChamadas.innerHTML = `
        <div class="active-navigation-card" style="background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.3); border-radius: 14px; padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 11px; font-weight: 900; color: #10B981;">🧭 NAVEGAÇÃO ATIVA #${id}</span>
            <span style="font-size: 16px; font-weight: 900; color: #FFFFFF;">${pedido?.preco || 'R$ 16,10'}</span>
          </div>
          
          <div style="font-size: 13px; font-weight: 700; color: #FFFFFF; margin-bottom: 4px;">
            Destino: ${pedido?.destino || 'Ponto selecionado'}
          </div>
          <small style="color: #94A3B8; font-size: 11px; display: block; margin-bottom: 12px;">
            Siga a rota traçada no mapa por vias pavimentadas.
          </small>

          <button type="button" class="btn-complete-delivery" onclick="window.finalizarCorrida('${id}', '${pedido?.preco || 'R$ 16,10'}')" style="width: 100%; padding: 12px; border-radius: 10px; border: none; background: #10B981; color: #03251E; font-weight: 900; font-size: 13px; cursor: pointer;">
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

    // Alinhado com o status do backend ('concluido')
    await ApiClient.atualizarStatusCorrida(id, 'concluido');

    const valorNumerico = parseFloat(precoTexto.replace('R$', '').replace('.', '').replace(',', '.').trim()) || 0;
    ganhosHoje += valorNumerico;
    corridasConcluidas += 1;

    localStorage.setItem('huby_driver_earnings', ganhosHoje.toFixed(2));
    localStorage.setItem('huby_driver_runs', corridasConcluidas.toString());
    atualizarPainelGanhos();

    if (txtRadarStatus) txtRadarStatus.textContent = 'A rastrear chamadas próximas...';
    forcarRenderizacaoMapa();

    carregarFilaDePedidos();
  };

  // 8. REJEITAR PEDIDO (ALINHADO COM STATUS PERMITIDO 'cancelado')
  window.rejeitarPedido = async (id) => {
    const card = document.getElementById(`card-${id}`);
    if (card) card.remove();

    try {
      await ApiClient.atualizarStatusCorrida(id, 'cancelado');
    } catch (e) {
      console.warn(`Erro ao cancelar pedido #${id} no backend.`);
    }

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