/**
 * ============================================================================
 * HUBy 2.0 - Serviço Central de Mapa e Rotas (js/mapa.js)
 * OpenStreetMap + GPS Real Progressivo (Imediato por Rede + Satélite de Alta Precisão)
 * ============================================================================
 */

export class HubyMapa {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.circlePrecisao = null;
    this.markerDestino = null;
    this.rotaLayer = null;
    this.coordsOrigem = [-8.3580, -42.2460]; // Ponto de contingência estrito
    this.coordsDestino = null;
    this.watchId = null;
    this.onClickDestinoCallback = null;
    this.jaCentralizouGPS = false;
  }

  inicializar(onClickDestino = null) {
    if (!window.L) return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.map) {
      if (this.watchId !== null) navigator.geolocation?.clearWatch(this.watchId);
      this.map.remove();
      this.map = null;
    }

    this.jaCentralizouGPS = false;
    this.onClickDestinoCallback = onClickDestino;

    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView(this.coordsOrigem, 16);

    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
      crossOrigin: true
    }).addTo(this.map);

    const aplicarDark = () => {
      const pane = container.querySelector('.leaflet-tile-pane');
      if (pane) {
        pane.style.filter = 'brightness(0.6) invert(1) contrast(1.3) hue-rotate(200deg) saturate(0.3)';
      }
    };
    tiles.on('load', aplicarDark);
    setTimeout(aplicarDark, 200);

    this.invalidarTamanho();

    if (onClickDestino) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirDestino(lat, lng);
        const rota = await this.calcularRota(this.coordsOrigem, [lat, lng]);
        onClickDestino(rota, { lat, lng });
      });
    }

    // Dispara a busca real de localização imediatamente
    this.obterGPSReal();
  }

  invalidarTamanho() {
    if (this.map) {
      requestAnimationFrame(() => this.map.invalidateSize());
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 150);
      setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 500);
    }
  }

  definirOrigem(lat, lng, precisaoMetros = null) {
    this.coordsOrigem = [lat, lng];

    const icon = L.divIcon({
      className: 'huby-pin-origem',
      html: `
        <div style="position:relative;width:24px;height:24px;">
          <div style="position:absolute;inset:0;background:#10B981;border-radius:50%;opacity:0.4;animation:hubyPulse 1.8s infinite ease-out;"></div>
          <div style="position:absolute;inset:4px;background:#10B981;border:3px solid #FFFFFF;border-radius:50%;box-shadow:0 0 14px rgba(16,185,129,0.9);"></div>
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

  // Captura progressiva: primeiro instantânea por rede, depois satélite preciso
  obterGPSReal(callbackSucesso) {
    if (!('geolocation' in navigator)) {
      alert('Geolocalização não é suportada pelo seu dispositivo.');
      return;
    }

    const aplicarPosicao = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      this.coordsOrigem = [latitude, longitude];
      this.definirOrigem(latitude, longitude, accuracy);

      if (this.map) {
        this.map.flyTo([latitude, longitude], 17, { duration: 1.2 });
        this.invalidarTamanho();
      }

      this.jaCentralizouGPS = true;
      if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
    };

    // 1. Passo Rápido: Pega localização imediata por torres de celular / Wi-Fi
    navigator.geolocation.getCurrentPosition(
      aplicarPosicao,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          alert('Localização desativada ou bloqueada. Toque no cadeado junto ao link do site e autorize o acesso à sua Localização.');
        } else {
          console.warn('Tentativa 1 (Rede) falhou, aguardando satélite...', err.message);
        }
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 10000 }
    );

    // 2. Passo Contínuo: Calibra com o chip GPS do satélite e refina a coordenada exata
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);

    this.watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        this.definirOrigem(latitude, longitude, accuracy);

        // Se ainda não moveu o mapa para você, move agora
        if (!this.jaCentralizouGPS && this.map) {
          this.map.flyTo([latitude, longitude], 17, { duration: 1.0 });
          this.jaCentralizouGPS = true;
        }

        // Recalcula rota se já escolheu o destino
        if (this.coordsDestino && this.onClickDestinoCallback) {
          const rota = await this.calcularRota([latitude, longitude], this.coordsDestino);
          this.onClickDestinoCallback(rota, { lat: this.coordsDestino[0], lng: this.coordsDestino[1] });
        }
      },
      (err) => console.warn('Monitoramento contínuo GPS:', err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  obterGPS(callbackSucesso) {
    this.jaCentralizouGPS = false;
    this.obterGPSReal(callbackSucesso);
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