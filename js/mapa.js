/**
 * ============================================================================
 * HUBy 2.0 - Serviço Central de Mapa e Rotas (js/mapa.js)
 * OpenStreetMap + Localização Real Obrigatória com Fallback e Diagnóstico
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
    this.coordsOrigem = [-8.3580, -42.2460]; // Ponto de contingência se o GPS falhar
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

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 3,
      crossOrigin: true
    }).addTo(this.map);

    const aplicarEstiloDark = () => {
      const pane = container.querySelector('.leaflet-tile-pane');
      if (pane) {
        pane.style.filter = 'brightness(0.7) invert(1) contrast(1.2) hue-rotate(200deg) saturate(0.3)';
      }
    };
    aplicarEstiloDark();

    this.invalidarTamanho();
    setTimeout(() => this.invalidarTamanho(), 200);

    if (onClickDestino) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirDestino(lat, lng);
        const rota = await this.calcularRota(this.coordsOrigem, [lat, lng]);
        onClickDestino(rota, { lat, lng });
      });
    }

    // Solicita a localização real imediatamente
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

  obterGPSReal(callbackSucesso) {
    if (!('geolocation' in navigator)) {
      alert('O seu navegador não suporta geolocalização.');
      return;
    }

    const aplicarPosicao = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const precisao = pos.coords.accuracy;

      this.coordsOrigem = [lat, lng];
      this.definirOrigem(lat, lng, precisao);

      if (this.map) {
        this.map.setView([lat, lng], 17);
        this.invalidarTamanho();
      }

      this.jaCentralizouGPS = true;
      if (callbackSucesso) callbackSucesso({ lat, lng });
    };

    const tratarErro = (err) => {
      console.warn('Erro na obtenção primária do GPS:', err);

      // Tenta obter posição sem alta precisão (torres de rede / Wi-Fi)
      navigator.geolocation.getCurrentPosition(
        aplicarPosicao,
        (errFallback) => {
          if (err.code === err.PERMISSION_DENIED) {
            alert('Acesso à localização negado. Aceda às definições do navegador e permita o acesso à localização.');
          } else {
            alert('Não foi possível obter a sua localização exata. Certifique-se de que o GPS do telemóvel está ligado.');
          }
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    };

    // 1. Leitura direta
    navigator.geolocation.getCurrentPosition(
      aplicarPosicao,
      tratarErro,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // 2. Rastreamento ativo para calibrar com o satélite
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const precisao = pos.coords.accuracy;

        this.definirOrigem(lat, lng, precisao);

        if (!this.jaCentralizouGPS && this.map) {
          this.map.flyTo([lat, lng], 17, { duration: 1.0 });
          this.jaCentralizouGPS = true;
        }

        if (this.coordsDestino && this.onClickDestinoCallback) {
          this.calcularRota([lat, lng], this.coordsDestino).then((rota) => {
            this.onClickDestinoCallback(rota, { lat: this.coordsDestino[0], lng: this.coordsDestino[1] });
          });
        }
      },
      (err) => console.warn('Acompanhamento GPS contínuo:', err.message),
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