// js/motorista/motorista-corrida.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';
import { carregarGanhosHoje } from './motorista-ganhos.js';
import { carregarPerfilCompleto } from './motorista-perfil.js';
import { fecharChat } from './motorista-chat.js';

export async function preVisualizarRotaPedido(dados) {
  estado.pedidoEmAnalise = dados;
  pararRadarChamadas();

  if (estado.hubyMapa?.rotaLayer && estado.hubyMapa.map) {
    estado.hubyMapa.map.removeLayer(estado.hubyMapa.rotaLayer);
    estado.hubyMapa.rotaLayer = null;
  }

  if (dados.coordsOrig && dados.coordsDest && estado.hubyMapa) {
    try {
      await estado.hubyMapa.calcularRota(dados.coordsOrig, dados.coordsDest, '#38BDF8');
    } catch (err) {
      console.warn('Erro ao traçar rota:', err);
    }
  }

  const feed = document.getElementById('listaChamadasPendentes');
  if (feed) {
    feed.innerHTML = `
      <div class="order-card" style="border: 2px solid #F59E0B; background: #0E131F;">
        <div class="order-card-header">
          <span class="order-badge" style="background: rgba(245,158,11,0.2); color: #F59E0B;">🔍 ANALISANDO ROTA</span>
          <span class="order-price">R$ ${Number(dados.preco).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="order-route">
          <span style="display: block; color: #F59E0B; font-weight: 800; font-size: 13px; margin-bottom: 4px;">
            Confira o trajeto traçado no mapa antes de aceitar
          </span>
          <span><strong>Origem:</strong> ${dados.origem}</span>
          <span><strong>Destino:</strong> ${dados.destino}</span>
          <small style="color: #38BDF8; font-weight: 700; display: block; margin-top: 4px;">
            📏 ${dados.dist} km • ⏱️ Estimativa: ~${dados.dur} min
          </small>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button type="button" id="btnRecusarPrevia" style="flex: 1; background: #1F2937; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 12px; font-weight: 700; cursor: pointer;">
            ✕ Voltar
          </button>
          <button type="button" id="btnConfirmarAceite" style="flex: 1.3; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 12px; font-weight: 900; cursor: pointer; font-size: 14px;">
            ✓ Aceitar Viagem
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnRecusarPrevia')?.addEventListener('click', cancelarPrevia);
    document.getElementById('btnConfirmarAceite')?.addEventListener('click', () => {
      efetivarAceiteChamada(dados);
    });
  }
}

export function cancelarPrevia() {
  estado.pedidoEmAnalise = null;
  if (estado.hubyMapa?.rotaLayer && estado.hubyMapa.map) {
    estado.hubyMapa.map.removeLayer(estado.hubyMapa.rotaLayer);
    estado.hubyMapa.rotaLayer = null;
  }
  iniciarRadarChamadas();
}

async function efetivarAceiteChamada(dados) {
  const token = localStorage.getItem('huby_token');
  const btn = document.getElementById('btnConfirmarAceite');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Confirmando...';
    }

    const resp = await fetch(`${API_URL}/api/pedidos/${dados.id}/aceitar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Não foi possível aceitar a chamada.');

    estado.pedidoAceitoAtual = data.pedido || {};
    estado.pedidoAceitoAtual.coordsOrigem = dados.coordsOrig;
    estado.pedidoAceitoAtual.coordsDestino = dados.coordsDest;
    estado.pedidoAceitoAtual.origem_lat = dados.coordsOrig ? dados.coordsOrig[0] : null;
    estado.pedidoAceitoAtual.origem_lng = dados.coordsOrig ? dados.coordsOrig[1] : null;
    estado.pedidoAceitoAtual.destino_lat = dados.coordsDest ? dados.coordsDest[0] : null;
    estado.pedidoAceitoAtual.destino_lng = dados.coordsDest ? dados.coordsDest[1] : null;
    estado.pedidoAceitoAtual.origem_endereco = dados.origem;
    estado.pedidoAceitoAtual.destino_endereco = dados.destino;
    estado.pedidoAceitoAtual.valor_total = dados.preco;
    estado.pedidoAceitoAtual.distancia_km = dados.dist;
    estado.pedidoAceitoAtual.duracao_min = dados.dur;

    estado.pedidoEmAnalise = null;
    estado.etapaCorridaAtual = 'a_caminho';
    estado.modoUltimaViagem = false;

    const btnChat = document.getElementById('btnAbrirChat');
    if (btnChat) btnChat.style.display = 'flex';

    if (dados.coordsOrig && estado.hubyMapa) {
      if (estado.hubyMapa.coordsOrigem) {
        await estado.hubyMapa.calcularRota(estado.hubyMapa.coordsOrigem, dados.coordsOrig, '#38BDF8');
      }
      estado.hubyMapa.obterGPS(async (pos) => {
        try {
          const r = await estado.hubyMapa.calcularRota([pos.lat, pos.lng], dados.coordsOrig, '#38BDF8');
          const lbl = document.getElementById('lblTempoPassageiro');
          if (lbl) lbl.innerHTML = `⏳ Chega ao passageiro em <span style="font-size:18px;">${r.duracaoMin} min</span>`;
        } catch (e) {}
      });
    }

    renderizarCardEtapa();
  } catch (err) {
    alert(err.message);
    cancelarPrevia();
  }
}

