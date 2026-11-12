/**
 * ============================================================================
 * HUBy 2.0 - Serviço Central de Mapa e Rotas (js/mapa.js)
 * CÓDIGO BLINDADO - Integrado às Tarifas Dinâmicas do Painel Admin Master
 * ============================================================================
 */
import { calcularPreco } from './config.js';

export class HubyMapa {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.circlePrecisao = null;
    this.markerDestino = null;
    this.markersParadas = [];
    this.rotaLayer = null;
    this.coordsOrigem = [-8.3580, -42.2460];
    this.coordsDestino = null;
    this.watchId = null;
    this.onClickDestinoCallback = null;
    this.gpsFixo = false;
  }

  inicializar(onClickDestino = null) {
    if (!window.L) return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.map) {
      if (this.watchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      try {
        this.map.off();
        this.map.remove();
      } catch (e) {
        console.warn('Aviso ao remover mapa anterior:', e);
      }
      this.map = null;
    }

    if (container._leaflet_id) {
      delete container._leaflet_id;
    }

    this.onClickDestinoCallback = onClickDestino;
    this.gpsFixo = false;

    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView(this.coordsOrigem, 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
      crossOrigin: true
    }).addTo(this.map);

    const pane = container.querySelector('.leaflet-tile-pane');
    if (pane) {
      pane.style.filter = 'brightness(0.7) invert(1) contrast(1.2) hue-rotate(200deg) saturate(0.3)';
    }

    this.invalidarTamanho();
    setTimeout(() => this.invalidarTamanho(), 300);

    if (onClickDestino) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirDestino(lat, lng);
        const rota = await this.calcularRota(this.coordsOrigem, [lat, lng], '#F59E0B', true);
        onClickDestino(rota, { lat, lng });
      });
    }

    this.obterGPSReal();
  }

  invalidarTamanho() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  definirOrigem(lat, lng, precisaoMetros = null) {
    this.coordsOrigem = [lat, lng];

    const icon = L.divIcon({
      className: 'huby-pin-origem',
      html: `
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;background:#10B981;border-radius:50%;opacity:0.4;animation:hubyPulse 1.8s infinite ease-out;"></div>
          <div style="position:absolute;inset:4px;background:#10B981;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 0 12px rgba(16,185,129,0.9);"></div>
        </div>
        <style>
          @keyframes hubyPulse {
            0% { transform: scale(0.9); opacity: 0.7; }
            70% { transform: scale(2.4); opacity: 0; }
            100% { transform: scale(2.4); opacity: 0; }
          }
        </style>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    if (this.markerOrigem) {
      this.markerOrigem.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerOrigem = L.marker([lat, lng], { icon }).addTo(this.map);
    }

    if (precisaoMetros && precisaoMetros > 0 && this.map) {
      const raio = Math.min(precisaoMetros, 80);
      if (this.circlePrecisao) {
        this.circlePrecisao.setLatLng([lat, lng]).setRadius(raio);
      } else {
        this.circlePrecisao = L.circle([lat, lng], {
          radius: raio,
          color: '#10B981',
          weight: 1,
          fillColor: '#10B981',
          fillOpacity: 0.1
        }).addTo(this.map);
      }
    }
  }

  definirDestino(lat, lng) {
    this.coordsDestino = [lat, lng];
    const icon = L.divIcon({
      className: 'huby-pin-destino',
      html: '<div style="width:20px;height:20px;background:#FF6B00;border:3px solid #FFF;border-radius:6px;box-shadow:0 0 12px rgba(255,107,0,0.9);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    if (this.markerDestino) {
      this.markerDestino.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerDestino = L.marker([lat, lng], { icon }).addTo(this.map);
    }
  }

  atualizarMarcadoresParadas(paradas = []) {
    if (!this.map) return;
    this.markersParadas.forEach(m => this.map.removeLayer(m));
    this.markersParadas = [];

    paradas.forEach((p, idx) => {
      if (!p.coords) return;
      const icon = L.divIcon({
        className: 'huby-pin-parada',
        html: `<div style="width:18px;height:18px;background:#38BDF8;color:#000;font-size:10px;font-weight:900;border:2px solid #FFF;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 8px rgba(56,189,248,0.9);">${idx + 1}</div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });
      const marker = L.marker(p.coords, { icon }).addTo(this.map);
      this.markersParadas.push(marker);
    });
  }

  obterGPSReal(callbackSucesso = null) {
    if (!('geolocation' in navigator)) return;

    const atualizarPosicaoTempoReal = async (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const precisao = pos.coords.accuracy;

      this.coordsOrigem = [lat, lng];
      this.definirOrigem(lat, lng, precisao);

      if (!this.gpsFixo) {
        if (this.map) {
          this.map.flyTo([lat, lng], 17, { animate: true, duration: 1.0 });
          this.invalidarTamanho();
        }
        this.gpsFixo = true;
      }

      if (this.coordsDestino && this.onClickDestinoCallback) {
        const rota = await this.calcularRota([lat, lng], this.coordsDestino, '#F59E0B', true);
        this.onClickDestinoCallback(rota, { lat: this.coordsDestino[0], lng: this.coordsDestino[1] });
      }

      if (callbackSucesso) callbackSucesso({ lat, lng });
    };

    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);

    this.watchId = navigator.geolocation.watchPosition(
      atualizarPosicaoTempoReal,
      (err) => console.warn('Aviso GPS em tempo real:', err.message),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  obterGPS(callbackSucesso) {
    this.gpsFixo = false;
    this.obterGPSReal(callbackSucesso);
  }

  desenharRota(geometria, cor = '#38BDF8') {
    if (!this.map || !geometria) return;

    if (this.rotaLayer) {
      this.map.removeLayer(this.rotaLayer);
      this.rotaLayer = null;
    }

    this.rotaLayer = L.geoJSON(geometria, {
      style: {
        color: cor,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round'
      }
    }).addTo(this.map);

    this.invalidarTamanho();
    this.map.fitBounds(this.rotaLayer.getBounds(), {
      padding: [40, 40],
      maxZoom: 16,
      animate: true
    });
  }

  async calcularRota(origem, destino, cor = '#10B981', exibirLinha = true, pontosIntermediarios = []) {
    if (!origem || !destino) return null;

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
      } catch (e) {
        console.warn(`Falha na rota (${url}), testando próxima...`);
      }
    }

    if (data && data.routes && data.routes.length > 0) {
      const rota = data.routes[0];
      const distanciaKm = Math.max(0.2, rota.distance / 1000);
      const duracaoMin = Math.max(2, Math.round(rota.duration / 60));

      // Usa a tarifa oficial sincronizada do banco de dados (config.js)
      const precoEstimado = calcularPreco('carro', distanciaKm, duracaoMin).valorTotal;

      if (this.rotaLayer && this.map) {
        this.map.removeLayer(this.rotaLayer);
        this.rotaLayer = null;
      }

      if (exibirLinha && this.map) {
        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: {
            color: cor,
            weight: 5,
            opacity: 0.95,
            lineJoin: 'round',
            lineCap: 'round'
          }
        }).addTo(this.map);

        setTimeout(() => {
          if (this.map && this.rotaLayer) {
            this.map.invalidateSize();
            this.map.fitBounds(this.rotaLayer.getBounds(), {
              paddingTopLeft: [30, 30],
              paddingBottomRight: [30, 160],
              maxZoom: 16,
              animate: true
            });
          }
        }, 150);
      }

      return {
        distanciaKm: Number(distanciaKm.toFixed(2)),
        duracaoMin,
        preco: Number(precoEstimado.toFixed(2)),
        geometria: rota.geometry
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

    if (exibirLinha && this.map) {
      if (this.rotaLayer) this.map.removeLayer(this.rotaLayer);
      this.rotaLayer = L.polyline([origem, destino], {
        color: cor,
        weight: 4,
        dashArray: '6, 8',
        opacity: 0.8
      }).addTo(this.map);

      this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [40, 40], maxZoom: 15 });
    }

    return {
      distanciaKm: Number(distEstimada.toFixed(2)),
      duracaoMin: duracaoEstimada,
      preco: Number(precoEstimadoFallback.toFixed(2)),
      geometria: null
    };
  }
}