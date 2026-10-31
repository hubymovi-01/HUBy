// js/motorista/motorista-corrida.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';
import { carregarGanhosHoje } from './motorista-ganhos.js';
import { carregarPerfilCompleto } from './motorista-perfil.js';
import { fecharChat } from './motorista-chat.js';
import { abrirWidgetFlutuantePiP, fecharWidgetFlutuantePiP } from './motorista-utilidades.js';
import { iniciarContadorEspera, pararContadorEspera, formatarTempo } from './motorista-espera.js';

let chegouAoPontoEmbarque = false;
let taxaEsperaAcumulada = 0;

function formatarTextoLocal(texto, fallbackPadrao = 'Local Marcado') {
  if (!texto) return fallbackPadrao;
  if (texto.includes('(') && texto.includes(')')) {
    const parteAntes = texto.split('(')[0].trim();
    if (parteAntes.length > 2) return parteAntes;
    return fallbackPadrao;
  }
  return texto;
}

function exibirToastConclusao(valorRepasse) {
  const toastExistente = document.getElementById('hubyToastConclusao');
  if (toastExistente) toastExistente.remove();

  const toast = document.createElement('div');
  toast.id = 'hubyToastConclusao';
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(-30px);
    background: #0E131F;
    border: 1.5px solid #10B981;
    color: #FFF;
    padding: 14px 22px;
    border-radius: 14px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6), 0 0 15px rgba(16, 185, 129, 0.3);
    z-index: 99999;
    display: flex;
    align-items: center;
    gap: 12px;
    opacity: 0;
    transition: all 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  `;

  toast.innerHTML = `
    <div style="width: 32px; height: 32px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); display: flex; align-items: center; justify-content: center; font-size: 16px;">
      ✓
    </div>
    <div>
      <div style="font-size: 13px; font-weight: 800; color: #10B981;">Viagem Concluída!</div>
      <div style="font-size: 12px; color: #94A3B8;">Repasse Líquido: <strong style="color: #FFF; font-size: 13px;">R$ ${Number(valorRepasse).toFixed(2).replace('.', ',')}</strong></div>
    </div>
  `;

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }, 50);

  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

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
    const origemTxt = formatarTextoLocal(dados.origem, 'Local de Partida');
    const destinoTxt = formatarTextoLocal(dados.destino, 'Destino do Passageiro');

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
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
            <strong>Origem:</strong> ${origemTxt}
          </span>
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
            <strong>Destino:</strong> ${destinoTxt}
          </span>
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

    chegouAoPontoEmbarque = false;
    taxaEsperaAcumulada = 0;

    estado.pedidoAceitoAtual = data.pedido || {};
    estado.pedidoAceitoAtual.coordsOrigem = dados.coordsOrig;
    estado.pedidoAceitoAtual.coordsDestino = dados.coordsDest;
    estado.pedidoAceitoAtual.origem_lat = dados.coordsOrig ? dados.coordsOrig[0] : null;
    estado.pedidoAceitoAtual.origem_lng = dados.coordsOrig ? dados.coordsOrig[1] : null;
    estado.pedidoAceitoAtual.destino_lat = dados.coordsDest ? dados.coordsDest[0] : null;
    estado.pedidoAceitoAtual.destino_lng = dados.coordsDest ? dados.coordsDest[1] : null;
    estado.pedidoAceitoAtual.origem_endereco = dados.origem;
    estado.pedidoAceitoAtual.destino_endereco = dados.destino;
    estado.pedidoAceitoAtual.valor_base = Number(dados.preco);
    estado.pedidoAceitoAtual.valor_total = Number(dados.preco);
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

  const coordsAlvo = estaACaminho 
    ? (estado.pedidoAceitoAtual.coordsOrigem || [estado.pedidoAceitoAtual.origem_lat, estado.pedidoAceitoAtual.origem_lng])
    : (estado.pedidoAceitoAtual.coordsDestino || [estado.pedidoAceitoAtual.destino_lat, estado.pedidoAceitoAtual.destino_lng]);

  const latAlvo = coordsAlvo ? coordsAlvo[0] : null;
  const lngAlvo = coordsAlvo ? coordsAlvo[1] : null;

  const linkGoogleMaps = (latAlvo && lngAlvo)
    ? `https://www.google.com/maps/dir/?api=1&destination=${latAlvo},${lngAlvo}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(estaACaminho ? (estado.pedidoAceitoAtual.origem_endereco || '') : estado.pedidoAceitoAtual.destino_endereco)}`;

  const linkWaze = (latAlvo && lngAlvo)
    ? `https://waze.com/ul?ll=${latAlvo},${lngAlvo}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(estaACaminho ? (estado.pedidoAceitoAtual.origem_endereco || '') : estado.pedidoAceitoAtual.destino_endereco)}`;

  const origemLimpa = formatarTextoLocal(estado.pedidoAceitoAtual.origem_endereco, 'Local de Embarque');
  const destinoLimpo = formatarTextoLocal(estado.pedidoAceitoAtual.destino_endereco, 'Destino Final');

  const valorExibicao = (Number(estado.pedidoAceitoAtual.valor_base || estado.pedidoAceitoAtual.valor_total) + taxaEsperaAcumulada);

  feed.innerHTML = `
    <div class="order-card" style="border-color: ${estaACaminho ? (chegouAoPontoEmbarque ? '#F59E0B' : '#38BDF8') : '#10B981'};">
      <div class="order-card-header">
        <span class="order-badge" style="background: ${estaACaminho ? (chegouAoPontoEmbarque ? 'rgba(245,158,11,0.2)' : 'rgba(56,189,248,0.2)') : 'rgba(16,185,129,0.2)'}; color: ${estaACaminho ? (chegouAoPontoEmbarque ? '#F59E0B' : '#38BDF8') : '#10B981'};">
          ${estaACaminho ? (chegouAoPontoEmbarque ? 'AGUARDANDO PASSAGEIRO' : 'A CAMINHO DO CLIENTE') : 'EM CORRIDA'}
        </span>
        <span class="order-price" id="lblPrecoCorridaCard">R$ ${valorExibicao.toFixed(2).replace('.', ',')}</span>
      </div>

      <!-- PAINEL DE CRONÔMETRO DE ESPERA -->
      <div id="painelEsperaEmbarque" style="display: ${chegouAoPontoEmbarque && estaACaminho ? 'block' : 'none'}; background: rgba(245, 158, 11, 0.1); border: 1px dashed #F59E0B; border-radius: 8px; padding: 10px; margin: 8px 0; text-align: center;">
        <span style="font-size: 11px; color: #F59E0B; font-weight: 800; display: block;">⏱️ CRONÔMETRO NO LOCAL DE EMBARQUE</span>
        <div id="txtTempoEsperaStatus" style="font-size: 15px; font-weight: 900; color: #FFF; margin-top: 3px;">
          Cortesia: 03:00 restantes
        </div>
        <small id="txtTaxaEsperaAdicional" style="color: #94A3B8; font-size: 11px; display: block; margin-top: 2px;">
          Taxa de espera: R$ 0,00 (+R$ 0,40/min após cortesia)
        </small>
      </div>

      <div class="order-route">
        <span style="display: block; color: ${estaACaminho ? '#38BDF8' : '#10B981'}; font-weight: 800; font-size: 14px; margin-bottom: 4px;" id="lblTempoPassageiro">
          ${estaACaminho ? (chegouAoPontoEmbarque ? '📍 No ponto de embarque' : '📍 A caminho do local de embarque...') : '🏁 A caminho do destino final!'}
        </span>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
          <strong>Recolha:</strong> ${origemLimpa}
        </span>
        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">
          <strong>Destino:</strong> ${destinoLimpo}
        </span>
      </div>

      <!-- BOTÕES DE NAVEGAÇÃO EXTERNA COM PiP AUTOMÁTICO -->
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <a href="${linkGoogleMaps}" target="_blank" rel="noopener noreferrer" id="btnNavegarGoogle"
          style="flex: 1; text-decoration: none; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); color: #38BDF8; border-radius: 8px; padding: 9px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🗺️ Google Maps
        </a>
        <a href="${linkWaze}" target="_blank" rel="noopener noreferrer" id="btnNavegarWaze"
          style="flex: 1; text-decoration: none; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); color: #10B981; border-radius: 8px; padding: 9px; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 5px;">
          🚗 Waze
        </a>
      </div>

      <!-- BOTÕES DE ETAPA -->
      <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
        ${estaACaminho && !chegouAoPontoEmbarque ? `
          <button type="button" id="btnChegueiLocal" style="width: 100%; background: #F59E0B; color: #000; border: none; border-radius: 10px; padding: 13px; font-weight: 900; font-size: 14px; cursor: pointer;">
            📍 Cheguei ao Ponto de Embarque
          </button>
        ` : ''}

        ${estaACaminho ? `
          <button type="button" id="btnIniciarViagemUnico" style="width: 100%; background: #2563EB; color: #FFF; border: none; border-radius: 10px; padding: 14px; font-weight: 900; font-size: 14px; cursor: pointer;">
            ▶ Iniciar Viagem (Passageiro a Bordo)
          </button>
        ` : `
          <button type="button" id="btnConcluirViagemUnico" style="width: 100%; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 14px; font-weight: 900; font-size: 14px; cursor: pointer;">
            ✅ Concluir Viagem
          </button>
        `}
      </div>

      <div style="margin-top: 8px;">
        <button type="button" id="btnToggleUltimaViagem" style="width: 100%; background: ${estado.modoUltimaViagem ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.04)'}; border: 1px solid ${estado.modoUltimaViagem ? '#F59E0B' : 'rgba(255,255,255,0.08)'}; color: ${estado.modoUltimaViagem ? '#F59E0B' : 'var(--text-sec)'}; padding: 8px; border-radius: 8px; font-size: 11px; font-weight: 700; cursor: pointer;">
          ${estado.modoUltimaViagem ? '🛑 Última Viagem Ativa' : '☕ Parar após esta viagem'}
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

  // Listener para PiP ao abrir navegação externa
  const acionarPiP = () => {
    const textoDest = estaACaminho ? 'Indo ao passageiro' : 'Indo ao destino final';
    const precoTxt = `R$ ${valorExibicao.toFixed(2).replace('.', ',')}`;
    abrirWidgetFlutuantePiP(textoDest, precoTxt, () => window.focus());
  };
  document.getElementById('btnNavegarGoogle')?.addEventListener('click', acionarPiP);
  document.getElementById('btnNavegarWaze')?.addEventListener('click', acionarPiP);

  // Listener "Cheguei ao Ponto de Embarque"
  document.getElementById('btnChegueiLocal')?.addEventListener('click', () => {
    chegouAoPontoEmbarque = true;
    renderizarCardEtapa();

    iniciarContadorEspera((info) => {
      const txtStatus = document.getElementById('txtTempoEsperaStatus');
      const txtTaxa = document.getElementById('txtTaxaEsperaAdicional');
      const lblPreco = document.getElementById('lblPrecoCorridaCard');

      taxaEsperaAcumulada = info.taxaAdicional;
      const novoTotal = (Number(estado.pedidoAceitoAtual.valor_base) + taxaEsperaAcumulada);
      estado.pedidoAceitoAtual.valor_total = novoTotal;

      if (lblPreco) lblPreco.textContent = `R$ ${novoTotal.toFixed(2).replace('.', ',')}`;

      if (info.emCortesia) {
        if (txtStatus) txtStatus.textContent = `Cortesia: ${formatarTempo(info.segundosRestantesCortesia)} restantes`;
      } else {
        if (txtStatus) txtStatus.innerHTML = `<span style="color:#EF4444;">Aguardando: +${formatarTempo(info.segundosPassados - 180)}</span>`;
        if (txtTaxa) txtTaxa.innerHTML = `Taxa extra: <strong style="color:#FFF;">+ R$ ${info.taxaAdicional.toFixed(2).replace('.', ',')}</strong>`;
      }
    });
  });

  document.getElementById('btnToggleUltimaViagem')?.addEventListener('click', () => {
    estado.modoUltimaViagem = !estado.modoUltimaViagem;
    renderizarCardEtapa();
  });

  document.getElementById('btnCancelarPeloMotorista')?.addEventListener('click', cancelarCorridaAtual);

  if (estaACaminho) {
    document.getElementById('btnIniciarViagemUnico')?.addEventListener('click', async () => {
      pararContadorEspera();
      fecharWidgetFlutuantePiP();
      estado.etapaCorridaAtual = 'em_viagem';

      let destCoords = estado.pedidoAceitoAtual.coordsDestino;
      if (!destCoords || !Array.isArray(destCoords)) {
        const dLat = parseFloat(estado.pedidoAceitoAtual.destino_lat || estado.pedidoAceitoAtual.destinoLat);
        const dLng = parseFloat(estado.pedidoAceitoAtual.destino_lng || estado.pedidoAceitoAtual.destinoLng);
        if (!isNaN(dLat) && !isNaN(dLng)) destCoords = [dLat, dLng];
      }

      let origCoords = estado.hubyMapa?.coordsOrigem;
      if (!origCoords || !Array.isArray(origCoords)) {
        origCoords = estado.pedidoAceitoAtual.coordsOrigem;
        if (!origCoords || !Array.isArray(origCoords)) {
          const oLat = parseFloat(estado.pedidoAceitoAtual.origem_lat || estado.pedidoAceitoAtual.origemLat);
          const oLng = parseFloat(estado.pedidoAceitoAtual.origem_lng || estado.pedidoAceitoAtual.origemLng);
          if (!isNaN(oLat) && !isNaN(oLng)) origCoords = [oLat, oLng];
        }
      }

      if (estado.hubyMapa?.rotaLayer && estado.hubyMapa.map) {
        estado.hubyMapa.map.removeLayer(estado.hubyMapa.rotaLayer);
        estado.hubyMapa.rotaLayer = null;
      }

      if (origCoords && destCoords && estado.hubyMapa) {
        try {
          await estado.hubyMapa.calcularRota(origCoords, destCoords, '#10B981');
        } catch (err) {
          console.warn('Erro ao traçar rota:', err);
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

  fecharWidgetFlutuantePiP();
  pararContadorEspera();

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/concluir`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        taxa_espera: taxaEsperaAcumulada,
        valor_final: estado.pedidoAceitoAtual.valor_total
      })
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Falha ao liquidar corrida.');

    exibirToastConclusao(data.repasseLiquido || (estado.pedidoAceitoAtual.valor_total * 0.85));

    limparAtendimento();
    await carregarPerfilCompleto();
    await carregarGanhosHoje();

    if (estado.modoUltimaViagem) {
      document.getElementById('btnToggleStatusOnline')?.click();
    }
  } catch (err) {
    alert(err.message);
  }
}

export async function cancelarCorridaAtual() {
  if (!estado.pedidoAceitoAtual) return;
  if (!confirm('Deseja realmente cancelar este atendimento?')) return;

  fecharWidgetFlutuantePiP();
  pararContadorEspera();

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
  fecharWidgetFlutuantePiP();
  pararContadorEspera();
  chegouAoPontoEmbarque = false;
  taxaEsperaAcumulada = 0;

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