// js/motorista/motorista-mapa.js
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { concluirLimpezaPosCorrida, fecharModaisPagamento } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let watchId = null;
let ultimoHeadingConhecido = 0;

function injetarEstilosNavegacao() {
  if (document.getElementById('huby-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'huby-map-styles';
  style.innerHTML = `
    .leaflet-marker-icon.gps-pulse-container {
      transition: transform 1.2s cubic-bezier(0.25, 1, 0.5, 1) !important; 
    }
    .gps-pulse-container { display: flex; align-items: center; justify-content: center; }
    .gps-pulse-marker {
      width: 20px; height: 20px; border-radius: 50%; position: relative; z-index: 2;
      background: #10B981; border: 3px solid #090D16; box-shadow: 0 0 16px rgba(16,185,129,0.9);
    }
    .gps-pulse-marker::after {
      content: ""; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 60px; height: 60px; background-color: rgba(16,185,129,0.25); border-radius: 50%;
      animation: pulse-ring-mot 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; z-index: -1;
    }
    @keyframes pulse-ring-mot {
      0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
      20% { opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }
    #marcadorCarroIcone {
      transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
      position: absolute;
      top: -16px; left: -11px;
      font-size: 22px;
      text-shadow: 0 4px 12px rgba(0,0,0,0.9);
      z-index: 10;
      display: flex; align-items: center; justify-content: center;
    }
  `;
  document.head.appendChild(style);
}

export function inicializarSocket() {
  if (typeof io !== 'undefined') {
    const token = localStorage.getItem('huby_token');
    estado.socket = io(API_URL, { auth: { token: token || '' } });

    estado.socket.on('corrida_finalizada', (dados) => {
      const pedidoIdAtual = estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id;
      if (pedidoIdAtual && String(dados.pedidoId) === String(pedidoIdAtual)) {
        fecharModaisPagamento();
        notificar('🎉 Pagamento confirmado pelo Mercado Pago! Corrida concluída.', 'sucesso');
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) sonsHUBy.tocarMetaBatida();
        concluirLimpezaPosCorrida();
      }
    });
  }
}

export function inicializarMapa() {
  const container = document.getElementById('mapaMotorista');
  if (!container) return;

  injetarEstilosNavegacao();

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  try {
    estado.mapa = L.map('mapaMotorista', {
      zoomControl: false,
      attributionControl: false,
      keepBuffer: 6 // Pré-carrega ruas fora da tela para evitar partes cinzentas ao deslizar
    }).setView(estado.coords, 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarroFluido = L.divIcon({
      className: 'gps-pulse-container',
      html: `<div class="gps-pulse-marker"><div id="marcadorCarroIcone">🚘</div></div>`,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarroFluido, zIndexOffset: 1000 }).addTo(estado.mapa);

    // O SEGREDO PROFISSIONAL: ResizeObserver mata o bug do "fundo cinza" de vez!
    new ResizeObserver(() => {
      if (estado.mapa) {
        requestAnimationFrame(() => estado.mapa.invalidateSize());
      }
    }).observe(container);

    iniciarRastreamentoGPSContinuo();
  } catch (err) {
    console.error('Erro ao iniciar mapa do motorista:', err);
  }
}

export function iniciarRastreamentoGPSContinuo() {
  if (!('geolocation' in navigator)) return;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);

  let gpsFixoMotorista = false;
  
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const velocidade = pos.coords.speed || 0; 
      
      let heading = pos.coords.heading;
      if (heading === null || isNaN(heading) || velocidade < 0.5) {
        heading = ultimoHeadingConhecido;
      } else {
        ultimoHeadingConhecido = heading;
      }

      estado.coords = [lat, lng];
      const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;

      if (estado.markerVeiculo) {
        estado.markerVeiculo.setLatLng([lat, lng]);
      }

      if (estado.mapa) {
        const elIcone = document.getElementById('marcadorCarroIcone');
        if (elIcone) elIcone.style.transform = `rotate(${heading}deg)`;

        if (corridaAtiva) {
          // Câmara fluida e colada no carro (Waze/Uber mode)
          estado.mapa.panTo([lat, lng], { animate: true, duration: 1.2, easeLinearity: 0.1 });
          if (estado.mapa.getZoom() < 18) estado.mapa.setZoom(18, { animate: true });
        } else {
          if (!gpsFixoMotorista) {
            estado.mapa.flyTo([lat, lng], 16, { animate: true, duration: 1.5 });
            gpsFixoMotorista = true;
          } else if (velocidade > 1.0) {
            estado.mapa.panTo([lat, lng], { animate: true, duration: 1.2 });
          }
        }
      }

      if (estado.socket && (estado.isOnline || corridaAtiva)) {
        estado.socket.emit('posicao_motorista', {
          motoristaId: estado.motoristaId || localStorage.getItem('huby_user_id') || '',
          pedidoId: corridaAtiva?.id || null,
          lat, lng, heading, emCorrida: !!corridaAtiva
        });
      }
    },
    (err) => console.warn('Aviso de GPS:', err.message),
    { enableHighAccuracy: true, maximumAge: 500, timeout: 5000 }
  );
}

export async function tracarRotaRealRuas(origem, destino, cor = '#10B981') {
  if (!estado.mapa) return;
  limparRotasMapa();

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem[1]},${origem[0]};${destino[1]},${destino[0]}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coordenadasCurvas = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      estado.linhaRota = L.polyline(coordenadasCurvas, { color: cor, weight: 6, opacity: 0.9, lineCap: 'round' }).addTo(estado.mapa);

      if (!estado.pedidoAtivo && !estado.pedidoAceitoAtual) {
         estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60], animate: true });
      }
      return;
    }
  } catch (err) {
    console.warn('OSRM indisponível, rota direta aplicada');
  }

  estado.linhaRota = L.polyline([origem, destino], { color: cor, weight: 5, dashArray: '8, 8', opacity: 0.9 }).addTo(estado.mapa);
  if (!estado.pedidoAtivo && !estado.pedidoAceitoAtual) {
     estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60], animate: true });
  }
}

export function limparRotasMapa() {
  if (estado.linhaRota && estado.mapa) { estado.mapa.removeLayer(estado.linhaRota); estado.linhaRota = null; }
  if (estado.markerOrigem && estado.mapa) { estado.mapa.removeLayer(estado.markerOrigem); estado.markerOrigem = null; }
  if (estado.markerDestino && estado.mapa) { estado.mapa.removeLayer(estado.markerDestino); estado.markerDestino = null; }
}