export function renderizarCardEtapa() {
  const feed = document.getElementById('listaChamadasPendentes');
  if (!feed || !estado.pedidoAceitoAtual) return;

  const estaACaminho = (estado.etapaCorridaAtual === 'a_caminho');

  // Coordenadas para rota externa (Origem ou Destino dependendo da etapa)
  const coordsAlvo = estaACaminho 
    ? (estado.pedidoAceitoAtual.coordsOrigem || [estado.pedidoAceitoAtual.origem_lat, estado.pedidoAceitoAtual.origem_lng])
    : (estado.pedidoAceitoAtual.coordsDestino || [estado.pedidoAceitoAtual.destino_lat, estado.pedidoAceitoAtual.destino_lng]);

  const latAlvo = coordsAlvo ? coordsAlvo[0] : null;
  const lngAlvo = coordsAlvo ? coordsAlvo[1] : null;

  // Links universais para Google Maps e Waze
  const linkGoogleMaps = (latAlvo && lngAlvo)
    ? `https://www.google.com/maps/dir/?api=1&destination=${latAlvo},${lngAlvo}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(estaACaminho ? (estado.pedidoAceitoAtual.origem_endereco || '') : estado.pedidoAceitoAtual.destino_endereco)}`;

  const linkWaze = (latAlvo && lngAlvo)
    ? `https://waze.com/ul?ll=${latAlvo},${lngAlvo}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(estaACaminho ? (estado.pedidoAceitoAtual.origem_endereco || '') : estado.pedidoAceitoAtual.destino_endereco)}`;

  feed.innerHTML = `
    <div class="order-card" style="border-color: ${estaACaminho ? '#38BDF8' : '#10B981'};">
      <div class="order-card-header">
        <span class="order-badge" style="background: ${estaACaminho ? 'rgba(56,189,248,0.2)' : 'rgba(16,185,129,0.2)'}; color: ${estaACaminho ? '#38BDF8' : '#10B981'};">
          ${estaACaminho ? 'A CAMINHO DO CLIENTE' : 'EM CORRIDA'}
        </span>
        <span class="order-price">R$ ${Number(estado.pedidoAceitoAtual.valor_total).toFixed(2).replace('.', ',')}</span>
      </div>
      <div class="order-route">
        <span style="display: block; color: ${estaACaminho ? '#38BDF8' : '#10B981'}; font-weight: 800; font-size: 14px; margin-bottom: 4px;" id="lblTempoPassageiro">
          ${estaACaminho ? '📍 A caminho do local de embarque...' : '🏁 A caminho do destino final!'}
        </span>
        <span><strong>Recolha:</strong> ${estado.pedidoAceitoAtual.origem_endereco || 'Local do passageiro'}</span>
        <span><strong>Destino:</strong> ${estado.pedidoAceitoAtual.destino_endereco}</span>
        <small style="color: #94A3B8; font-weight: 600; display: block; margin-top: 4px;">
          ⏱️ Viagem: ~${estado.pedidoAceitoAtual.duracao_min || 5} min • ${estado.pedidoAceitoAtual.distancia_km} km
        </small>
      </div>

      <!-- BOTÕES DE NAVEGAÇÃO EXTERNA (GOOGLE MAPS E WAZE) -->
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <a href="${linkGoogleMaps}" target="_blank" rel="noopener noreferrer" 
          style="flex: 1; text-decoration: none; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); color: #38BDF8; border-radius: 8px; padding: 9px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Google Maps
        </a>
        <a href="${linkWaze}" target="_blank" rel="noopener noreferrer" 
          style="flex: 1; text-decoration: none; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); color: #10B981; border-radius: 8px; padding: 9px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🚗 Waze
        </a>
      </div>

      <!-- BOTÃO PRINCIPAL DE AÇÃO -->
      <div style="margin-top: 10px;">
        ${estaACaminho ? `
          <button type="button" id="btnIniciarViagemUnico" style="width: 100%; background: #2563EB; color: #FFF; border: none; border-radius: 10px; padding: 14px; font-weight: 900; font-size: 14px; cursor: pointer;">
            📍 Iniciar Viagem (Passageiro a Bordo)
          </button>
        ` : `
          <button type="button" id="btnConcluirViagemUnico" style="width: 100%; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 14px; font-weight: 900; font-size: 14px; cursor: pointer;">
            ✅ Concluir Viagem
          </button>
        `}
      </div>

      <!-- BOTÃO ÚLTIMA VIAGEM -->
      <div style="margin-top: 8px;">
        <button type="button" id="btnToggleUltimaViagem" style="width: 100%; background: ${estado.modoUltimaViagem ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${estado.modoUltimaViagem ? '#F59E0B' : 'rgba(255,255,255,0.08)'}; color: ${estado.modoUltimaViagem ? '#F59E0B' : 'var(--text-sec)'}; padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
          ${estado.modoUltimaViagem ? '🛑 Última Viagem Ativa (Ficará Offline ao terminar)' : '☕ Parar de receber chamadas após esta viagem'}
        </button>
      </div>

      <div style="display: flex; gap: 8px; margin-top: 8px;">
        <button type="button" id="btnCancelarPeloMotorista" style="flex: 1; background: transparent; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 10px; font-weight: 700; cursor: pointer;">
          Cancelar
        </button>
        <button type="button" id="btnSosMotorista" style="flex: 1; background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid #EF4444; border-radius: 10px; padding: 10px; font-weight: 800; cursor: pointer;">
          🚨 SOS Emergência
        </button>
      </div>
    </div>
  `;

  // Listener da Última Viagem
  document.getElementById('btnToggleUltimaViagem')?.addEventListener('click', () => {
    estado.modoUltimaViagem = !estado.modoUltimaViagem;
    renderizarCardEtapa();
  });

  document.getElementById('btnCancelarPeloMotorista')?.addEventListener('click', cancelarCorridaAtual);

  if (estaACaminho) {
    document.getElementById('btnIniciarViagemUnico')?.addEventListener('click', async () => {
      estado.etapaCorridaAtual = 'em_viagem';

      // 1. Extração segura das coordenadas de Destino
      let destCoords = estado.pedidoAceitoAtual.coordsDestino;
      if (!destCoords || !Array.isArray(destCoords)) {
        const dLat = parseFloat(estado.pedidoAceitoAtual.destino_lat || estado.pedidoAceitoAtual.destinoLat);
        const dLng = parseFloat(estado.pedidoAceitoAtual.destino_lng || estado.pedidoAceitoAtual.destinoLng);
        if (!isNaN(dLat) && !isNaN(dLng)) {
          destCoords = [dLat, dLng];
          estado.pedidoAceitoAtual.coordsDestino = destCoords;
        }
      }

      // 2. Extração segura do ponto de partida (GPS atual do condutor ou ponto de embarque)
      let origCoords = estado.hubyMapa?.coordsOrigem;
      if (!origCoords || !Array.isArray(origCoords)) {
        origCoords = estado.pedidoAceitoAtual.coordsOrigem;
        if (!origCoords || !Array.isArray(origCoords)) {
          const oLat = parseFloat(estado.pedidoAceitoAtual.origem_lat || estado.pedidoAceitoAtual.origemLat);
          const oLng = parseFloat(estado.pedidoAceitoAtual.origem_lng || estado.pedidoAceitoAtual.origemLng);
          if (!isNaN(oLat) && !isNaN(oLng)) {
            origCoords = [oLat, oLng];
          }
        }
      }

      // 3. Limpa a rota anterior para evitar sobreposição ou travamento
      if (estado.hubyMapa?.rotaLayer && estado.hubyMapa.map) {
        estado.hubyMapa.map.removeLayer(estado.hubyMapa.rotaLayer);
        estado.hubyMapa.rotaLayer = null;
      }

      // 4. Traça a nova rota até o destino final em verde (#10B981)
      if (origCoords && destCoords && estado.hubyMapa) {
        try {
          await estado.hubyMapa.calcularRota(origCoords, destCoords, '#10B981');
        } catch (err) {
          console.warn('Erro ao traçar rota até o destino final:', err);
        }
      }

      renderizarCardEtapa();
    });
  } else {
    document.getElementById('btnConcluirViagemUnico')?.addEventListener('click', concluirCorridaAtual);
  }
}

