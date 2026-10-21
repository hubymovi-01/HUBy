/**
 * ============================================================================
 * HUBy - Serviço de Mapa, Geolocalização (GPS) e Cálculo de Rotas (OSRM)
 * Arquivo: js/services/mapa-service.js
 * ============================================================================
 */

export class MapaService {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.markerDestino = null;
    this.rotaLayer = null;
    this.watchId = null;

    // Coordenada padrão de inicialização (fallback)
    this.coordsOrigem = { lat: -8.358, lng: -42.246 };
    this.coordsDestino = null;
  }

  inicializarMapa(onDestinoSelecionado = null) {
    if (!window.L) {
      console.error('Biblioteca Leaflet não carregada no ambiente.');
      return;
    }

    const container = document.getElementById(this.containerId);
    if (!container) return;

    this.map = L.map(this.containerId, { 
      zoomControl: false,
      attributionControl: false 
    }).setView([this.coordsOrigem.lat, this.coordsOrigem.lng], 16);

    // CartoDB Dark Matter: Renderização escura nativa de alta performance
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    this.definirMarcadorOrigem(this.coordsOrigem.lat, this.coordsOrigem.lng);

    // Elimina quadrantes cinzentos comuns no carregamento mobile
    setTimeout(() => this.invalidarTamanho(), 200);
    setTimeout(() => this.invalidarTamanho(), 500);
    window.addEventListener('resize', () => this.invalidarTamanho());

    // Permite tocar no mapa para traçar o destino instantaneamente
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
      this.map.invalidateSize();
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
    this.coordsDestino = { lat, lng };
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

  // 1. OBTENÇÃO DE GPS IMEDIATA E CONTÍNUA (ALTA PRECISÃO)
  obterGPSAtual(callbackSucesso, seguirContinuo = true) {
    if (!('geolocation' in navigator)) return;

    const opcoes = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    // Leitura pontual
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
      (err) => console.warn('GPS inicial:', err.message),
      opcoes
    );

    // Acompanhamento contínuo em tempo real
    if (seguirContinuo && !this.watchId) {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          this.definirMarcadorOrigem(latitude, longitude);
          if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
        },
        (err) => console.warn('Watch GPS:', err.message),
        { enableHighAccuracy: true, maximumAge: 3000 }
      );
    }
  }

  // 2. BUSCA DE ENDEREÇOS VIA NOMINATIM
  async buscarEnderecoNominatim(textoBusca) {
    if (!textoBusca || textoBusca.length < 3) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(textoBusca)}&limit=1&countrycodes=br`;
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

  // 3. MOTOR DE TRAÇADO REAL VIÁRIO POR RUAS (OSRM)
  async calcularRotaOSRM(origem, destino, corLinha = '#10B981') {
    // Normalização para aceitar formato {lat, lng} ou array [lat, lng]
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

        // Linha viária contínua e sólida, com cantos arredondados
        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: { 
            color: corLinha, 
            weight: 5, 
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          }
        }).addTo(this.map);

        if (this.map) {
          this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [60, 60], animate: true });
        }
        setTimeout(() => this.invalidarTamanho(), 200);

        return { 
          distanciaKm: Number(distanciaKm.toFixed(1)), 
          duracaoMin 
        };
      }
    } catch (erro) {
      console.warn('OSRM inacessível momentaneamente, traçando fallback auxiliar.', erro);
    }

    // Fallback Geodésico
    const distLinear = this.calcularDistanciaHaversine({ lat: lat1, lng: lon1 }, { lat: lat2, lng: lon2 });
    return { 
      distanciaKm: distLinear, 
      duracaoMin: Math.round(distLinear * 2.4 + 2) 
    };
  }

  limparRota() {
    if (this.rotaLayer && this.map) {
      this.map.removeLayer(this.rotaLayer);
      this.rotaLayer = null;
    }
    if (this.markerDestino && this.map) {
      this.map.removeLayer(this.markerDestino);
      this.markerDestino = null;
    }
    this.coordsDestino = null;
  }

  calcularDistanciaHaversine(p1, p2) {
    const R = 6371;
    const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
    const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((p1.lat * Math.PI) / 180) *
        Math.cos((p2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return Math.max(0.5, Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.3).toFixed(1)));
  }
}