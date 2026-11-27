// js/motorista/motorista-mapa.js - Motor 3D Completo com POIs, Prédios 3D, Velocímetro e HUD Turn-by-Turn
import { API_URL, sonsHUBy } from '../config.js';
import { estado } from './motorista-estado.js';
import { concluirLimpezaPosCorrida, fecharModaisPagamento } from './motorista-corrida.js';
import { notificar } from '../util/alertas-huby.js';

let watchId = null;
let ultimoHeadingConhecido = 0;
let ultimaPosicaoCalculo = null;
let cameraTravadaNoCarro = true;
let timeoutRetomarCamera = null;
let velocidadeAtualKmh = 0;

// ============================================================================
// CÁLCULOS GEODÉSICOS DE DIREÇÃO (BEARING) E DISTÂNCIA
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
// ESTILOS DO MAPA RICO, PUCK 3D, VELOCÍMETRO E PLACA DE MANOBRAS (HUD)
// ============================================================================
function injetarEstilosNavegacao() {
  if (document.getElementById('huby-map-styles')) return;
  const style = document.createElement('style');
  style.id = 'huby-map-styles';
  style.innerHTML = `
    /* Seta 3D do Veículo */
    .huby-3d-puck-wrapper {
      width: 58px;
      height: 58px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      pointer-events: none;
    }
    .huby-3d-puck-halo {
      position: absolute;
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(16,185,129,0.5) 0%, rgba(16,185,129,0) 72%);
      animation: pulseHalo3D 2s infinite ease-out;
    }
    .huby-3d-puck-core {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #090D16;
      border: 3px solid #10B981;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.9), 0 0 14px rgba(16, 185, 129, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
      transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    }
    @keyframes pulseHalo3D {
      0% { transform: scale(0.7); opacity: 0.95; }
      100% { transform: scale(1.5); opacity: 0; }
    }

    /* Placa Superior de Navegação Turn-by-Turn (Estilo Waze / Maps Go) */
    #hubyNavBanner {
      position: absolute;
      top: calc(env(safe-area-inset-top, 10px) + 64px);
      left: 14px;
      right: 14px;
      z-index: 90;
      background: rgba(11, 20, 34, 0.94);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1.5px solid rgba(16, 185, 129, 0.45);
      border-radius: 16px;
      padding: 10px 14px;
      display: none;
      align-items: center;
      gap: 12px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
      pointer-events: none;
    }
    .nav-banner-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #10B981;
      font-size: 20px;
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .nav-banner-text {
      flex: 1;
      overflow: hidden;
    }
    .nav-banner-step {
      font-size: 14px;
      font-weight: 900;
      color: #FFFFFF;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-banner-sub {
      font-size: 11px;
      font-weight: 700;
      color: #38BDF8;
      margin-top: 2px;
    }

    /* Velocímetro Digital Flutuante */
    #hubySpeedometer {
      position: absolute;
      bottom: 70px;
      left: 16px;
      z-index: 40;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: rgba(12, 17, 29, 0.92);
      border: 2px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    #hubySpeedVal {
      font-size: 15px;
      font-weight: 900;
      color: #FFFFFF;
      line-height: 1;
    }
    #hubySpeedUnit {
      font-size: 8px;
      font-weight: 800;
      color: #94A3B8;
      text-transform: uppercase;
      margin-top: 1px;
    }
  `;
  document.head.appendChild(style);
}

function criarWidgetsNavegacaoMapa() {
  const wrapper = document.querySelector('.map-wrapper');
  if (!wrapper) return;

  if (!document.getElementById('hubyNavBanner')) {
    const banner = document.createElement('div');
    banner.id = 'hubyNavBanner';
    banner.innerHTML = `
      <div class="nav-banner-icon" id="navBannerIcon">⬆️</div>
      <div class="nav-banner-text">
        <div class="nav-banner-step" id="navBannerRua">Siga pela via principal</div>
        <div class="nav-banner-sub" id="navBannerResumo">Calculando detalhes da rota...</div>
      </div>
    `;
    wrapper.appendChild(banner);
  }

  if (!document.getElementById('hubySpeedometer')) {
    const speedo = document.createElement('div');
    speedo.id = 'hubySpeedometer';
    speedo.innerHTML = `
      <span id="hubySpeedVal">0</span>
      <span id="hubySpeedUnit">km/h</span>
    `;
    wrapper.appendChild(speedo);
  }
}

