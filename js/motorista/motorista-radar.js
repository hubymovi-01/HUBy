// js/motorista/motorista-radar.js - Radar de Chamadas Sincronizado com Tarifas do Admin
import { API_URL, sonsHUBy, calcularPreco, aplicarObjetoTarifas, TAXA_PLATAFORMA_ATUAL } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let intervalAlertaChamada = null;
let wakeLockSentinela = null;

const getSocketIO = () => (typeof io !== 'undefined' ? io : (window.io || null));

async function requisitarWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinela = await navigator.wakeLock.request('screen');
      wakeLockSentinela.addEventListener('release', () => {
        wakeLockSentinela = null;
      });
    } catch (err) {}
  }
}

function libertarWakeLock() {
  if (wakeLockSentinela) {
    try {
      wakeLockSentinela.release();
    } catch (e) {}
    wakeLockSentinela = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && estado.isOnline) {
    await requisitarWakeLock();
  }
});

export function extrairDadosDoBotao(btn) {
  const km = btn.getAttribute('data-dist') || btn.getAttribute('data-km') || '1.0';
  const dur = btn.getAttribute('data-dur') || Math.round(Number(km) * 2.2);
  const cat = btn.getAttribute('data-cat') || 'carro';

  let precoTotal = parseFloat(btn.getAttribute('data-preco')) || 0;
  if (!precoTotal || precoTotal <= 0) {
    precoTotal = calcularPreco(cat, parseFloat(km) || 1.0).valorTotal;
  }

  const fatorMotorista = Math.max(0.1, (100 - Number(TAXA_PLATAFORMA_ATUAL ?? 15)) / 100);
  const repasse = btn.getAttribute('data-repasse') || (precoTotal * fatorMotorista).toFixed(2).replace('.', ',');

  const latOrig = parseFloat(btn.getAttribute('data-lat-orig'));
  const lngOrig = parseFloat(btn.getAttribute('data-lng-orig'));
  const latDest = parseFloat(btn.getAttribute('data-lat-dest'));
  const lngDest = parseFloat(btn.getAttribute('data-lng-dest'));

  const coordsOrig = (!isNaN(latOrig) && !isNaN(lngOrig)) ? [latOrig, lngOrig] : null;
  const coordsDest = (!isNaN(latDest) && !isNaN(lngDest)) ? [latDest, lngDest] : null;

  return {
    id: btn.getAttribute('data-id'),
    categoria: cat,
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

export function iniciarAlertaSonoroChamada() {
  if (intervalAlertaChamada) return;
  sonsHUBy.tocarAlertaChamada();
  intervalAlertaChamada = setInterval(() => {
    sonsHUBy.tocarAlertaChamada();
  }, 1400);
}

export function pararAlertaSonoroChamada() {
  if (intervalAlertaChamada) {
    clearInterval(intervalAlertaChamada);
    intervalAlertaChamada = null;
  }
}

// Alterna o status Online com 1 único clique e NÃO liga a IA automaticamente
export async function alternarStatusOnline(forcarEstado = null) {
  const token = localStorage.getItem('huby_token');
  const btn = document.getElementById('btnToggleStatusOnline');

  const textoBotao = btn ? btn.textContent || '' : '';
  const visualmenteOnline = textoBotao.includes('Online') && !textoBotao.includes('Ficar Online');
  const novoStatus = typeof forcarEstado === 'boolean' ? forcarEstado : !visualmenteOnline;

  estado.isOnline = novoStatus;
  estado.statusOnline = novoStatus;

  if (btn) {
    if (estado.isOnline) {
      btn.style.background = 'rgba(16, 185, 129, 0.2)';
      btn.style.borderColor = 'var(--emerald)';
      btn.style.color = 'var(--emerald)';
      btn.innerHTML = '<span>🟢</span> <strong>Online</strong>';
      
      if (sonsHUBy?.tocarSucessoAceite) sonsHUBy.tocarSucessoAceite();
      await requisitarWakeLock();
      
      iniciarRadarChamadas();
      notificar('🟢 Você está online! Aguardando corridas na região.', 'sucesso');
    } else {
      btn.style.background = '#1F2937';
      btn.style.borderColor = 'rgba(255,255,255,0.12)';
      btn.style.color = '#94A3B8';
      btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
      
      libertarWakeLock();
      pararRadarChamadas();
      renderizarRadarOffline();
      notificar('⚪ Você ficou offline para corridas.', 'info');
    }
  }

  try {
    await fetch(`${API_URL}/api/pedidos/motoristas/meu-status-online`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ online: novoStatus })
    });
  } catch (err) {
    console.warn('Aviso de rede ao persistir status online:', err);
  }

  return estado.isOnline;
}

