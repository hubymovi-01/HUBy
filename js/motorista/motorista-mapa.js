// js/motorista/motorista-mapa.js - Motor 3D Vetorial MapLibre GL (Estilo Waze / Google Maps Go)
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { concluirLimpezaPosCorrida, fecharModaisPagamento } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let watchId = null;
let ultimoHeadingConhecido = 0;
let ultimaPosicaoCalculo = null;
let cameraTravadaNoCarro = true;
let timeoutRetomarCamera = null;

// ============================================================================
// CÁLCULO MATEMÁTICO DE DIREÇÃO (BEARING) QUANDO O GPS DO CELULAR NÃO ENVIA BÚSSOLA
// ============================================================================
function calcularBearingEntrePontos(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================================
// ESTILOS DO PUCK 3D DE NAVEGAÇÃO (SETA ESTILO WAZE / UBER)
// ============================================================================
function injetarEstilosNavegacao() {
  if (document.getElementById('huby-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'huby-map-styles';
  style.innerHTML = `
    .huby-3d-puck-wrapper {
      width: 54px;
      height: 54px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      pointer-events: none;
    }
    .huby-3d-puck-halo {
      position: absolute;
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(16,185,129,0.45) 0%, rgba(16,185,129,0) 70%);
      animation: pulseHalo3D 2s infinite ease-out;
    }
    .huby-3d-puck-core {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #090D16;
      border: 3px solid #10B981;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.85), 0 0 14px rgba(16, 185, 129, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes pulseHalo3D {
      0% { transform: scale(0.7); opacity: 0.9; }
      100% { transform: scale(1.45); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// PONTE DE COMPATIBILIDADE LEAFLET (window.L) PARA NÃO QUEBRAR NENHUM MÓDULO
// ============================================================================
function instalarAdaptadorLeafletParaMapLibre() {
  let idCounter = 1;

  class BoundsAdapter {
    constructor(coords = []) {
      this.coords = coords;
    }
  }

  class MarkerAdapter {
    constructor(latlng, options = {}) {
      this._latlng = Array.isArray(latlng) ? latlng : [latlng.lat, latlng.lng];
      this.options = options;
      this._marker = null;
    }
    addTo(mapAdapter) {
      const el = document.createElement('div');
      if (this.options.icon && this.options.icon.html) {
        el.innerHTML = this.options.icon.html;
      } else {
        el.innerHTML = '<div style="font-size:24px;">📍</div>';
      }
      this._marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([this._latlng[1], this._latlng[0]])
        .addTo(mapAdapter._gl);
      return this;
    }
    setLatLng(latlng) {
      this._latlng = Array.isArray(latlng) ? latlng : [latlng.lat, latlng.lng];
      if (this._marker) {
        this._marker.setLngLat([this._latlng[1], this._latlng[0]]);
      }
      return this;
    }
    getLatLng() {
      return { lat: this._latlng[0], lng: this._latlng[1] };
    }
    remove() {
      if (this._marker) {
        this._marker.remove();
        this._marker = null;
      }
    }
  }

  class PolylineAdapter {
    constructor(latlngs, options = {}) {
      this._latlngs = latlngs || [];
      this.options = options;
      this._id = `huby-route-${idCounter++}`;
      this._glowId = `${this._id}-glow`;
      this._map = null;
    }
    addTo(mapAdapter) {
      this._map = mapAdapter._gl;
      const geojson = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: this._latlngs.map((c) => [c[1], c[0]])
        }
      };

      const renderLayer = () => {
        if (!this._map) return;
        if (this._map.getSource(this._id)) {
          this._map.getSource(this._id).setData(geojson);
          return;
        }
        this._map.addSource(this._id, { type: 'geojson', data: geojson });

        // Sombra Neon da Rota (Estilo Waze)
        this._map.addLayer({
          id: this._glowId,
          type: 'line',
          source: this._id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': this.options.color || '#10B981',
            'line-width': (this.options.weight || 6) + 6,
            'line-opacity': 0.28,
            'line-blur': 4
          }
        });

        // Linha Principal da Rota
        this._map.addLayer({
          id: this._id,
          type: 'line',
          source: this._id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': this.options.color || '#10B981',
            'line-width': this.options.weight || 6,
            'line-opacity': this.options.opacity || 0.95
          }
        });
      };

      if (this._map.isStyleLoaded()) {
        renderLayer();
      } else {
        this._map.once('load', renderLayer);
      }
      return this;
    }
    getBounds() {
      return new BoundsAdapter(this._latlngs);
    }
    remove() {
      if (!this._map) return;
      try {
        if (this._map.getLayer(this._id)) this._map.removeLayer(this._id);
        if (this._map.getLayer(this._glowId)) this._map.removeLayer(this._glowId);
        if (this._map.getSource(this._id)) this._map.removeSource(this._id);
      } catch (e) {}
    }
  }

  class HeatLayerAdapter {
    constructor(pontos = []) {
      this._pontos = pontos;
      this._id = `huby-heat-${idCounter++}`;
      this._map = null;
    }
    addTo(mapAdapter) {
      this._map = mapAdapter._gl;
      const geojson = {
        type: 'FeatureCollection',
        features: this._pontos.map(([lat, lng, intensity = 0.8]) => ({
          type: 'Feature',
          properties: { intensity },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        }))
      };
      const render = () => {
        if (!this._map) return;
        this._map.addSource(this._id, { type: 'geojson', data: geojson });
        this._map.addLayer({
          id: this._id,
          type: 'heatmap',
          source: this._id,
          paint: {
            'heatmap-weight': ['get', 'intensity'],
            'heatmap-intensity': 1.2,
            'heatmap-radius': 34,
            'heatmap-opacity': 0.75
          }
        });
      };
      if (this._map.isStyleLoaded()) render();
      else this._map.once('load', render);
      return this;
    }
    remove() {
      if (!this._map) return;
      try {
        if (this._map.getLayer(this._id)) this._map.removeLayer(this._id);
        if (this._map.getSource(this._id)) this._map.removeSource(this._id);
      } catch (e) {}
    }
  }

  window.L = {
    divIcon: (opts) => opts,
    marker: (latlng, opts) => new MarkerAdapter(latlng, opts),
    polyline: (latlngs, opts) => new PolylineAdapter(latlngs, opts),
    heatLayer: (pontos, opts) => new HeatLayerAdapter(pontos, opts),
    featureGroup: (markers = []) => ({
      getBounds: () =>
        new BoundsAdapter(
          markers
            .filter(Boolean)
            .map((m) => (m.getLatLng ? [m.getLatLng().lat, m.getLatLng().lng] : m._latlng))
        )
    }),
    layerGroup: () => {
      const items = [];
      return {
        _items: items,
        addLayer(l) { items.push(l); },
        addTo(m) { items.forEach((i) => i.addTo && i.addTo(m)); return this; },
        remove() { items.forEach((i) => i.remove && i.remove()); }
      };
    },
    circle: (latlng) => new MarkerAdapter(latlng, {
      icon: { html: '<div style="width:45px;height:45px;border-radius:50%;background:rgba(245,158,11,0.3);border:1px solid #F59E0B;"></div>' }
    })
  };
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
  if (!container || typeof maplibregl === 'undefined') return;

  injetarEstilosNavegacao();
  instalarAdaptadorLeafletParaMapLibre();

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  const [latInicial, lngInicial] = estado.coords || [-8.3580, -42.2460];

  // Inicializa o Mapa Vetorial 3D com Tema Escuro Automotivo (100% Gratuito)
  const glMap = new maplibregl.Map({
    container: 'mapaMotorista',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [lngInicial, latInicial],
    zoom: 16.5,
    pitch: 55, // Inclinação 3D igual ao Waze / Maps Go
    bearing: 0,
    maxPitch: 75,
    antialias: true,
    attributionControl: false
  });

  // Se o motorista arrastar o mapa com o dedo, pausa a câmera automática por 8 segundos
  glMap.on('dragstart', () => {
    cameraTravadaNoCarro = false;
    if (timeoutRetomarCamera) clearTimeout(timeoutRetomarCamera);
    timeoutRetomarCamera = setTimeout(() => {
      cameraTravadaNoCarro = true;
    }, 8000);
  });

  // Botão da Bússola 3D para travar a câmera imediatamente no carro
  document.getElementById('btnRecentrarCamera3D')?.addEventListener('click', () => {
    cameraTravadaNoCarro = true;
    atualizarCameraNavegacao3D(estado.coords[0], estado.coords[1], ultimoHeadingConhecido, true);
  });

  // Wrapper com todos os métodos que o restante do sistema HUBy espera do Leaflet
  estado.mapa = {
    _gl: glMap,
    setView(latlng, zoom = 16.5) {
      glMap.easeTo({
        center: [latlng[1], latlng[0]],
        zoom,
        duration: 800
      });
      return this;
    },
    panTo(latlng, opts = {}) {
      if (!cameraTravadaNoCarro && !opts.forcar) return this;
      const emCorrida = !!(estado.pedidoAtivo || estado.pedidoAceitoAtual);
      glMap.easeTo({
        center: [latlng[1], latlng[0]],
        pitch: emCorrida ? 62 : 50,
        bearing: emCorrida ? ultimoHeadingConhecido : glMap.getBearing(),
        offset: [0, emCorrida ? 110 : 50], // Coloca o carro na base da tela para ver a rua à frente!
        duration: (opts.duration || 1.0) * 1000,
        easing: (t) => t
      });
      return this;
    },
    flyTo(latlng, zoom = 17, opts = {}) {
      glMap.flyTo({
        center: [latlng[1], latlng[0]],
        zoom,
        pitch: 55,
        duration: (opts.duration || 1.2) * 1000
      });
      return this;
    },
    setZoom(zoom) {
      glMap.easeTo({ zoom, duration: 600 });
    },
    getZoom() {
      return glMap.getZoom();
    },
    fitBounds(bounds) {
      if (!bounds || !bounds.coords || bounds.coords.length === 0) return;
      const b = new maplibregl.LngLatBounds();
      bounds.coords.forEach((c) => b.extend([c[1], c[0]]));
      glMap.fitBounds(b, {
        padding: { top: 80, bottom: 90, left: 50, right: 50 },
        pitch: 40,
        bearing: 0,
        duration: 900
      });
    },
    invalidateSize() {
      glMap.resize();
    },
    fire() {},
    hasLayer(layer) {
      return !!layer;
    },
    removeLayer(layer) {
      if (layer && typeof layer.remove === 'function') {
        layer.remove();
      }
    },
    remove() {
      glMap.remove();
    }
  };

  // Marcador 3D do Veículo do Motorista (Seta de Navegação)
  const iconeCarro3D = window.L.divIcon({
    html: `
      <div class="huby-3d-puck-wrapper">
        <div class="huby-3d-puck-halo"></div>
        <div class="huby-3d-puck-core" id="marcadorCarroIcone">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#10B981">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        </div>
      </div>
    `
  });

  estado.markerVeiculo = window.L.marker(estado.coords, { icon: iconeCarro3D }).addTo(estado.mapa);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      glMap.resize();
    }).observe(container);
  }

  iniciarRastreamentoGPSContinuo();
}

function atualizarCameraNavegacao3D(lat, lng, heading, forcar = false) {
  if (!estado.mapa || !estado.mapa._gl) return;
  if (!cameraTravadaNoCarro && !forcar) return;

  const glMap = estado.mapa._gl;
  const corridaAtiva = !!(estado.pedidoAtivo || estado.pedidoAceitoAtual);
  const elIcone = document.getElementById('marcadorCarroIcone');

  if (corridaAtiva) {
    // MODO NAVEGAÇÃO WAZE / MAPS GO:
    // A rua inteira gira para a frente do carro (bearing = heading) e a seta aponta para cima (0deg)
    if (elIcone) elIcone.style.transform = `rotate(0deg)`;

    glMap.easeTo({
      center: [lng, lat],
      zoom: Math.max(glMap.getZoom(), 17.6),
      pitch: 64,
      bearing: heading,
      offset: [0, 115], // Empurra o carro para baixo e abre visão da avenida à frente
      duration: 950,
      easing: (t) => t
    });
  } else {
    // MODO RADAR LIVRE:
    // Câmera 3D suave acompanhando o carro e seta girando para o lado da rua
    if (elIcone) elIcone.style.transform = `rotate(${heading}deg)`;

    glMap.easeTo({
      center: [lng, lat],
      zoom: Math.max(glMap.getZoom(), 16.5),
      pitch: 52,
      bearing: 0,
      offset: [0, 50],
      duration: 950,
      easing: (t) => t
    });
  }
}

export function iniciarRastreamentoGPSContinuo() {
  if (!('geolocation' in navigator)) return;

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const velocidade = pos.coords.speed || 0;

      let heading = pos.coords.heading;

      // Se o chip GPS do celular não informou a bússola, calcula o ângulo exato pelo movimento na rua
      if ((heading === null || isNaN(heading)) && ultimaPosicaoCalculo) {
        const dist = distanciaMetros(ultimaPosicaoCalculo.lat, ultimaPosicaoCalculo.lng, lat, lng);
        if (dist > 2.5) {
          heading = calcularBearingEntrePontos(
            ultimaPosicaoCalculo.lat,
            ultimaPosicaoCalculo.lng,
            lat,
            lng
          );
        }
      }

      if (heading === null || isNaN(heading) || (velocidade > 0 && velocidade < 0.6)) {
        heading = ultimoHeadingConhecido;
      } else {
        ultimoHeadingConhecido = heading;
      }

      ultimaPosicaoCalculo = { lat, lng };
      estado.coords = [lat, lng];
      estado.ultimaPosicao = { lat, lng, heading };

      const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;

      if (estado.markerVeiculo) {
        estado.markerVeiculo.setLatLng([lat, lng]);
      }

      atualizarCameraNavegacao3D(lat, lng, heading);

      if (estado.socket && (estado.isOnline || corridaAtiva)) {
        const idMotorista = estado.motoristaId || localStorage.getItem('huby_user_id') || '';
        const idPedidoAtivo = corridaAtiva?.id || null;

        estado.socket.emit('posicao_motorista', {
          motoristaId: idMotorista,
          pedidoId: idPedidoAtivo,
          lat,
          lng,
          heading,
          emCorrida: !!corridaAtiva
        });
      }
    },
    (err) => {
      console.warn('Aviso de GPS:', err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 500,
      timeout: 8000
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
  const corridaAtiva = estado.pedidoAtivo || estado.pedidoAceitoAtual;

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lngOrig},${latOrig};${lngDest},${latDest}?overview=full&geometries=geojson`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coordenadasCurvas = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);

      // Se a rota começou agora, já aponta a câmera 3D para o primeiro quarteirão da rua!
      if (coordenadasCurvas.length > 1) {
        ultimoHeadingConhecido = calcularBearingEntrePontos(
          coordenadasCurvas[0][0],
          coordenadasCurvas[0][1],
          coordenadasCurvas[1][0],
          coordenadasCurvas[1][1]
        );
      }

      estado.linhaRota = window.L.polyline(coordenadasCurvas, {
        color: cor,
        weight: 6,
        opacity: 0.95
      }).addTo(estado.mapa);

      if (!corridaAtiva) {
        estado.mapa.fitBounds(estado.linhaRota.getBounds());
      } else {
        cameraTravadaNoCarro = true;
        atualizarCameraNavegacao3D(estado.coords[0], estado.coords[1], ultimoHeadingConhecido, true);
      }
      return;
    }
  } catch (err) {
    console.warn('Falha no OSRM, aplicando rota direta:', err);
  }

  estado.linhaRota = window.L.polyline([origem, destino], {
    color: cor,
    weight: 5,
    opacity: 0.9
  }).addTo(estado.mapa);

  if (!corridaAtiva) {
    estado.mapa.fitBounds(estado.linhaRota.getBounds());
  } else {
    cameraTravadaNoCarro = true;
    atualizarCameraNavegacao3D(estado.coords[0], estado.coords[1], ultimoHeadingConhecido, true);
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