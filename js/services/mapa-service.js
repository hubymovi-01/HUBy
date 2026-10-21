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

    // Coordenada padrão (São João do Piauí / Região)
    this.coordsOrigem = { lat: -8.358, lng: -42.246 };
    this.coordsDestino = null;
  }

  inicializarMapa(onDestinoSelecionado = null) {
    if (!window.L) {
      console.error('Biblioteca Leaflet não carregada.');
      return;
    }

    const container = document.getElementById(this.containerId);
    if (!container) return;

    this.map = L.map(this.containerId, { 
      zoomControl: false,
      attributionControl: false 
    }).setView([this.coordsOrigem.lat, this.coordsOrigem.lng], 15);

    // CartoDB Dark Matter para harmonia visual com o HUBy
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    this.definirMarcadorOrigem(this.coordsOrigem.lat, this.coordsOrigem.lng);

    // Previne blocos cinzentos ao renderizar no mobile
    setTimeout(() => this.invalidarTamanho(), 250);
    setTimeout(() => this.invalidarTamanho(), 600);
    window.addEventListener('resize', () => this.invalidarTamanho());

    // Permite tocar/clicar no mapa para definir o destino
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
      html: `<div style="width:16px;height:16px;background:#10B981;border:3px solid #fff;border-radius:50%;box-shadow:0 0 10px #10B981;"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    if (this.markerOrigem) {
      this.markerOrigem.setLatLng([lat, lng]);
    } else {
      this.markerOrigem = L.marker([lat, lng], { icon: iconeOrigem }).addTo(this.map);
    }
  }

  definirMarcadorDestino(lat, lng) {
    this.coordsDestino = { lat, lng };
    const iconeDestino = L.divIcon({
      className: 'huby-pin-destino',
      html: `<div style="width:18px;height:18px;background:#F97316;border:3px solid #fff;border-radius:6px;box-shadow:0 0 10px #F97316;"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    if (this.markerDestino) {
      this.markerDestino.setLatLng([lat, lng]);
    } else {
      this.markerDestino = L.marker([lat, lng], { icon: iconeDestino }).addTo(this.map);
    }
  }

  obterGPSAtual(callbackSucesso) {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.definirMarcadorOrigem(latitude, longitude);
        this.map.setView([latitude, longitude], 16, { animate: true });
        this.invalidarTamanho();
        if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
      },
      (err) => console.warn('GPS indisponível:', err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

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

  async calcularRotaOSRM(origem, destino, corLinha = '#10B981') {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes.length > 0) {
        const rota = data.routes[0];
        const distanciaKm = Math.max(0.5, rota.distance / 1000);
        const duracaoMin = Math.max(2, Math.round(rota.duration / 60));

        if (this.rotaLayer) {
          this.map.removeLayer(this.rotaLayer);
        }

        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: { 
            color: corLinha, 
            weight: 5, 
            opacity: 0.95,
            dashArray: '6, 8',
            lineCap: 'round',
            lineJoin: 'round'
          }
        }).addTo(this.map);

        this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [60, 60], animate: true });
        setTimeout(() => this.invalidarTamanho(), 200);

        return { distanciaKm, duracaoMin };
      }
    } catch (erro) {
      console.warn('OSRM indisponível, aplicando fallback linear.', erro);
    }

    const distLinear = this.calcularDistanciaHaversine(origem, destino);
    return { distanciaKm: distLinear, duracaoMin: Math.round(distLinear * 2.5 + 2) };
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
    return Math.max(0.5, Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1)));
  }
}