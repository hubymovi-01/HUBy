// js/motorista/motorista-zonas-risco.js - Zonas de Risco no Mapa do Motorista (MapLibre)
// Desenha cada zona como um círculo com o raio real em metros. Textos sempre como texto puro.
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';

const ID_FONTE = 'huby-zonas-risco';
const ID_PREENCHIMENTO = 'huby-zonas-risco-fill';
const ID_CONTORNO = 'huby-zonas-risco-line';

let zonasCarregadas = [];
let cliqueConfigurado = false;
let popupAberto = null;
const zonasAlertadasCooldown = new Map();

const CORES = {
  baixo: '#38BDF8',
  medio: '#F59E0B',
  alto: '#EF4444'
};

function obterMapaGL() {
  return estado.mapa?._gl || null;
}

function nivelDaZona(z) {
  const n = String(z?.nivel_risco || 'alto').toLowerCase();
  return ['baixo', 'medio', 'alto'].includes(n) ? n : 'alto';
}

function raioDaZona(z) {
  const r = Number(z?.raio_metros || 500);
  return Math.min(5000, Math.max(100, Number.isFinite(r) ? r : 500));
}

function dentroDaJanelaHorario(zona) {
  const ini = String(zona.horario_inicio || '').slice(0, 5);
  const fim = String(zona.horario_fim || '').slice(0, 5);
  if (!ini || !fim) return true;

  const [hIni, mIni] = ini.split(':').map(Number);
  const [hFim, mFim] = fim.split(':').map(Number);
  if ([hIni, mIni, hFim, mFim].some(Number.isNaN)) return true;

  const agora = new Date();
  const minAtual = agora.getHours() * 60 + agora.getMinutes();
  const minIni = hIni * 60 + mIni;
  const minFim = hFim * 60 + mFim;

  if (minIni === minFim) return true;
  if (minIni < minFim) return minAtual >= minIni && minAtual <= minFim;
  return minAtual >= minIni || minAtual <= minFim;
}

function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Círculo de verdade (em metros) como polígono para o mapa
function poligonoCirculo(lat, lng, raioM, pontos = 48) {
  const coords = [];
  const metrosPorGrauLat = 110540;
  const metrosPorGrauLng = 111320 * Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= pontos; i++) {
    const ang = (i / pontos) * 2 * Math.PI;
    coords.push([
      lng + (raioM * Math.cos(ang)) / metrosPorGrauLng,
      lat + (raioM * Math.sin(ang)) / metrosPorGrauLat
    ]);
  }
  return [coords];
}