export async function concluirCorridaAtual() {
  if (!estado.pedidoAceitoAtual) return;
  const token = localStorage.getItem('huby_token');

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/concluir`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Falha ao liquidar corrida.');

    alert(`Viagem Concluída com sucesso!\n\nRepasse Líquido: R$ ${Number(data.repasseLiquido).toFixed(2).replace('.', ',')}`);

    limparAtendimento();
    await carregarPerfilCompleto();
    await carregarGanhosHoje();

    // Se ativou o modo última viagem, coloca o parceiro offline automaticamente
    if (estado.modoUltimaViagem) {
      document.getElementById('btnToggleStatusOnline')?.click();
      alert('Modo Última Viagem: Você foi colocado Offline para descansar.');
    }
  } catch (err) {
    alert(err.message);
  }
}

export async function cancelarCorridaAtual() {
  if (!estado.pedidoAceitoAtual) return;
  if (!confirm('Tem certeza de que deseja cancelar este atendimento?')) return;

  const token = localStorage.getItem('huby_token');
  try {
    await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/cancelar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ motivo: 'Cancelado pelo motorista parceiro' })
    });
  } catch (err) {
    console.warn('Erro ao cancelar:', err);
  }

  limparAtendimento();
}

export function limparAtendimento() {
  if (estado.hubyMapa?.rotaLayer && estado.hubyMapa.map) {
    estado.hubyMapa.map.removeLayer(estado.hubyMapa.rotaLayer);
    estado.hubyMapa.rotaLayer = null;
  }
  estado.pedidoAceitoAtual = null;
  estado.pedidoEmAnalise = null;
  estado.etapaCorridaAtual = 'a_caminho';
  estado.modoUltimaViagem = false;

  const btnChat = document.getElementById('btnAbrirChat');
  if (btnChat) btnChat.style.display = 'none';
  fecharChat();

  iniciarRadarChamadas();
}