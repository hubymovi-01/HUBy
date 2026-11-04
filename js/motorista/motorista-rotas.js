// js/motorista/motorista-rotas.js - Monitoramento GPS e Recálculo Automático de Desvios
import { estado } from './motorista-estado.js';

let watchGpsId = null;
let ultimaPosicaoConhecida = null;
let recalculoEmAndamento = false;

// Cálculo da distância esférica entre dois pontos (em metros)
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Menor distância entre a posição atual do carro e os pontos da linha da rota traçada
function calcularDistanciaDaRota(posAtual, coordenadasRota) {
  if (!coordenadasRota || coordenadasRota.length === 0) return 0;
  let menorDistancia = Infinity;

  for (let i = 0; i < coordenadasRota.length; i++) {
    const pt = coordenadasRota[i];
    const latPt = Array.isArray(pt) ? pt[0] : pt.lat;
    const lngPt = Array.isArray(pt) ? pt[1] : pt.lng;

    const d = calcularDistanciaMetros(posAtual.lat, posAtual.lng, latPt, lngPt);
    if (d < menorDistancia) {
      menorDistancia = d;
    }
  }

  return menorDistancia;
}

export function iniciarMonitoramentoDesvios(destinoCoords) {
  pararMonitoramentoDesvios();

  if (!navigator.geolocation) {
    console.warn('Geolocalização não suportada para recálculo de rotas.');
    return;
  }

  watchGpsId = navigator.geolocation.watchPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      ultimaPosicaoConhecida = { lat, lng };

      // Só recalcula se houver corrida ativa e uma rota desenhada no mapa
      if (!estado.pedidoAceitoAtual || !estado.rotaAtivaPolyline || recalculoEmAndamento) {
        return;
      }

      // Obtém as coordenadas da geometria da rota atual desenhada no Leaflet
      const latLngs = typeof estado.rotaAtivaPolyline.getLatLngs === 'function'
        ? estado.rotaAtivaPolyline.getLatLngs()
        : null;

      if (!latLngs || latLngs.length === 0) return;

      const pontosPlanares = Array.isArray(latLngs[0]) ? latLngs[0] : latLngs;
      const desvioMetros = calcularDistanciaDaRota({ lat, lng }, pontosPlanares);

      // Limiar de tolerância: Se o motorista se afastou mais de 40 metros do traçado
      if (desvioMetros > 40) {
        console.log(`⚠️ Desvio detectado (${desvioMetros.toFixed(0)}m da rota). Recalculando trajeto...`);
        recalculoEmAndamento = true;

        try {
          if (estado.hubyMapa && typeof estado.hubyMapa.calcularRota === 'function') {
            const novaRota = await estado.hubyMapa.calcularRota([lat, lng], destinoCoords, '#10B981', false);
            if (novaRota) {
              console.log('✅ Rota recalculada com sucesso a partir da posição atual!');
            }
          }
        } catch (err) {
          console.warn('Falha no recálculo automático:', err.message);
        } finally {
          // Cooldown de 5 segundos para evitar requisições repetitivas no OSRM
          setTimeout(() => {
            recalculoEmAndamento = false;
          }, 5000);
        }
      }
    },
    (err) => console.warn('Aviso de GPS:', err.message),
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 8000
    }
  );
}

export function pararMonitoramentoDesvios() {
  if (watchGpsId !== null) {
    navigator.geolocation.clearWatch(watchGpsId);
    watchGpsId = null;
  }
  recalculoEmAndamento = false;
  ultimaPosicaoConhecida = null;
}