function montarGeoJSON(zonas) {
  const features = [];
  zonas.forEach((z, indice) => {
    const lat = Number(z.lat);
    const lng = Number(z.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const nivel = nivelDaZona(z);
    features.push({
      type: 'Feature',
      properties: {
        indice,
        cor: CORES[nivel],
        ativa: dentroDaJanelaHorario(z) ? 1 : 0
      },
      geometry: { type: 'Polygon', coordinates: poligonoCirculo(lat, lng, raioDaZona(z)) }
    });
  });
  return { type: 'FeatureCollection', features };
}

// Conteúdo do balão da zona, montado só com texto puro
function montarPopup(z) {
  const caixa = document.createElement('div');
  caixa.style.cssText = 'color:#0F172A; font-size:12px; line-height:1.45; max-width:220px;';

  const titulo = document.createElement('strong');
  titulo.style.cssText = 'display:block; font-size:13px;';
  titulo.textContent = `🛡️ ${String(z.nome || 'Zona de risco').slice(0, 80)}`;
  caixa.appendChild(titulo);

  const horario = z.horario_inicio && z.horario_fim
    ? `${String(z.horario_inicio).slice(0, 5)} às ${String(z.horario_fim).slice(0, 5)}`
    : '24h';
  const linha = document.createElement('span');
  linha.textContent = `Nível: ${nivelDaZona(z).toUpperCase()} • Raio: ${raioDaZona(z)} m • Horário: ${horario}`;
  caixa.appendChild(linha);

  if (z.descricao) {
    const desc = document.createElement('small');
    desc.style.cssText = 'display:block; margin-top:4px; color:#334155;';
    desc.textContent = String(z.descricao).slice(0, 300);
    caixa.appendChild(desc);
  }
  return caixa;
}

function renderizarZonasNoMapa(zonas) {
  const gl = obterMapaGL();
  if (!gl || typeof maplibregl === 'undefined') return;

  const desenhar = () => {
    const dados = montarGeoJSON(zonas);
    const fonte = gl.getSource(ID_FONTE);
    if (fonte) {
      fonte.setData(dados);
    } else {
      gl.addSource(ID_FONTE, { type: 'geojson', data: dados });
      gl.addLayer({
        id: ID_PREENCHIMENTO,
        type: 'fill',
        source: ID_FONTE,
        paint: {
          'fill-color': ['get', 'cor'],
          'fill-opacity': ['case', ['==', ['get', 'ativa'], 1], 0.18, 0.05]
        }
      });
      gl.addLayer({
        id: ID_CONTORNO,
        type: 'line',
        source: ID_FONTE,
        paint: {
          'line-color': ['get', 'cor'],
          'line-width': 2,
          'line-opacity': ['case', ['==', ['get', 'ativa'], 1], 0.85, 0.35],
          'line-dasharray': [2, 1.5]
        }
      });
    }

    if (!cliqueConfigurado) {
      cliqueConfigurado = true;
      gl.on('click', ID_PREENCHIMENTO, (e) => {
        const indice = Number(e.features?.[0]?.properties?.indice);
        const z = zonasCarregadas[indice];
        if (!z) return;
        popupAberto?.remove();
        popupAberto = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' })
          .setLngLat(e.lngLat)
          .setDOMContent(montarPopup(z))
          .addTo(gl);
      });
    }
  };

  try {
    if (gl.isStyleLoaded()) desenhar();
    else gl.once('load', desenhar);
  } catch (e) {
    console.warn('Não foi possível desenhar as zonas de risco:', e);
  }
}

export function verificarProximidadeZonasRisco(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !zonasCarregadas.length) return;

  const agora = Date.now();
  zonasCarregadas.forEach((z) => {
    if (!dentroDaJanelaHorario(z)) return;
    const zLat = Number(z.lat);
    const zLng = Number(z.lng);
    if (!Number.isFinite(zLat) || !Number.isFinite(zLng)) return;

    if (distanciaMetros(lat, lng, zLat, zLng) <= raioDaZona(z)) {
      const chave = String(z.id ?? `${zLat}_${zLng}`);
      const ultimoAlerta = zonasAlertadasCooldown.get(chave) || 0;
      if (agora - ultimoAlerta > 5 * 60 * 1000) {
        zonasAlertadasCooldown.set(chave, agora);
        notificar(`🛡️ Atenção: você entrou na zona de risco "${String(z.nome || 'monitorada').slice(0, 60)}".`, 'alerta', 6000);
      }
    }
  });
}

export async function carregarZonasRiscoNoMapa() {
  if (!localStorage.getItem('huby_token')) return;

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/zonas-risco?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });
    if (!resp.ok) return;

    const dados = await resp.json();
    zonasCarregadas = Array.isArray(dados?.zonas) ? dados.zonas.slice(0, 200) : [];
    renderizarZonasNoMapa(zonasCarregadas);
  } catch (err) {
    console.warn('Falha ao carregar zonas de risco no mapa do motorista:', err);
  }
}

export function inicializarZonasRiscoMapa() {
  let tentativas = 0;
  const timer = setInterval(() => {
    tentativas += 1;
    if (obterMapaGL() || tentativas >= 25) {
      clearInterval(timer);
      if (obterMapaGL()) carregarZonasRiscoNoMapa();
    }
  }, 400);

  // Atualiza a cada minuto (zonas novas e horário de cada zona)
  setInterval(carregarZonasRiscoNoMapa, 60000);

  // Alerta ao entrar numa zona, usando a posição do GPS a cada 15 s
  setInterval(() => {
    const pos = estado.ultimaPosicao;
    if (pos) verificarProximidadeZonasRisco(Number(pos.lat), Number(pos.lng));
  }, 15000);
}