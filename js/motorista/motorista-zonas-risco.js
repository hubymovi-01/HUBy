// js/motorista/motorista-zonas-risco.js - Renderização e Alerta de Zonas de Risco no Mapa do Motorista
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';

let camadaZonasRisco = null;
let zonasCarregadas = [];
const zonasAlertadasCooldown = new Map();

function obterMapaLeaflet() {
  return estado.mapa || estado.map || window.mapaMotoristaInstance || null;
}

function estiloPorNivel(nivel) {
  const n = String(nivel || 'alto').toLowerCase();
  if (n === 'baixo') {
    return { color: '#38BDF8', fillColor: '#38BDF8', fillOpacity: 0.14, weight: 2 };
  }
  if (n === 'medio') {
    return { color: '#F59E0B', fillColor: '#F59E0B', fillOpacity: 0.18, weight: 2 };
  }
  return { color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.22, weight: 2.5 };
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
  if (minIni < minFim) {
    return minAtual >= minIni && minAtual <= minFim;
  }
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

function renderizarZonasNoMapa(zonas) {
  const map = obterMapaLeaflet();
  if (!map || typeof L === 'undefined') return;

  if (camadaZonasRisco && map.hasLayer(camadaZonasRisco)) {
    map.removeLayer(camadaZonasRisco);
  }

  camadaZonasRisco = L.layerGroup();

  zonas.forEach((z) => {
    const lat = Number(z.lat);
    const lng = Number(z.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const raio = Math.max(100, Number(z.raio_metros || 500));
    const horarioAtivo = dentroDaJanelaHorario(z);
    const estilo = estiloPorNivel(z.nivel_risco);

    if (!horarioAtivo) {
      estilo.opacity = 0.45;
      estilo.fillOpacity = 0.06;
    }

    const circulo = L.circle([lat, lng], {
      radius: raio,
      ...estilo
    });

    const horarioTxt = z.horario_inicio && z.horario_fim
      ? `${String(z.horario_inicio).slice(0, 5)} às ${String(z.horario_fim).slice(0, 5)}`
      : '24h';

    circulo.bindPopup(`
      <div style="color:#0F172A; font-size:12px; line-height:1.45;">
        <strong style="display:block; font-size:13px;">🛡️ ${z.nome || 'Zona de Risco'}</strong>
        <span>Nível: <strong>${String(z.nivel_risco || 'alto').toUpperCase()}</strong></span><br>
        <span>Raio: ${raio}m • Horário: ${horarioTxt}</span>
        ${z.descricao ? `<br><small>${z.descricao}</small>` : ''}
      </div>
    `);

    circulo.addTo(camadaZonasRisco);
  });

  camadaZonasRisco.addTo(map);
}

export function verificarProximidadeZonasRisco(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !zonasCarregadas.length) return;

  const agora = Date.now();
  zonasCarregadas.forEach((z) => {
    if (!dentroDaJanelaHorario(z)) return;
    const zLat = Number(z.lat);
    const zLng = Number(z.lng);
    if (!Number.isFinite(zLat) || !Number.isFinite(zLng)) return;

    const raio = Math.max(100, Number(z.raio_metros || 500));
    const dist = distanciaMetros(lat, lng, zLat, zLng);

    if (dist <= raio) {
      const chave = String(z.id ?? `${zLat}_${zLng}`);
      const ultimoAlerta = zonasAlertadasCooldown.get(chave) || 0;
      if (agora - ultimoAlerta > 5 * 60 * 1000) {
        zonasAlertadasCooldown.set(chave, agora);
        notificar(`🛡️ Atenção: você entrou na Zona de Risco "${z.nome || 'Monitorada'}".`, 'alerta', 6000);
      }
    }
  });
}

export async function carregarZonasRiscoNoMapa() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/zonas-risco?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });
    if (!resp.ok) return;

    const dados = await resp.json();
    zonasCarregadas = Array.isArray(dados?.zonas) ? dados.zonas : [];
    renderizarZonasNoMapa(zonasCarregadas);
  } catch (err) {
    console.warn('Falha ao carregar zonas de risco no mapa do motorista:', err);
  }
}

export function inicializarZonasRiscoMapa() {
  let tentativas = 0;
  const timer = setInterval(() => {
    tentativas += 1;
    const map = obterMapaLeaflet();
    if (map || tentativas >= 15) {
      clearInterval(timer);
      if (map) {
        carregarZonasRiscoNoMapa();
      }
    }
  }, 400);

  setInterval(() => {
    carregarZonasRiscoNoMapa();
  }, 60000);
}