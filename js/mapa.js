/**
 * ============================================================================
 * HUBy 2.6 - Serviço Central de Mapa 3D na Paleta Escura Oficial (js/mapa.js)
 * Motor Vetorial MapLibre GL 3D (OpenFreeMap Liberty + Tema Dark HUBy)
 * ============================================================================
 */
import { calcularPreco } from './config.js';

const URL_ESTILO_3D_BASE = 'https://tiles.openfreemap.org/styles/liberty';

const ESTILO_SATELITE_3D = {
  version: 8,
  sources: {
    esriSatelite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256
    }
  },
  layers: [
    {
      id: 'camada-satelite-base',
      type: 'raster',
      source: 'esriSatelite'
    }
  ]
};

function aplicarPaletaEscuraHUBy(map) {
  if (!map) return;
  const style = map.getStyle();
  if (!style || !Array.isArray(style.layers)) return;

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    const tipo = layer.type;

    try {
      if (tipo === 'background') {
        map.setPaintProperty(layer.id, 'background-color', '#090D16');
      } else if (tipo === 'fill') {
        if (id.includes('water')) {
          map.setPaintProperty(layer.id, 'fill-color', '#0B192C');
        } else if (id.includes('park') || id.includes('green') || id.includes('wood') || id.includes('grass')) {
          map.setPaintProperty(layer.id, 'fill-color', '#0C1F1D');
        } else if (id.includes('building')) {
          map.setPaintProperty(layer.id, 'fill-color', '#131C2E');
          map.setPaintProperty(layer.id, 'fill-outline-color', '#1E293B');
        } else {
          map.setPaintProperty(layer.id, 'fill-color', '#0D1320');
        }
      } else if (tipo === 'fill-extrusion') {
        map.setPaintProperty(layer.id, 'fill-extrusion-color', '#152036');
        map.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0.88);
      } else if (tipo === 'line') {
        if (id.includes('water')) {
          map.setPaintProperty(layer.id, 'line-color', '#0B192C');
        } else if (id.includes('motorway') || id.includes('trunk') || id.includes('primary')) {
          map.setPaintProperty(layer.id, 'line-color', '#26354D');
        } else if (id.includes('secondary') || id.includes('tertiary') || id.includes('road') || id.includes('street')) {
          map.setPaintProperty(layer.id, 'line-color', '#1B263B');
        } else if (id.includes('boundary') || id.includes('admin')) {
          map.setPaintProperty(layer.id, 'line-color', '#334155');
        } else {
          map.setPaintProperty(layer.id, 'line-color', '#162033');
        }
      } else if (tipo === 'symbol') {
        map.setPaintProperty(layer.id, 'text-color', '#CBD5E1');
        map.setPaintProperty(layer.id, 'text-halo-color', '#090D16');
        map.setPaintProperty(layer.id, 'text-halo-width', 1.4);
      }
    } catch (e) {}
  }
}

function criarAdapterMarker(markerMapLibre, coordsIniciais) {
  if (!markerMapLibre) return null;
  markerMapLibre.getLatLng = () => {
    const ll = markerMapLibre.getLngLat?.();
    return ll ? { lat: ll.lat, lng: ll.lng } : { lat: coordsIniciais[0], lng: coordsIniciais[1] };
  };
  return markerMapLibre;
}

