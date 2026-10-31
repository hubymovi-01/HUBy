// js/motorista/motorista-radar.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';
import { iniciarAlertaSonoroChamada, pararAlertaSonoroChamada } from './motorista-utilidades.js';

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

// Alternar status online/offline na base de dados
export async function alternarStatusOnline() {
  const token = localStorage.getItem('huby_token');
  try {
    const resp = await fetch(`${API_URL}/api/motoristas/meu-status-online`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    const dados = await resp.json();
    const online = Boolean(dados.online);
    estado.isOnline = online;
    return online;
  } catch (err) {
    console.warn('Erro ao alternar status do motorista:', err);
    return false;
  }
}

export function iniciarRadarChamadas() {
  solicitarPermissaoNotificacoes();
  estado.isOnline = true;

  buscarChamadasPendentes();

  if (!estado.socketRadar) {
    const ioClient = getSocketIO();
    if (ioClient) {
      estado.socketRadar = ioClient(API_URL);

      estado.socketRadar.on('nova_chamada', () => {
        if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise && estado.statusAprovacaoAtual === 'aprovado') {
          buscarChamadasPendentes(true);
        }
      });

      estado.socketRadar.on('alerta_broadcast_geral', (dados) => {
        if (dados.publico === 'todos' || dados.publico === 'motoristas') {
          alert(`📢 COMUNICADO HUBy:\n\n${dados.titulo}\n\n${dados.mensagem}`);
        }
      });
    }
  }

  pararRadarChamadas();
  estado.intervalRadar = setInterval(() => {
    if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
      buscarChamadasPendentes(false);
    }
  }, 4000);
}

export function pararRadarChamadas() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
  pararAlertaSonoroChamada();
}

