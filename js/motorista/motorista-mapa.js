// js/motorista/motorista-mapa.js
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { concluirLimpezaPosCorrida, fecharModaisPagamento } from './motorista-corrida.js';
import { notificar } from './motorista-alertas.js';

let watchId = null;

export function inicializarSocket() {
  if (typeof io !== 'undefined') {
    estado.socket = io(API_URL);

    // Ouve confirmação de pagamento do Mercado Pago em tempo real
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

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  try {
    estado.mapa = L.map('mapaMotorista', {
      zoomControl: false,
      attributionControl: false
    }).setView(estado.coords, 15);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(estado.mapa);

    const iconeCarro = L.divIcon({
      className: 'huby-driver-pin',
      html: '<div style="width:38px;height:38px;background:#090D16;border:2.5px solid #10B981;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 16px rgba(16,185,129,0.9);font-size:19px;">🚘</div>',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    estado.markerVeiculo = L.marker(estado.coords, { icon: iconeCarro }).addTo(estado.mapa);

    setTimeout(() => {
      if (estado.mapa) estado.mapa.invalidateSize();
    }, 300);

    // Ativa o rastreio contínuo e preciso
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

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const heading = pos.coords.heading || 0;

      // 1. Atualiza estado central
      estado.coords = [lat, lng];

      // 2. Move o marcador do carro suavemente na tela do motorista
      if (estado.markerVeiculo) {
        estado.markerVeiculo.setLatLng([lat, lng]);
      }

      const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;

      // 3. Centraliza a câmera de forma fluida durante a corrida
      if (estado.mapa && corridaAtiva) {
        estado.mapa.panTo([lat, lng], { animate: true, duration: 1.0 });
      }

      // 4. Transmite a posição ao servidor para o passageiro ver o carro se deslocar
      if (estado.socket) {
        estado.socket.emit('posicao_motorista', {
          motoristaId: estado.motoristaId,
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

      estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });
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

  estado.mapa.fitBounds(estado.linhaRota.getBounds(), { padding: [60, 60] });
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