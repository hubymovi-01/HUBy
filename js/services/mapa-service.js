/**
 * ============================================================================
 * HUBy - Serviço de Mapa, Geolocalização (GPS) e Cálculo de Rotas (OSRM)
 * ============================================================================
 */

export class MapaService {
  constructor(containerId) {
    this.containerId = containerId;
    this.map = null;
    this.markerOrigem = null;
    this.markerDestino = null;
    this.rotaLayer = null;

    // Coordenada inicial padrão (ajustada automaticamente pelo GPS do utilizador)
    this.coordsOrigem = { lat: -8.358, lng: -42.246 };
    this.coordsDestino = null;
  }

  inicializarMapa(onDestinoSelecionado = null) {
    if (!window.L) {
      console.error('Biblioteca Leaflet não carregada.');
      return;
    }

    this.map = L.map(this.containerId, { zoomControl: false }).setView(
      [this.coordsOrigem.lat, this.coordsOrigem.lng],
      15
    );

    // Tema escuro moderno (CartoDB Dark Matter) alinhado com a identidade HUBy
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    this.definirMarcadorOrigem(this.coordsOrigem.lat, this.coordsOrigem.lng);

    // Permite clicar no mapa para definir rapidamente o destino
    if (onDestinoSelecionado) {
      this.map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        this.definirMarcadorDestino(lat, lng);
        const rota = await this.calcularRotaOSRM(this.coordsOrigem, { lat, lng });
        onDestinoSelecionado(rota, { lat, lng });
      });
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
      html: `<div style="width:18px;height:18px;background:#FF6B00;border:3px solid #fff;border-radius:4px;box-shadow:0 0 10px #FF6B00;"></div>`,
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
        this.map.setView([latitude, longitude], 16);
        if (callbackSucesso) callbackSucesso({ lat: latitude, lng: longitude });
      },
      (err) => console.warn('Permissão de GPS negada ou indisponível:', err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  async buscarEnderecoNominatim(textoBusca) {
    if (!textoBusca || textoBusca.length < 3) return null;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(textoBusca)}&limit=1&countrycodes=br`;
    const res = await fetch(url);
    const dados = await res.json();
    if (dados && dados.length > 0) {
      return {
        nome: dados[0].display_name.split(',')[0],
        lat: parseFloat(dados[0].lat),
        lng: parseFloat(dados[0].lon)
      };
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
        const duracaoMin = Math.max(2, rota.duration / 60);

        if (this.rotaLayer) {
          this.map.removeLayer(this.rotaLayer);
        }

        this.rotaLayer = L.geoJSON(rota.geometry, {
          style: { color: corLinha, weight: 5, opacity: 0.9 }
        }).addTo(this.map);

        this.map.fitBounds(this.rotaLayer.getBounds(), { padding: [40, 40] });

        return { distanciaKm, duracaoMin };
      }
    } catch (erro) {
      console.warn('Falha no servidor de rotas, a usar cálculo linear de contingência.', erro);
    }

    // Cálculo linear de segurança caso o utilizador esteja com internet fraca
    const distLinear = this.calcularDistanciaHaversine(origem, destino);
    return { distanciaKm: distLinear, duracaoMin: distLinear * 2.2 };
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
    return Math.max(1, R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
}