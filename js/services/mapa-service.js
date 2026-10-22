export class MapaService {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.markerDestino = null;
    this.rotaLayer = null;
    this.coordsOrigem = { lat: -8.358, lng: -42.246 };
  }

  inicializarMapa(onDestinoSelecionado = null) {
    if (!window.L) return;

    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.map) {
      this.map.remove();
    }

    this.map = L.map(this.containerId, { 
      zoomControl: false,
      attributionControl: false 
    }).setView([this.coordsOrigem.lat, this.coordsOrigem.lng], 16);

    // CAMADA PÚBLICA GRATUITA (CARTODB DARK MATTER - SEM CHAVE DE API)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19,
      minZoom: 3
    }).addTo(this.map);

    this.definirMarcadorOrigem(this.coordsOrigem.lat, this.coordsOrigem.lng);

    setTimeout(() => {
      this.map.invalidateSize();
    }, 250);

    if (onDestinoSelecionado) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirMarcadorDestino(lat, lng);
        const rota = await this.calcularRotaOSRM(this.coordsOrigem, { lat, lng });
        onDestinoSelecionado(rota, { lat, lng });
      });
    }
  }

  invalidarTamanho() {
    if (this.map) {
      setTimeout(() => this.map.invalidateSize(), 150);
    }
  }

  definirMarcadorOrigem(lat, lng) {
    this.coordsOrigem = { lat, lng };
    const iconeOrigem = L.divIcon({
      className: 'huby-pin-origem',
      html: `<div style="width:16px;height:16px;background:#10B981;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 0 12px rgba(16,185,129,0.85);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    if (this.markerOrigem) {
      this.markerOrigem.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerOrigem = L.marker([lat, lng], { icon: iconeOrigem }).addTo(this.map);
    }
  }

  definirMarcadorDestino(lat, lng) {
    const iconeDestino = L.divIcon({
      className: 'huby-pin-destino',
      html: `<div style="width:18px;height:18px;background:#FF6B00;border:3px solid #FFFFFF;border-radius:6px;box-shadow:0 0 12px rgba(255,107,0,0.85);"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    if (this.markerDestino) {
      this.markerDestino.setLatLng([lat, lng]);
    } else if (this.map) {
      this.markerDestino = L.marker([lat, lng], { icon: iconeDestino }).addTo(this.map);
    }
  }

  obterGPSAtual(callbackSucesso, seguirContinuo = true) {
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.definirMarcadorOrigem(latitude, longitude);
        if (this.map) {
          this.map.setView([latitude, longitude], 16, { animate: true });
        }
        this.invalidarTamanho();
        if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
      },
      (err) => console.warn('GPS:', err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async calcularRotaOSRM(origem, destino, corLinha = '#10B981') {
    const lat1 = Array.isArray(origem) ? origem[0] : origem.lat;
    const lon1 = Array.isArray(origem) ? origem[1] : origem.lng;
    const lat2 = Array.isArray(destino) ? destino[0] : destino.lat;
    const lon2 = Array.isArray(destino) ? destino[1] : destino.lng;

    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const rota = data.routes[0];
        const distanciaKm = Math.max(0.5, rota.distance / 1000);
        const duracaoMin = Math.max(2, Math.round(rota.duration / 60));

        if (this.rotaLayer && this.map) {
          this.map.removeLayer(this.rotaLayer);
        }

        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: { color: corLinha, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }
        }).addTo(this.map);

        if (this.map) {
          this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [50, 50], animate: true });
        }
        this.invalidarTamanho();

        return { distanciaKm: Number(distanciaKm.toFixed(1)), duracaoMin };
      }
    } catch (e) {
      console.warn('Erro OSRM:', e);
    }
    return { distanciaKm: 1.5, duracaoMin: 4 };
  }
}