// js/motorista/motorista-mapa.js
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { concluirLimpezaPosCorrida, fecharModaisPagamento } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let watchId = null;
let ultimoHeadingConhecido = 0;

// INJETA ESTILOS 2D E ANIMAÇÕES
function injetarEstilosNavegacao() {
  if (document.getElementById('huby-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'huby-map-styles';
  style.innerHTML = `
    .gps-pulse-container { display: flex; align-items: center; justify-content: center; }
    .gps-pulse-marker {
      width: 18px; height: 18px; border-radius: 50%; position: relative; z-index: 2;
      background: #10B981; border: 3px solid #090D16; box-shadow: 0 0 12px rgba(16,185,129,0.8);
    }
    .gps-pulse-marker::after {
      content: ""; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 50px; height: 50px; background-color: rgba(16,185,129,0.3); border-radius: 50%;
      animation: pulse-ring-mot 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite; z-index: -1;
    }
    @keyframes pulse-ring-mot {
      0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
      20% { opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
    }

    #marcadorCarroIcone {
      transition: transform 0.3s linear;
      position: absolute;
      top: -15px; left: -10px;
      font-size: 20px;
      text-shadow: 0 0 10px rgba(16,185,129,0.9);
      z-index: 10;
      display: flex; align-items: center; justify-content: center;
    }
  `;
  document.head.appendChild(style);
}

export function inicializarSocket() {
  if (typeof io !== 'undefined') {
    const token = localStorage.getItem('huby_token');
    estado.socket = io(API_URL, {
      auth: { token: token || '' }
    });

    estado.socket.on('corrida_finalizada', (dados) => {
      const pedidoIdAtual = estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id;
      if (pedidoIdAtual && String(dados.pedidoId) === String(pedidoIdAtual)) {
        fecharModaisPagamento();
        notificar('🎉 Pagamento confirmado pelo Mercado Pago! Corrida concluída.', 'sucesso');
        if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarMetaBatida) {
          sonsHUBy.tocarMetaBatida();
        }
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
      attributionControl: false
    }).setView(estado.coords, 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarroFluido = L.divIcon({
      className: 'gps-pulse-container',
      html: `
        <div class="gps-pulse-marker">
          <div id="marcadorCarroIcone">🚘</div>
        </div>
      `,
      iconSize: [48, 48],
      iconAnchor: [24, 24]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarroFluido }).addTo(estado.mapa);

    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 300);

    iniciarRastreamentoGPSContinuo();

  } catch (err) {
    console.error('Erro ao iniciar mapa do motorista:', err);
  }
}

export function iniciarRastreamentoGPSContinuo() {
  if (!('geolocation' in navigator)) {
    console.warn('Geolocalização não suportada pelo navegador.');
    return;
  }

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }

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

      // 1. Atualiza posição no mapa
      if (estado.markerVeiculo) {
        estado.markerVeiculo.setLatLng([lat, lng]);
      }

      // 2. Lógica da Câmera (Sempre 2D, centraliza dinamicamente)
      if (estado.mapa) {
        // Rotaciona apenas o ícone do carro na direção do movimento
        const elIcone = document.getElementById('marcadorCarroIcone');
        if (elIcone) elIcone.style.transform = `rotate(${heading}deg)`;

        // SE ESTIVER EM CORRIDA, O MAPA DEVE SEGUIR O CARRO BEM DE PERTO
        if (corridaAtiva) {
          estado.mapa.setView([lat, lng], 18, { animate: true, duration: 1.0 });
        } 
        // SE ESTIVER LIVRE, MANTÉM A VISÃO NORMAL DO BAIRRO
        else {
          if (!gpsFixoMotorista) {
            estado.mapa.flyTo([lat, lng], 17, { animate: true, duration: 1.0 });
            gpsFixoMotorista = true;
          } else {
            estado.mapa.panTo([lat, lng], { animate: true, duration: 1.0 });
          }
        }
      }

      // 3. Transmite a posição pro Servidor/Passageiro
      if (estado.socket && (estado.isOnline || corridaAtiva)) {
        const idMotorista = estado.motoristaId || localStorage.getItem('huby_user_id') || '';
        const idPedidoAtivo = corridaAtiva?.id || null;

        estado.socket.emit('posicao_motorista', {
          motoristaId: idMotorista,
          pedidoId: idPedidoAtivo,
          lat: lat,
          lng: lng,
          heading: heading,
          emCorrida: !!corridaAtiva
        });
      }
    },
    (err) => {
      console.warn('Aviso de GPS:', err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    }
  );
}

export async function tracarRotaRealRuas(origem, destino, cor = '#10B981') {
  if (!estado.mapa) return;

  if (estado.linhaRota) {
    estado.mapa.removeLayer(estado.linhaRota);
    estado.linhaRota = null;
  }

  const [latOrig, lngOrig] = origem;
  const [latDest, lngDest] = destino;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lngOrig},${latOrig};${lngDest},${latDest}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coordenadasCurvas = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

      estado.linhaRota = L.polyline(coordenadasCurvas, {
        color: cor,
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(estado.mapa);

      // Em vez de focar na rota toda (fitBounds) que tira o carro do foco,
      // nós mantemos o GPS seguindo o carro no watchPosition, mas damos um
      // ligeiro zoom out inicial só para mostrar para onde o motorista vai.
      const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;
      if (!corridaAtiva) {
         estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [50, 50] });
      }
      return;
    }
  } catch (err) {
    console.warn('Falha no OSRM, aplicando rota direta:', err);
  }

  estado.linhaRota = L.polyline([origem, destino], {
    color: cor,
    weight: 5,
    dashArray: '8, 8',
    opacity: 0.9
  }).addTo(estado.mapa);
  
  const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;
  if (!corridaAtiva) {
     estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [50, 50] });
  }
}

export function limparRotasMapa() {
  if (estado.linhaRota && estado.mapa) {
    estado.mapa.removeLayer(estado.linhaRota);
    estado.linhaRota = null;
  }
  if (estado.markerOrigem && estado.mapa) {
    estado.mapa.removeLayer(estado.markerOrigem);
    estado.markerOrigem = null;
  }
  if (estado.markerDestino && estado.mapa) {
    estado.mapa.removeLayer(estado.markerDestino);
    estado.markerDestino = null;
  }
}