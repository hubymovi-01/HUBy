// js/motorista/motorista-radar.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { preVisualizarRotaPedido } from './motorista-corrida.js';
import { iniciarAlertaSonoroChamada, pararAlertaSonoroChamada } from './motorista-utilidades.js';

let intervaloPolling = null;

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
    return dados.online;
  } catch (err) {
    console.warn('Erro ao alternar status do motorista:', err);
    return false;
  }
}

// Inicia a escuta periódica por corridas pendentes na região
export function iniciarRadarChamadas() {
  pararRadarChamadas();

  buscarChamadasDisponiveis();
  intervaloPolling = setInterval(() => {
    // Só procura novas viagens se não estiver em atendimento nem a analisar rota
    if (!estado.pedidoAceitoAtual && !estado.pedidoEmAnalise) {
      buscarChamadasDisponiveis();
    }
  }, 3500);
}

// Para a pesquisa e desliga qualquer som ativo
export function pararRadarChamadas() {
  if (intervaloPolling) {
    clearInterval(intervaloPolling);
    intervaloPolling = null;
  }
  pararAlertaSonoroChamada();
}

async function buscarChamadasDisponiveis() {
  const token = localStorage.getItem('huby_token');
  const feed = document.getElementById('listaChamadasPendentes');
  if (!feed || !token) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return;

    const pedidos = await resp.json();

    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      pararAlertaSonoroChamada();
      feed.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; color: var(--text-sec); font-size: 13px;">
          <div style="font-size: 20px; margin-bottom: 6px;">📡</div>
          Aguardando novas chamadas na região...
        </div>
      `;
      return;
    }

    // Pega na primeira chamada disponível
    const p = pedidos[0];

    // Aciona o alerta sonoro em loop e vibração contínua
    iniciarAlertaSonoroChamada();

    feed.innerHTML = `
      <div class="order-card" style="border: 2px solid #10B981; background: #0E131F;">
        <div class="order-card-header">
          <span class="order-badge" style="background: rgba(16,185,129,0.2); color: #10B981;">NOVA CHAMADA</span>
          <span class="order-price">R$ ${Number(p.valor_total).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="order-route">
          <span><strong>Partida:</strong> ${p.origem_endereco || 'Local informado pelo passageiro'}</span>
          <span><strong>Destino:</strong> ${p.destino_endereco || 'Destino no mapa'}</span>
          <small style="color: #94A3B8; font-weight: 600; display: block; margin-top: 4px;">
            📏 ${p.distancia_km || '1.5'} km • ⏱️ Estimativa: ~${p.duracao_min || 4} min
          </small>
        </div>
        <div style="margin-top: 12px;">
          <button type="button" id="btnAnalisarRotaChamada" style="width: 100%; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 12px; font-weight: 900; cursor: pointer; font-size: 14px;">
            Visualizar Rota no Mapa
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnAnalisarRotaChamada')?.addEventListener('click', () => {
      // Para o bipe sonoro quando o condutor clica para ver a rota
      pararAlertaSonoroChamada();

      preVisualizarRotaPedido({
        id: p.id,
        origem: p.origem_endereco,
        destino: p.destino_endereco,
        coordsOrig: [Number(p.origem_lat), Number(p.origem_lng)],
        coordsDest: [Number(p.destino_lat), Number(p.destino_lng)],
        preco: p.valor_total,
        dist: p.distancia_km || '1.5',
        dur: p.duracao_min || 4
      });
    });

  } catch (err) {
    console.warn('Erro ao sondar chamadas:', err);
  }
}