export async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (estado.pedidoAceitoAtual || estado.pedidoEmAnalise) {
    pararAlertaSonoroChamada();
    return;
  }

  try {
    const cat = estado.categoriaMotorista || 'carro';
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(cat)}`);
    if (!resp.ok) return;

    const pedidos = await resp.json();
    const idsAtuais = Array.isArray(pedidos) ? pedidos.map((p) => p.id) : [];

    if (!idsAtuais.length) {
      pararAlertaSonoroChamada();
      renderizarRadar([]);
      return;
    }

    if (!estado.chamadasAnterioresIds) {
      estado.chamadasAnterioresIds = new Set();
    }

    const existeNovaChamada = idsAtuais.some((id) => !estado.chamadasAnterioresIds.has(id));

    if (existeNovaChamada || tocarSomForcado) {
      // Dispara o bipe de alta atenção contínuo em loop
      iniciarAlertaSonoroChamada();
      dispararNotificacaoNovaChamada(pedidos.length);
    }

    estado.chamadasAnterioresIds = new Set(idsAtuais);
    renderizarRadar(pedidos);
  } catch (err) {
    console.warn('Erro no radar:', err);
  }
}

function renderizarRadar(pedidos) {
  const feedEl = document.getElementById('listaChamadasPendentes');
  if (!feedEl) return;

  if (!pedidos || pedidos.length === 0) {
    feedEl.innerHTML = '<div class="dock-empty" style="text-align: center; color: var(--text-sec); font-size: 12px; padding: 18px 0;">Aguardando novas chamadas na região...</div>';
    return;
  }

  feedEl.innerHTML = pedidos.map((p) => {
    const latOrig = p.coordsOrigem ? p.coordsOrigem[0] : (p.origem_lat || '');
    const lngOrig = p.coordsOrigem ? p.coordsOrigem[1] : (p.origem_lng || '');
    const latDest = p.coordsDestino ? p.coordsDestino[0] : (p.destino_lat || '');
    const lngDest = p.coordsDestino ? p.coordsDestino[1] : (p.destino_lng || '');

    return `
      <div class="order-card" style="border: 2px solid #10B981; background: #0E131F; border-radius: 12px; padding: 14px; margin-bottom: 10px;">
        <div class="order-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span class="order-badge" style="background: rgba(16,185,129,0.2); color: #10B981; font-weight: 800; font-size: 11px; padding: 3px 8px; border-radius: 6px;">
            ${p.sub_tipo_label || 'HUBy'} #${String(p.id).slice(-4)}
          </span>
          <span class="order-price" style="font-size: 17px; font-weight: 900; color: #FFF;">
            R$ ${Number(p.valor_total).toFixed(2).replace('.', ',')}
          </span>
        </div>
        <div class="order-route" style="font-size: 13px; line-height: 1.5; color: #E2E8F0;">
          <span style="display: block;"><strong>Partida:</strong> ${p.origem_endereco || 'Local do passageiro'}</span>
          <span style="display: block;"><strong>Destino:</strong> ${p.destino_endereco || 'Destino no mapa'}</span>
          <small style="color: #38BDF8; font-weight: 700; display: block; margin-top: 4px;">
            📏 ${p.distancia_km || '1.5'} km • ⏱️ ${p.duracao_min || 5} min
          </small>
        </div>
        <button type="button" 
                class="btn-accept-order" 
                style="width: 100%; margin-top: 10px; background: #10B981; color: #022C22; border: none; border-radius: 10px; padding: 12px; font-weight: 900; font-size: 13px; cursor: pointer;"
                data-id="${p.id}" 
                data-preco="${p.valor_total}"
                data-origem="${p.origem_endereco || 'Local do passageiro'}"
                data-destino="${p.destino_endereco}"
                data-dist="${p.distancia_km || '1.5'}"
                data-dur="${p.duracao_min || 5}"
                data-lat-orig="${latOrig}" 
                data-lng-orig="${lngOrig}" 
                data-lat-dest="${latDest}" 
                data-lng-dest="${lngDest}">
          Visualizar Rota no Mapa
        </button>
      </div>
    `;
  }).join('');

  feedEl.querySelectorAll('.btn-accept-order').forEach((btn) => {
    btn.addEventListener('click', () => {
      // Interrompe imediatamente o alerta sonoro contínuo ao interagir
      pararAlertaSonoroChamada();

      const id = btn.getAttribute('data-id');
      const preco = btn.getAttribute('data-preco');
      const origem = btn.getAttribute('data-origem');
      const destino = btn.getAttribute('data-destino');
      const dist = btn.getAttribute('data-dist');
      const dur = btn.getAttribute('data-dur');
      const latOrig = parseFloat(btn.getAttribute('data-lat-orig'));
      const lngOrig = parseFloat(btn.getAttribute('data-lng-orig'));
      const latDest = parseFloat(btn.getAttribute('data-lat-dest'));
      const lngDest = parseFloat(btn.getAttribute('data-lng-dest'));

      const coordsOrig = (!isNaN(latOrig) && !isNaN(lngOrig)) ? [latOrig, lngOrig] : null;
      const coordsDest = (!isNaN(latDest) && !isNaN(lngDest)) ? [latDest, lngDest] : null;

      preVisualizarRotaPedido({
        id,
        preco,
        origem,
        destino,
        dist,
        dur,
        coordsOrig,
        coordsDest
      });
    });
  });
}

export function solicitarPermissaoNotificacoes() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function dispararNotificacaoNovaChamada(qtd) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  if (document.visibilityState === 'hidden') {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.showNotification('🚘 HUBy: Nova corrida disponível!', {
          body: `${qtd} chamada(s) aguardando atendimento. Toque para aceitar.`,
          icon: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=192&q=80',
          vibrate: [300, 150, 300],
          tag: 'nova-chamada-huby',
          renotify: true,
          data: { url: './motorista.html' }
        });
      });
    } else {
      new Notification('🚘 HUBy: Nova corrida disponível!', {
        body: `${qtd} chamada(s) aguardando atendimento. Toque para aceitar.`,
        icon: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=192&q=80'
      });
    }
  }
}