export class HubyMapa {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.userMarker = null;
    this.markerDestino = null;
    this.markersParadas = [];
    this.rotaLayer = null;
    this.coordsOrigem = [-8.3580, -42.2460];
    this.coordsGPSReal = [-8.3580, -42.2460];
    this.origemPersonalizada = false;
    this.coordsDestino = null;
    this.posicaoAtual = null;
    this.watchId = null;
    this.onClickDestinoCallback = null;
    this.gpsFixo = false;
    this.modoSatelite = false;
    this.mapaPronto = false;
    this._ultimaGeometriaRota = null;
    this._ultimaCorRota = '#10B981';
  }

  inicializar(onClickDestino = null) {
    const container = document.getElementById(this.containerId);
    if (!container || !window.maplibregl) return;

    if (this.map) {
      if (this.watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      try {
        this.map.remove();
      } catch (e) {}
      this.map = null;
    }

    container.innerHTML = '';
    this.onClickDestinoCallback = onClickDestino;
    this.gpsFixo = false;
    this.mapaPronto = false;

    this.map = new maplibregl.Map({
      container: this.containerId,
      style: URL_ESTILO_3D_BASE,
      center: [this.coordsOrigem[1], this.coordsOrigem[0]],
      zoom: 16.2,
      pitch: 45,
      bearing: 0,
      antialias: true,
      attributionControl: false
    });

    this.map.invalidateSize = () => {
      try {
        this.map?.resize();
      } catch (e) {}
    };
    this.map.removeLayer = (layerRef) => {
      if (layerRef === this.rotaLayer) this.limparRota();
      if (layerRef === this.markerDestino) this.limparDestino();
    };

    this.map.on('load', () => {
      this.mapaPronto = true;
      aplicarPaletaEscuraHUBy(this.map);
      this.definirOrigem(this.coordsOrigem[0], this.coordsOrigem[1]);
    });

    if (onClickDestino) {
      this.map.on('click', async (e) => {
        const lat = e.lngLat.lat;
        const lng = e.lngLat.lng;
        this.definirDestino(lat, lng);
        const rota = await this.calcularRota(this.coordsOrigem, [lat, lng], '#10B981', true);
        onClickDestino(rota, { lat, lng });
      });
    }

    this.obterGPSReal();
  }

  invalidarTamanho() {
    if (this.map) {
      try {
        this.map.resize();
      } catch (e) {}
    }
  }

  alternarSatelite(forcarEstado = null) {
    if (!this.map) return false;
    this.modoSatelite = typeof forcarEstado === 'boolean' ? forcarEstado : !this.modoSatelite;

    const geometriaSalva = this._ultimaGeometriaRota || null;
    const corSalva = this._ultimaCorRota || '#10B981';

    this.map.setStyle(this.modoSatelite ? ESTILO_SATELITE_3D : URL_ESTILO_3D_BASE);

    this.map.once('style.load', () => {
      if (!this.modoSatelite) {
        aplicarPaletaEscuraHUBy(this.map);
      }
      if (geometriaSalva) {
        this.desenharRota(geometriaSalva, corSalva);
      }
    });

    return this.modoSatelite;
  }

  definirOrigem(lat, lng, precisaoMetros = null, ehPersonalizada = false) {
    this.coordsOrigem = [lat, lng];
    if (ehPersonalizada) {
      this.origemPersonalizada = true;
    }

    if (!this.map || !window.maplibregl) return;

    if (this.markerOrigem) {
      this.markerOrigem.setLngLat([lng, lat]);
    } else {
      const el = document.createElement('div');
      el.className = 'gps-pulse-container';
      el.style.cssText = 'width:44px;height:44px;display:flex;align-items:center;justify-content:center;pointer-events:none;';
      el.innerHTML = `
        <div class="gps-pulse-marker" style="width:18px;height:18px;border-radius:50%;background:#10B981;border:3px solid #FFF;box-shadow:0 0 18px rgba(16,185,129,0.95);"></div>
      `;
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
      this.markerOrigem = criarAdapterMarker(m, [lat, lng]);
      this.userMarker = this.markerOrigem;
    }

    if (ehPersonalizada && !this.coordsDestino) {
      this.map.flyTo({
        center: [lng, lat],
        zoom: 16,
        pitch: 45,
        duration: 900
      });
    }
  }

  definirDestino(lat, lng) {
    this.coordsDestino = [lat, lng];
    if (!this.map || !window.maplibregl) return;

    if (this.markerDestino) {
      this.markerDestino.setLngLat([lng, lat]);
    } else {
      const el = document.createElement('div');
      el.style.cssText = 'width:22px;height:22px;background:#EF4444;border:3px solid #FFF;border-radius:50%;box-shadow:0 2px 14px rgba(239,68,68,0.95);';
      const m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(this.map);
      this.markerDestino = criarAdapterMarker(m, [lat, lng]);
    }
  }

  limparDestino() {
    this.coordsDestino = null;
    if (this.markerDestino) {
      try {
        this.markerDestino.remove();
      } catch (e) {}
      this.markerDestino = null;
    }
  }

  limparRota() {
    this.rotaLayer = null;
    this._ultimaGeometriaRota = null;
    if (!this.map) return;
    try {
      if (this.map.getLayer('huby-rota-linha')) this.map.removeLayer('huby-rota-linha');
      if (this.map.getLayer('huby-rota-borda')) this.map.removeLayer('huby-rota-borda');
      if (this.map.getSource('huby-rota-source')) this.map.removeSource('huby-rota-source');
    } catch (e) {}
  }

  atualizarMarcadoresParadas(paradas = []) {
    if (!this.map || !window.maplibregl) return;
    this.markersParadas.forEach(m => {
      try { m.remove(); } catch (e) {}
    });
    this.markersParadas = [];

    paradas.forEach((p, idx) => {
      if (!p.coords) return;
      const el = document.createElement('div');
      el.style.cssText = 'width:20px;height:20px;background:#38BDF8;color:#02131D;font-size:11px;font-weight:900;border:2px solid #FFF;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.6);';
      el.textContent = String(idx + 1);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.coords[1], p.coords[0]])
        .addTo(this.map);
      this.markersParadas.push(marker);
    });
  }

  obterGPSReal(callbackSucesso = null) {
    if (!('geolocation' in navigator)) return;

    const atualizarPosicaoTempoReal = async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const precisao = pos.coords.accuracy;

      this.coordsGPSReal = [lat, lng];
      this.posicaoAtual = { lat, lng };

      if (!this.origemPersonalizada) {
        this.coordsOrigem = [lat, lng];
        this.definirOrigem(lat, lng, precisao, false);

        if (this.map) {
          if (!this.gpsFixo) {
            this.map.flyTo({
              center: [lng, lat],
              zoom: 16.5,
              pitch: 45,
              duration: 1000
            });
            this.gpsFixo = true;
          } else if (!this.rotaLayer) {
            this.map.easeTo({
              center: [lng, lat],
              duration: 800
            });
          }
        }
      }

      if (callbackSucesso) callbackSucesso({ lat, lng });
    };

    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);

    this.watchId = navigator.geolocation.watchPosition(
      atualizarPosicaoTempoReal,
      (err) => console.warn('Aviso GPS em tempo real:', err.message),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    );
  }

  obterGPS(callbackSucesso) {
    this.origemPersonalizada = false;
    this.gpsFixo = false;
    if (this.coordsGPSReal) {
      this.definirOrigem(this.coordsGPSReal[0], this.coordsGPSReal[1], null, false);
      this.map?.flyTo({
        center: [this.coordsGPSReal[1], this.coordsGPSReal[0]],
        zoom: 16.5,
        pitch: 45,
        duration: 900
      });
    }
    this.obterGPSReal(callbackSucesso);
  }

  desenharRota(geometria, cor = '#10B981', coordsBounds = null) {
    if (!this.map || !geometria) return;

    const aplicarRota = () => {
      this._ultimaGeometriaRota = geometria;
      this._ultimaCorRota = cor;

      const featureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: geometria
        }]
      };

      const sourceExistente = this.map.getSource('huby-rota-source');
      if (sourceExistente) {
        sourceExistente.setData(featureCollection);
      } else {
        this.map.addSource('huby-rota-source', {
          type: 'geojson',
          data: featureCollection
        });

        this.map.addLayer({
          id: 'huby-rota-borda',
          type: 'line',
          source: 'huby-rota-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#10B981',
            'line-width': 11,
            'line-opacity': 0.28
          }
        });

        this.map.addLayer({
          id: 'huby-rota-linha',
          type: 'line',
          source: 'huby-rota-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#34D399',
            'line-width': 5,
            'line-opacity': 1
          }
        });
      }

      this.rotaLayer = { id: 'huby-rota-linha' };

      const pontos = Array.isArray(geometria.coordinates) ? geometria.coordinates : coordsBounds;
      if (Array.isArray(pontos) && pontos.length >= 2) {
        const bounds = pontos.reduce(
          (b, coord) => b.extend(coord),
          new maplibregl.LngLatBounds(pontos[0], pontos[0])
        );
        this.map.fitBounds(bounds, {
          padding: { top: 90, bottom: 380, left: 45, right: 45 },
          pitch: 40,
          maxZoom: 16,
          duration: 900
        });
      }
    };

    if (this.mapaPronto) aplicarRota();
    else this.map.once('load', aplicarRota);
  }

  async calcularRota(origem, destino, cor = '#10B981', exibirLinha = true, pontosIntermediarios = []) {
    if (!origem || !destino) return null;

    this.definirOrigem(origem[0], origem[1]);
    this.definirDestino(destino[0], destino[1]);

    const pontos = [origem, ...pontosIntermediarios, destino];
    const coordenadasStr = pontos.map(p => `${p[1]},${p[0]}`).join(';');

    const urls = [
      `https://router.project-osrm.org/route/v1/driving/${coordenadasStr}?overview=full&geometries=geojson`,
      `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordenadasStr}?overview=full&geometries=geojson`
    ];

    let data = null;

    for (const url of urls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const json = await resp.json();
          if (json.code === 'Ok' && json.routes && json.routes.length > 0) {
            data = json;
            break;
          }
        }
      } catch (e) {}
    }

    if (data && data.routes && data.routes.length > 0) {
      const rota = data.routes[0];
      const distanciaKm = Math.max(0.2, rota.distance / 1000);
      const duracaoMin = Math.max(2, Math.round(rota.duration / 60));
      const precoEstimado = calcularPreco('carro', distanciaKm, duracaoMin).valorTotal;

      if (exibirLinha && this.map) {
        this.desenharRota(rota.geometry, cor);
      }

      return {
        distanciaKm: Number(distanciaKm.toFixed(2)),
        duracaoMin,
        preco: Number(precoEstimado.toFixed(2)),
        geometria: rota.geometry,
        origemCoords: origem,
        destinoCoords: destino
      };
    }

    const lat1 = origem[0], lon1 = origem[1];
    const lat2 = destino[0], lon2 = destino[1];
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    const distEstimada = Math.max(0.3, 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3);
    const duracaoEstimada = Math.max(2, Math.round(distEstimada * 2.2));
    const precoEstimadoFallback = calcularPreco('carro', distEstimada, duracaoEstimada).valorTotal;

    const geomLinhaReta = {
      type: 'LineString',
      coordinates: [
        [lon1, lat1],
        [lon2, lat2]
      ]
    };

    if (exibirLinha && this.map) {
      this.desenharRota(geomLinhaReta, cor);
    }

    return {
      distanciaKm: Number(distEstimada.toFixed(2)),
      duracaoMin: duracaoEstimada,
      preco: Number(precoEstimadoFallback.toFixed(2)),
      geometria: geomLinhaReta,
      origemCoords: origem,
      destinoCoords: destino
    };
  }
}