function atualizarBannerNavegacao(visivel, icone = '⬆️', instrucao = '', subtexto = '') {
  const banner = document.getElementById('hubyNavBanner');
  if (!banner) return;
  if (!visivel) {
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  const elIcon = document.getElementById('navBannerIcon');
  const elRua = document.getElementById('navBannerRua');
  const elSub = document.getElementById('navBannerResumo');
  if (elIcon) elIcon.textContent = icone;
  if (elRua) elRua.textContent = instrucao;
  if (elSub) elSub.textContent = subtexto;
}

// ============================================================================
// PERSONALIZAÇÃO DO TEMA 3D RICO (COM COMÉRCIOS, PRAÇAS, RUAS E PRÉDIOS 3D)
// ============================================================================
function aplicarTemaNoturnoRicoComPOIs(glMap) {
  const layers = glMap.getStyle()?.layers || [];

  layers.forEach((layer) => {
    try {
      // Escurece o fundo e quarteirões mantendo alto contraste para ruas e comércios
      if (layer.type === 'background') {
        glMap.setPaintProperty(layer.id, 'background-color', '#0B101B');
      }
      if (layer.type === 'fill') {
        if (layer.id.includes('water')) {
          glMap.setPaintProperty(layer.id, 'fill-color', '#0D253F');
        } else if (layer.id.includes('park') || layer.id.includes('green') || layer.id.includes('wood') || layer.id.includes('grass')) {
          glMap.setPaintProperty(layer.id, 'fill-color', '#0D261D');
        } else if (layer.id.includes('building')) {
          glMap.setPaintProperty(layer.id, 'fill-color', '#182235');
        } else if (layer.id.includes('land') || layer.id.includes('residential')) {
          glMap.setPaintProperty(layer.id, 'fill-color', '#0E1525');
        }
      }
      // Destaca todas as ruas, avenidas e cruzamentos
      if (layer.type === 'line') {
        if (layer.id.includes('highway') || layer.id.includes('motorway') || layer.id.includes('trunk') || layer.id.includes('primary')) {
          glMap.setPaintProperty(layer.id, 'line-color', '#334155');
        } else if (layer.id.includes('road') || layer.id.includes('street') || layer.id.includes('secondary') || layer.id.includes('tertiary') || layer.id.includes('minor')) {
          glMap.setPaintProperty(layer.id, 'line-color', '#243044');
        }
      }
      // Prédios e construções em 3D
      if (layer.type === 'fill-extrusion') {
        glMap.setPaintProperty(layer.id, 'fill-extrusion-color', '#1E293B');
        glMap.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.82);
      }
      // Deixa TODOS os nomes de ruas, bairros, praças, lojas, farmácias e hospitais bem visíveis
      if (layer.type === 'symbol') {
        glMap.setLayoutProperty(layer.id, 'visibility', 'visible');
        if (layer.id.includes('poi')) {
          glMap.setPaintProperty(layer.id, 'text-color', '#38BDF8');
          glMap.setPaintProperty(layer.id, 'text-halo-color', '#090D16');
          glMap.setPaintProperty(layer.id, 'text-halo-width', 2);
        } else {
          glMap.setPaintProperty(layer.id, 'text-color', '#F8FAFC');
          glMap.setPaintProperty(layer.id, 'text-halo-color', '#090D16');
          glMap.setPaintProperty(layer.id, 'text-halo-width', 2);
        }
      }
    } catch (e) {}
  });
}

