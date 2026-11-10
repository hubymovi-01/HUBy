// js/motorista/motorista-radar.js - Radar de Chamadas e Gamificação Sonora HUBy
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';

let intervalAlertaChamada = null;

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

// ============================================================================
// UTILITÁRIO: EXTRAIR DADOS DO CARD/BOTÃO
// ============================================================================
export function extrairDadosDoBotao(btn) {
  const precoTotal = parseFloat(btn.getAttribute('data-preco')) || 0;
  const repasse = btn.getAttribute('data-repasse') || (precoTotal * 0.85).toFixed(2).replace('.', ',');
  const km = btn.getAttribute('data-dist') || btn.getAttribute('data-km') || '1.0';
  const dur = btn.getAttribute('data-dur') || Math.round(Number(km) * 2.2);

  const latOrig = parseFloat(btn.getAttribute('data-lat-orig'));
  const lngOrig = parseFloat(btn.getAttribute('data-lng-orig'));
  const latDest = parseFloat(btn.getAttribute('data-lat-dest'));
  const lngDest = parseFloat(btn.getAttribute('data-lng-dest'));

  const coordsOrig = (!isNaN(latOrig) && !isNaN(lngOrig)) ? [latOrig, lngOrig] : null;
  const coordsDest = (!isNaN(latDest) && !isNaN(lngDest)) ? [latDest, lngDest] : null;

  return {
    id: btn.getAttribute('data-id'),
    preco: precoTotal,
    valorTotal: precoTotal,
    repasse,
    origem: btn.getAttribute('data-origem') || 'Local do passageiro',
    destino: btn.getAttribute('data-destino') || 'Destino informado',
    dist: km,
    dur,
    coordsOrig,
    coordsDest
  };
}

// Inicia bipe sonoro de alta atenção em pulso até o motorista interagir
export function iniciarAlertaSonoroChamada() {
  if (intervalAlertaChamada) return;
  sonsHUBy.tocarAlertaChamada();
  intervalAlertaChamada = setInterval(() => {
    sonsHUBy.tocarAlertaChamada();
  }, 1400);
}

// Interrompe o som do radar
export function pararAlertaSonoroChamada() {
  if (intervalAlertaChamada) {
    clearInterval(intervalAlertaChamada);
    intervalAlertaChamada = null;
  }
}

// Alternar status online/offline na base de dados e UI
export async function alternarStatusOnline() {
  const token = localStorage.getItem('huby_token');
  const btn = document.getElementById('btnToggleStatusOnline');

  estado.isOnline = !estado.isOnline;
  estado.statusOnline = estado.isOnline;

  if (btn) {
    if (estado.isOnline) {
      btn.style.background = 'rgba(16, 185, 129, 0.2)';
      btn.style.borderColor = 'var(--emerald)';
      btn.style.color = 'var(--emerald)';
      btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      iniciarRadarChamadas();
    } else {
      btn.style.background = '#1F2937';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.style.color = '#94A3B8';
      btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
      pararRadarChamadas();
    }
  }

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/motoristas/meu-status-online`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (resp.ok) {
      const dados = await resp.json().catch(() => ({}));
      if (dados.online !== undefined) {
        estado.isOnline = Boolean(dados.online);
        estado.statusOnline = estado.isOnline;
      }
    }
  } catch (err) {
    console.warn('Aviso de rede ao persistir status online:', err);
  }

  return estado.isOnline;
}

export function iniciarRadarChamadas() {
  solicitarPermissaoNotificacoes();
  estado.isOnline = true;

  buscarChamadasPendentes();

  if (!estado.socketRadar) {
    const ioClient = getSocketIO();
    if (ioClient) {
      const token = localStorage.getItem('huby_token');
      estado.socketRadar = ioClient(API_URL, {
        auth: { token: token || '' }
      });

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

  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const cat = estado.categoriaMotorista || 'carro';
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(cat)}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!resp.ok) return;

    const pedidos = await resp.json();
    const chamadasFiltradas = Array.isArray(pedidos)
      ? pedidos.filter((p) => !estado.pedidosIgnorados?.has(String(p.id)))
      : [];

    const idsAtuais = chamadasFiltradas.map((p) => p.id);

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
      iniciarAlertaSonoroChamada();
      dispararNotificacaoNovaChamada(chamadasFiltradas.length);
    }

    estado.chamadasAnterioresIds = new Set(idsAtuais);
    renderizarRadar(chamadasFiltradas);
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
    const valorBruto = Number(p.valor_total || 0);
    const valorFormatado = valorBruto.toFixed(2).replace('.', ',');
    const repasse = (valorBruto * 0.85).toFixed(2).replace('.', ',');
    const latOrig = p.coordsOrigem ? p.coordsOrigem[0] : (p.origem_lat || '');
    const lngOrig = p.coordsOrigem ? p.coordsOrigem[1] : (p.origem_lng || '');
    const latDest = p.coordsDestino ? p.coordsDestino[0] : (p.destino_lat || '');
    const lngDest = p.coordsDestino ? p.coordsDestino[1] : (p.destino_lng || '');

    return `
      <div class="order-card" style="position: relative; border: 2px solid #10B981; background: #0E131F; border-radius: 12px; padding: 14px; margin-bottom: 10px;">
        <button type="button" class="btn-dispensar-pedido" data-id="${p.id}" title="Dispensar corrida"
          style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.08); border: 1px solid var(--border-dark); color: var(--text-sec); width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; cursor: pointer;">
          ✕
        </button>

        <div class="order-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; padding-right: 30px;">
          <span class="order-badge" style="background: rgba(16,185,129,0.2); color: #10B981; font-weight: 800; font-size: 11px; padding: 3px 8px; border-radius: 6px;">
            ${p.sub_tipo_label || 'HUBy'} #${String(p.id).slice(-4)}
          </span>
          <div style="text-align: right;">
            <span class="order-price" style="font-size: 18px; font-weight: 900; color: #10B981; display: block;">
              R$ ${valorFormatado}
            </span>
            <small style="font-size: 11px; color: #94A3B8; font-weight: 700;">Seu ganho: R$ ${repasse}</small>
          </div>
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
                data-repasse="${repasse}"
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

  feedEl.querySelectorAll('.btn-dispensar-pedido').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!estado.pedidosIgnorados) estado.pedidosIgnorados = new Set();
      estado.pedidosIgnorados.add(String(id));
      buscarChamadasPendentes(false);
    });
  });

  feedEl.querySelectorAll('.btn-accept-order').forEach((btn) => {
    btn.addEventListener('click', () => {
      pararAlertaSonoroChamada();
      sonsHUBy.tocarSucessoAceite();

      const dadosExtraidos = extrairDadosDoBotao(btn);
      preVisualizarRotaPedido(dadosExtraidos);
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