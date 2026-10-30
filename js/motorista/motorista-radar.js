// js/motorista/motorista-radar.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

export function iniciarRadarChamadas() {
  if (!estado.isOnline) return;

  // Solicita permissão do navegador para notificações se ainda não concedida
  solicitarPermissaoNotificacoes();

  buscarChamadasPendentes();

  if (!estado.socketRadar) {
    const ioClient = getSocketIO();
    if (ioClient) {
      estado.socketRadar = ioClient(API_URL);

      estado.socketRadar.on('nova_chamada', () => {
        if (estado.isOnline && !estado.pedidoAceitoAtual && !estado.pedidoEmAnalise && estado.statusAprovacaoAtual === 'aprovado') {
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
    if (estado.isOnline && !estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
      buscarChamadasPendentes(false);
    }
  }, 10000);
}

export function pararRadarChamadas() {
  if (estado.intervalRadar) {
    clearInterval(estado.intervalRadar);
    estado.intervalRadar = null;
  }
}

export async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (!estado.isOnline || estado.pedidoAceitoAtual || estado.pedidoEmAnalise || estado.statusAprovacaoAtual !== 'aprovado') {
    return;
  }

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(estado.categoriaMotorista)}`);
    if (!resp.ok) return;

    const pedidos = await resp.json();
    const idsAtuais = pedidos.map((p) => p.id);
    const existeNovaChamada = idsAtuais.some((id) => !estado.chamadasAnterioresIds.has(id));

    if ((existeNovaChamada && pedidos.length > 0) || tocarSomForcado) {
      tocarAlertaSonoro();
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
    feedEl.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  feedEl.innerHTML = pedidos.map((p) => {
    const latOrig = p.coordsOrigem ? p.coordsOrigem[0] : (p.origem_lat || '');
    const lngOrig = p.coordsOrigem ? p.coordsOrigem[1] : (p.origem_lng || '');
    const latDest = p.coordsDestino ? p.coordsDestino[0] : (p.destino_lat || '');
    const lngDest = p.coordsDestino ? p.coordsDestino[1] : (p.destino_lng || '');

    return `
      <div class="order-card">
        <div class="order-card-header">
          <span class="order-badge">${p.sub_tipo_label || 'HUBy'} #${String(p.id).slice(-4)}</span>
          <span class="order-price">R$ ${Number(p.valor_total).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="order-route">
          <span><strong>Partida:</strong> ${p.origem_endereco || 'Local do passageiro'}</span>
          <span><strong>Destino:</strong> ${p.destino_endereco}</span>
          <small style="color: #10B981; font-weight: 700;">${p.distancia_km} km • ${p.duracao_min || 5} min</small>
        </div>
        <button type="button" 
                class="btn-accept-order" 
                data-id="${p.id}" 
                data-preco="${p.valor_total}"
                data-origem="${p.origem_endereco || 'Local do passageiro'}"
                data-destino="${p.destino_endereco}"
                data-dist="${p.distancia_km}"
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

export function tocarAlertaSonoro() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();

    const tocarTom = (freq, inicio, duracao) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + inicio);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + inicio + duracao);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + inicio);
      osc.stop(audioCtx.currentTime + inicio + duracao);
    };

    tocarTom(880, 0, 0.15);
    tocarTom(1174.66, 0.18, 0.25);

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (err) {
    console.warn('Erro sonoro:', err);
  }
}

export function solicitarPermissaoNotificacoes() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function dispararNotificacaoNovaChamada(qtd) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Dispara a notificação apenas se o motorista estiver com a aba em segundo plano ou celular bloqueado
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