export function iniciarRadarChamadas() {
  solicitarPermissaoNotificacoes();

  if (!estado.isOnline) {
    renderizarRadarOffline();
    pararRadarChamadas();
    return;
  }

  buscarChamadasPendentes();

  if (!estado.socketRadar) {
    const ioClient = getSocketIO();
    if (ioClient) {
      const token = localStorage.getItem('huby_token');
      estado.socketRadar = ioClient(API_URL, {
        auth: { token: token || '' }
      });

      estado.socketRadar.on('nova_chamada', () => {
        if (!estado.isOnline) return;
        if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise && estado.statusAprovacaoAtual === 'aprovado') {
          buscarChamadasPendentes(true);
        }
      });

      estado.socketRadar.on('tarifas_atualizadas', (novasTarifas) => {
        aplicarObjetoTarifas(novasTarifas);
        if (estado.isOnline && !estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
          buscarChamadasPendentes(false);
        }
      });

      estado.socketRadar.on('alerta_broadcast_geral', (dados) => {
        if (dados.publico === 'todos' || dados.publico === 'motoristas') {
          notificar(`📢 COMUNICADO: ${dados.titulo} - ${dados.mensagem}`, 'alerta', 6000);
        }
      });
    }
  }

  pararRadarChamadas();
  estado.intervalRadar = setInterval(() => {
    if (!estado.isOnline) {
      pararRadarChamadas();
      return;
    }
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

function renderizarRadarOffline() {
  const feedEl = document.getElementById('listaChamadasPendentes');
  if (feedEl) {
    feedEl.innerHTML = `
      <div class="dock-empty" style="text-align: center; color: #94A3B8; font-size: 13px; padding: 22px 10px; background: rgba(15,23,42,0.6); border: 1px dashed rgba(255,255,255,0.12); border-radius: 12px;">
        <span style="font-size: 24px; display: block; margin-bottom: 6px;">⚪</span>
        <strong>Você está offline</strong><br>
        <span style="font-size: 11.5px; color: #64748B;">Toque no botão "Ficar Online" para receber chamadas de passageiros.</span>
      </div>
    `;
  }
}

export async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (!estado.isOnline) {
    pararAlertaSonoroChamada();
    renderizarRadarOffline();
    return;
  }

  if (estado.pedidoAceitoAtual || estado.pedidoEmAnalise) {
    pararAlertaSonoroChamada();
    return;
  }

  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const cat = estado.categoriaMotorista || 'carro';
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(cat)}&t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (resp.status === 403) {
      estado.isOnline = false;
      libertarWakeLock();
      renderizarRadarOffline();
      pararRadarChamadas();
      return;
    }

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

  const fatorMotorista = Math.max(0.1, (100 - Number(TAXA_PLATAFORMA_ATUAL ?? 15)) / 100);

  feedEl.innerHTML = pedidos.map((p) => {
    const catPedido = String(p.sub_tipo_id || p.tipo || 'carro').toLowerCase();
    const distKm = parseFloat(p.distancia_km || p.distanciaKm || 1.0);
    let valorBruto = Number(p.valor_total || 0);
    if (!valorBruto || valorBruto <= 0) {
      valorBruto = calcularPreco(catPedido, distKm).valorTotal;
    }
    const valorFormatado = valorBruto.toFixed(2).replace('.', ',');
    const repasse = (valorBruto * fatorMotorista).toFixed(2).replace('.', ',');
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
            📏 ${distKm.toFixed(1)} km • ⏱️ ${p.duracao_min || 5} min
          </small>
        </div>
        <button type="button" 
                class="btn-accept-order" 
                style="width: 100%; margin-top: 10px; background: #10B981; color: #022C22; border: none; border-radius: 10px; padding: 12px; font-weight: 900; font-size: 13px; cursor: pointer;"
                data-id="${p.id}" 
                data-cat="${catPedido}"
                data-preco="${valorBruto}"
                data-repasse="${repasse}"
                data-origem="${p.origem_endereco || 'Local do passageiro'}"
                data-destino="${p.destino_endereco}"
                data-dist="${distKm}"
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
  if (!estado.isOnline) return;

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