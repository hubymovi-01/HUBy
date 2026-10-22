/**
 * ============================================================================
 * HUBy 2.0 - Serviço Central de Mapa e Rotas (js/mapa.js)
 * OpenStreetMap 100% Livre de Chaves + Roteamento OSRM
 * ============================================================================
 */

export class HubyMapa {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.markerDestino = null;
    this.rotaLayer = null;
    this.coordsOrigem = [-8.3580, -42.2460]; // São João do Piauí
    this.coordsDestino = null;
  }

  inicializar(onClickDestino = null) {
    if (!window.L) return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView(this.coordsOrigem, 16);

    // Tiles oficiais gratuitos do OpenStreetMap (sem chave de API)
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
      crossOrigin: true
    }).addTo(this.map);

    // Efeito Dark equilibrado (as ruas continuam nítidas sem marcas d'água)
    const aplicarDark = () => {
      const pane = container.querySelector('.leaflet-tile-pane');
      if (pane) {
        pane.style.filter = 'brightness(0.6) invert(1) contrast(1.3) hue-rotate(200deg) saturate(0.3)';
      }
    };
    tiles.on('load', aplicarDark);
    setTimeout(aplicarDark, 200);

    this.definirOrigem(this.coordsOrigem[0], this.coordsOrigem[1]);
    this.invalidarTamanho();

    if (onClickDestino) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirDestino(lat, lng);
        const rota = await this.calcularRota(this.coordsOrigem, [lat, lng]);
        onClickDestino(rota, { lat, lng });
      });
    }
  }

  invalidarTamanho() {
    if (this.map) {
      requestAnimationFrame(() => this.map.invalidateSize());
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 150);
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 500);
    }
  }

  definirOrigem(lat, lng) {
    this.coordsOrigem = [lat, lng];
    const icon = L.divIcon({
      className: 'huby-pin-origem',
      html: '<div style="width:16px;height:16px;background:#10B981;border:3px solid #FFF;border-radius:50%;box-shadow:0 0 12px rgba(16,185,129,0.9);"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    if (this.markerOrigem) {
      this.markerOrigem.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerOrigem = L.marker([lat, lng], { icon }).addTo(this.map);
    }
  }

  definirDestino(lat, lng) {
    this.coordsDestino = [lat, lng];
    const icon = L.divIcon({
      className: 'huby-pin-destino',
      html: '<div style="width:18px;height:18px;background:#FF6B00;border:3px solid #FFF;border-radius:6px;box-shadow:0 0 12px rgba(255,107,0,0.9);"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    if (this.markerDestino) {
      this.markerDestino.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerDestino = L.marker([lat, lng], { icon }).addTo(this.map);
    }
  }

  obterGPS(callbackSucesso) {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.definirOrigem(latitude, longitude);
        if (this.map) this.map.setView([latitude, longitude], 16, { animate: true });
        this.invalidarTamanho();
        if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
      },
      (err) => console.warn('GPS:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async buscarEndereco(texto) {
    if (!texto || texto.length < 3) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&limit=1&countrycodes=br`;
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' } });
      const dados = await res.json();
      if (dados && dados.length > 0) {
        return {
          nome: dados[0].display_name.split(',')[0],
          lat: parseFloat(dados[0].lat),
          lng: parseFloat(dados[0].lon)
        };
      }
    } catch (e) {
      console.warn('Erro Nominatim:', e);
    }
    return null;
  }

  async calcularRota(origem, destino, cor = '#10B981') {
    const lon1 = origem[1], lat1 = origem[0];
    const lon2 = destino[1], lat2 = destino[0];
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const rota = data.routes[0];
        const distanciaKm = Math.max(0.5, rota.distance / 1000);
        const duracaoMin = Math.max(2, Math.round(rota.duration / 60));

        if (this.rotaLayer && this.map) this.map.removeLayer(this.rotaLayer);

        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: { color: cor, weight: 5, opacity: 0.95 }
        }).addTo(this.map);

        this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [60, 60], animate: true });
        this.invalidarTamanho();

        return { distanciaKm: Number(distanciaKm.toFixed(1)), duracaoMin };
      }
    } catch (e) {
      console.warn('Erro OSRM:', e);
    }
    return { distanciaKm: 1.5, duracaoMin: 4 };
  }
}