// ============================================================================
// PONTE DE COMPATIBILIDADE LEAFLET (window.L)
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
      this._arrowsId = `${this._id}-arrows`;
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

        // Brilho externo da rota
        this._map.addLayer({
          id: this._glowId,
          type: 'line',
          source: this._id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': this.options.color || '#10B981',
            'line-width': (this.options.weight || 7) + 8,
            'line-opacity': 0.32,
            'line-blur': 4
          }
        });

        // Linha principal da rota
        this._map.addLayer({
          id: this._id,
          type: 'line',
          source: this._id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': this.options.color || '#10B981',
            'line-width': (this.options.weight || 7) + 1,
            'line-opacity': 0.98
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
    circle: (latlng) =>
      new MarkerAdapter(latlng, {
        icon: {
          html: '<div style="width:45px;height:45px;border-radius:50%;background:rgba(245,158,11,0.3);border:1px solid #F59E0B;"></div>'
        }
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

    // Passageiro (ou a central) cancelou a corrida que este motorista aceitou
    estado.socket.on('corrida_cancelada', (dados) => {
      const pedidoIdAtual = estado.pedidoAtivo?.id || estado.pedidoAceitoAtual?.id;
      if (!pedidoIdAtual || String(dados?.pedidoId) !== String(pedidoIdAtual)) return;
      if (dados?.canceladoPor === 'motorista') return; // o próprio motorista já trata o cancelamento dele

      fecharModaisPagamento();
      if (typeof sonsHUBy !== 'undefined' && sonsHUBy.tocarAlertaChamada) {
        sonsHUBy.tocarAlertaChamada();
      }
      notificar(
        dados?.canceladoPor === 'admin'
          ? '🚫 A central HUBy cancelou esta corrida.'
          : '🚫 O passageiro cancelou a corrida. Você já pode receber novas chamadas.',
        'alerta',
        7000
      );
      concluirLimpezaPosCorrida();
    });
  }
}

export function inicializarMapa() {
  const container = document.getElementById('mapaMotorista');
  if (!container || typeof maplibregl === 'undefined') return;

  injetarEstilosNavegacao();
  criarWidgetsNavegacaoMapa();
  instalarAdaptadorLeafletParaMapLibre();

  if (estado.mapa) {
    estado.mapa.remove();
    estado.mapa = null;
  }

  const [latInicial, lngInicial] = estado.coords || [-8.3580, -42.2460];

  // OpenFreeMap Liberty 3D: Base vetorial completa com POIs (lojas, praças, farmácias, escolas), nomes de ruas e prédios 3D
  const glMap = new maplibregl.Map({
    container: 'mapaMotorista',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [lngInicial, latInicial],
    zoom: 17,
    pitch: 58,
    bearing: 0,
    maxPitch: 75,
    antialias: true,
    attributionControl: false
  });

  glMap.on('load', () => {
    aplicarTemaNoturnoRicoComPOIs(glMap);
  });

  glMap.on('dragstart', () => {
    cameraTravadaNoCarro = false;
    if (timeoutRetomarCamera) clearTimeout(timeoutRetomarCamera);
    timeoutRetomarCamera = setTimeout(() => {
      cameraTravadaNoCarro = true;
    }, 8000);
  });

  document.getElementById('btnRecentrarCamera3D')?.addEventListener('click', () => {
    cameraTravadaNoCarro = true;
    atualizarCameraNavegacao3D(estado.coords[0], estado.coords[1], ultimoHeadingConhecido, true);
  });

  estado.mapa = {
    _gl: glMap,
    setView(latlng, zoom = 17) {
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
        pitch: emCorrida ? 64 : 52,
        bearing: emCorrida ? ultimoHeadingConhecido : glMap.getBearing(),
        offset: [0, emCorrida ? 115 : 50],
        duration: (opts.duration || 1.0) * 1000,
        easing: (t) => t
      });
      return this;
    },
    flyTo(latlng, zoom = 17, opts = {}) {
      glMap.flyTo({
        center: [latlng[1], latlng[0]],
        zoom,
        pitch: 58,
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
        padding: { top: 90, bottom: 95, left: 50, right: 50 },
        pitch: 42,
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

  const iconeCarro3D = window.L.divIcon({
    html: `
      <div class="huby-3d-puck-wrapper">
        <div class="huby-3d-puck-halo"></div>
        <div class="huby-3d-puck-core" id="marcadorCarroIcone">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#10B981">
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
    if (elIcone) elIcone.style.transform = `rotate(0deg)`;

    glMap.easeTo({
      center: [lng, lat],
      zoom: Math.max(glMap.getZoom(), 17.6),
      pitch: 64,
      bearing: heading,
      offset: [0, 115],
      duration: 950,
      easing: (t) => t
    });
  } else {
    if (elIcone) elIcone.style.transform = `rotate(${heading}deg)`;

    glMap.easeTo({
      center: [lng, lat],
      zoom: Math.max(glMap.getZoom(), 16.8),
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
      const velocidadeMs = pos.coords.speed || 0;
      velocidadeAtualKmh = Math.max(0, Math.round(velocidadeMs * 3.6));

      const elSpeed = document.getElementById('hubySpeedVal');
      if (elSpeed) elSpeed.textContent = String(velocidadeAtualKmh);

      let heading = pos.coords.heading;

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

      if (heading === null || isNaN(heading) || (velocidadeMs > 0 && velocidadeMs < 0.6)) {
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
          velocidadeKmh: velocidadeAtualKmh,
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

function traduzirManobraOSRM(step) {
  const mod = step?.maneuver?.modifier || '';
  const tipo = step?.maneuver?.type || '';
  const nomeRua = step?.name ? `na ${step.name}` : 'na próxima via';
  const distMetros = Math.round(step?.distance || 0);

  let icone = '⬆️';
  let acao = `Siga em frente ${nomeRua}`;

  if (tipo === 'arrive') {
    icone = '🏁';
    acao = `Chegada ao destino ${nomeRua}`;
  } else if (mod.includes('left')) {
    icone = '⬅️';
    acao = `Vire à esquerda ${nomeRua}`;
  } else if (mod.includes('right')) {
    icone = '➡️';
    acao = `Vire à direita ${nomeRua}`;
  } else if (mod.includes('uturn')) {
    icone = '🔄';
    acao = `Faça o retorno ${nomeRua}`;
  } else if (step?.name) {
    acao = `Siga por ${step.name}`;
  }

  return { icone, acao, distMetros };
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
    // steps=true traz os nomes das ruas e as curvas (vire à direita/esquerda) gratuitamente
    const url = `https://router.project-osrm.org/route/v1/driving/${lngOrig},${latOrig};${lngDest},${latDest}?overview=full&geometries=geojson&steps=true`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const rota = data.routes[0];
      const coordenadasCurvas = rota.geometry.coordinates.map((c) => [c[1], c[0]]);

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
        weight: 7,
        opacity: 0.98
      }).addTo(estado.mapa);

      // Alimenta a Placa Superior de Navegação (Turn-by-Turn) com o nome da rua e distância real
      const steps = rota.legs?.[0]?.steps || [];
      const proximoPasso = steps.find((s) => s.distance > 15 && s.maneuver?.type !== 'depart') || steps[0];
      const distTotalKm = (rota.distance / 1000).toFixed(2);
      const tempoMin = Math.max(1, Math.round(rota.duration / 60));

      if (proximoPasso) {
        const info = traduzirManobraOSRM(proximoPasso);
        atualizarBannerNavegacao(
          true,
          info.icone,
          info.acao,
          `Em ${info.distMetros} m • Total: ${distTotalKm} km (~${tempoMin} min)`
        );
      }

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
    weight: 6,
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
  atualizarBannerNavegacao(false);

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