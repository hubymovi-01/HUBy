// ./js/modules/painel-admin.js

import { MapaService } from '../services/mapa-service.js';
import { ApiClient } from '../services/api-client.js';
import { formatarMoedaBRL } from '../config/tarifas.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. GUARDA DE SEGURANÇA ADMIN
  const tokenAdmin = localStorage.getItem('huby_admin_token');
  const role = localStorage.getItem('huby_user_role');
  
  if (tokenAdmin !== 'token_admin_autorizado_998877' && role !== 'admin') {
    alert('⚠️ Acesso restrito! Autentique-se como administrador para acessar o painel.');
    window.location.replace('./login.html');
    return;
  }

  const mapElement = document.getElementById('mapaAdmin');
  if (!mapElement) return;

  // 2. INICIALIZAR MAPA COM MAPA-SERVICE (DARK MODE NATIVO)
  const mapaService = new MapaService('mapaAdmin');
  mapaService.inicializarMapa();

  // Camada para os marcadores dinâmicos da frota e corridas
  const camadaMarcadoresFrota = L.layerGroup().addTo(mapaService.map);

  // 3. ATUALIZAÇÃO DOS CARDS DE MÉTRICAS EXECUTIVAS
  function atualizarCardsMetricas(pedidos) {
    let faturamentoTotal = 0;
    let comissaoPlataforma = 0;
    let corridasAtivas = 0;

    pedidos.forEach(p => {
      const precoNumerico = parseFloat(
        String(p.preco || '0')
          .replace('R$', '')
          .replace('.', '')
          .replace(',', '.')
          .trim()
      ) || 0;

      faturamentoTotal += precoNumerico;

      // Taxa média de split (12% da plataforma)
      comissaoPlataforma += (precoNumerico * 0.12);

      if (p.status === 'pendente' || p.status === 'em_andamento') {
        corridasAtivas++;
      }
    });

    const elFaturamento = document.getElementById('statFaturamentoTotal');
    const elComissao = document.getElementById('statComissaoTotal');
    const elAtivas = document.getElementById('statCorridasAtivas');
    const elQtdTotal = document.getElementById('statQtdPedidosTotal');

    if (elFaturamento) elFaturamento.textContent = formatarMoedaBRL(faturamentoTotal);
    if (elComissao) elComissao.textContent = formatarMoedaBRL(comissaoPlataforma);
    if (elAtivas) elAtivas.textContent = corridasAtivas;
    if (elQtdTotal) elQtdTotal.textContent = pedidos.length;
  }

  // 4. ATUALIZAR MARCADORES DE CORRIDAS NO MAPA
  function renderizarMarcadoresNoMapa(pedidos) {
    camadaMarcadoresFrota.clearLayers();

    // 4.1. Veículos Parceiros Ativos (Simulação de radar de campo)
    const veiculosCampo = [
      { nome: 'HUBy Carro (Parceiro 01)', coords: [-8.3565, -42.2470], cor: '#10B981', icone: '🚗' },
      { nome: 'HUBy Flash (Moto 02)', coords: [-8.3610, -42.2440], cor: '#38BDF8', icone: '📦' },
      { nome: 'HUBy Cargo (VUC 03)', coords: [-8.3540, -42.2420], cor: '#FF6B00', icone: '🚚' }
    ];

    veiculosCampo.forEach(v => {
      const iconCustom = L.divIcon({
        className: 'marker-frota-admin',
        html: `<div style="background:${v.cor};color:#03251E;font-size:12px;font-weight:900;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${v.cor};border:2px solid #fff;">${v.icone}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      L.marker(v.coords, { icon: iconCustom })
        .addTo(camadaMarcadoresFrota)
        .bindPopup(`<strong>${v.nome}</strong><br><small style="color:#10B981;">● Online e disponível no radar</small>`);
    });

    // 4.2. Pontos de Origem dos Pedidos Ativos
    pedidos.forEach(p => {
      if ((p.status === 'pendente' || p.status === 'em_andamento') && p.coordsOrigem && Array.isArray(p.coordsOrigem)) {
        const isCargo = p.tipo === 'cargo';
        const isFlash = p.tipo === 'flash';
        const cor = isCargo ? '#FF6B00' : (isFlash ? '#38BDF8' : '#10B981');

        L.circleMarker(p.coordsOrigem, {
          radius: 9,
          color: cor,
          fillColor: cor,
          fillOpacity: 0.9,
          weight: 3
        })
        .addTo(camadaMarcadoresFrota)
        .bindPopup(`
          <strong>Chamada #${p.id}</strong><br>
          Tipo: ${p.subTipoLabel || p.tipo}<br>
          Status: <b>${p.status}</b><br>
          Valor: ${p.preco}
        `);
      }
    });
  }

  // 5. CARREGAR E RENDERIZAR FILA DE PEDIDOS EM TEMPO REAL
  async function carregarFilaAdmin() {
    const listaContainer = document.getElementById('listaPedidosAdmin');
    if (!listaContainer) return;

    let pedidos = await ApiClient.obterPedidosPendentes('todos');

    // Se a fila pendente estiver vazia, carrega o histórico do storage
    if (!pedidos || pedidos.length === 0) {
      pedidos = JSON.parse(localStorage.getItem('huby_pedidos_fila') || '[]');
    }

    atualizarCardsMetricas(pedidos);
    renderizarMarcadoresNoMapa(pedidos);

    if (pedidos.length === 0) {
      listaContainer.innerHTML = `
        <div style="text-align: center; padding: 28px; color: #64748B; font-size: 13px;">
          📡 Nenhuma solicitação ativa ou pendente no radar.
        </div>
      `;
      return;
    }

    listaContainer.innerHTML = pedidos.map(p => {
      const isCargo = p.tipo === 'cargo';
      const isFlash = p.tipo === 'flash';
      const iconeClasse = isCargo ? 'cargo' : (isFlash ? 'flash' : 'emerald');
      const emoji = isCargo ? '🚚' : (isFlash ? '📦' : '🚗');
      const statusLabel = p.status === 'em_andamento' ? 'Em Rota' : (p.status === 'concluida' ? 'Concluído' : 'Pendente');
      const statusPillClass = p.status === 'em_andamento' ? 'em-rota' : (p.status === 'concluida' ? 'concluido' : 'pendente');

      return `
        <div class="admin-order-row" id="admin-row-${p.id}">
          <div class="order-type-icon ${iconeClasse}">${emoji}</div>
          <div class="order-meta">
            <strong>#${p.id} - ${p.subTipoLabel || p.sub_tipo_label || 'HUBy Viagem'}</strong>
            <span>Origem: ${p.origem}</span>
            <small>Destino: ${p.destino} (${p.distancia || '1.0 km'})</small>
          </div>
          <div class="order-status-box">
            <span class="status-pill ${statusPillClass}">${statusLabel}</span>
            <strong style="color: #10B981; font-size: 14px;">${p.preco}</strong>
          </div>
        </div>
      `;
    }).join('');
  }

  // Sincronização periódica a cada 5 segundos
  setInterval(carregarFilaAdmin, 5000);

  // Escuta instantânea via BroadcastChannel
  try {
    const hubyChannel = new BroadcastChannel('huby_orders_channel');
    hubyChannel.onmessage = (event) => {
      if (event.data?.tipo === 'NOVO_PEDIDO') {
        carregarFilaAdmin();
      }
    };
  } catch (e) {}

  carregarFilaAdmin();
});