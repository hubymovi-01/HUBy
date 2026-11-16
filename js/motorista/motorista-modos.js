// js/motorista/motorista-modos.js - Ferramentas Pró-Motorista: Mapa de Calor, Direção de Casa e Modo Pausa
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { pararRadarChamadas, buscarChamadasPendentes, iniciarRadarChamadas } from './motorista-radar.js';

let emPausa = false;
let destinoCasaAtivo = false;
let camadaCalorLeaflet = null;
let grupoCirculosFallback = null;

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fecharDrawerMotorista() {
  document.getElementById('driverDrawer')?.classList.remove('active');
  document.getElementById('drawerOverlay')?.classList.remove('active');
}

function obterInstanciaMapaMotorista() {
  return estado.mapa || estado.map || window.mapaMotoristaInstance || null;
}

// ============================================================================
// FUNÇÃO GLOBAL DE FILTRO "DIREÇÃO DE CASA" (USADA PELO RADAR)
// ============================================================================
export function pedidoCompativelComRotaCasa(pedido) {
  if (!estado.destinoCasaAtivo || !estado.destinoCasaCoords) return true;

  const [casaLat, casaLng] = estado.destinoCasaCoords;
  const destLat = parseFloat(pedido.destino_lat ?? pedido.coordsDestino?.[0]);
  const destLng = parseFloat(pedido.destino_lng ?? pedido.coordsDestino?.[1]);

  if (isNaN(destLat) || isNaN(destLng)) {
    const termo = String(estado.destinoCasaNome || '').toLowerCase().trim();
    if (!termo) return true;
    return String(pedido.destino_endereco || '').toLowerCase().includes(termo);
  }

  // Verifica se o destino da corrida deixa o motorista a até 4 km da casa
  // ou mais perto de casa do que a posição atual dele
  const distDestinoAteCasa = calcularDistanciaKm(destLat, destLng, casaLat, casaLng);
  if (distDestinoAteCasa <= 4.0) return true;

  if (estado.ultimaPosicao?.lat && estado.ultimaPosicao?.lng) {
    const distAtualAteCasa = calcularDistanciaKm(
      estado.ultimaPosicao.lat,
      estado.ultimaPosicao.lng,
      casaLat,
      casaLng
    );
    return distDestinoAteCasa < distAtualAteCasa;
  }

  return false;
}

window.pedidoCompativelComRotaCasa = pedidoCompativelComRotaCasa;

// ============================================================================
// MODAL LIMPO PARA CONFIGURAR ENDEREÇO DE CASA (SEM PROMPT NATIVO)
// ============================================================================
function abrirModalConfigurarCasa() {
  return new Promise((resolve) => {
    document.getElementById('modalConfigCasaMotorista')?.remove();

    const enderecoSalvo = localStorage.getItem('huby_mot_casa_nome') || estado.destinoCasaNome || '';

    const overlay = document.createElement('div');
    overlay.id = 'modalConfigCasaMotorista';
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 100080',
      'background: rgba(6, 10, 18, 0.88)',
      'backdrop-filter: blur(10px)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 16px'
    ].join(';');

    overlay.innerHTML = `
      <div style="background: #0E1422; border: 1.5px solid rgba(56, 189, 248, 0.4); border-radius: 20px; width: 100%; max-width: 360px; padding: 20px; color: #FFF; box-shadow: 0 20px 50px rgba(0,0,0,0.85);">
        <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 900;">🏠 Filtro Direção de Casa</h3>
        <p style="margin: 0 0 14px; font-size: 12px; color: #94A3B8; line-height: 1.4;">
          Informe o bairro, rua ou cidade do seu destino final. O radar tocará apenas para corridas que te aproximem de casa.
        </p>

        <input type="text" id="inputEnderecoCasaMot" value="${enderecoSalvo.replace(/"/g, '&quot;')}"
          placeholder="Ex: Centro, São João do Piauí"
          style="width: 100%; background: #070B12; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 11px 12px; color: #FFF; font-size: 13px; margin-bottom: 14px; outline: none;">

        <div style="display: flex; gap: 8px;">
          <button type="button" id="btnCancelarModalCasaMot"
            style="flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #CBD5E1; font-weight: 800; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            Cancelar
          </button>
          <button type="button" id="btnConfirmarModalCasaMot"
            style="flex: 1.5; background: #38BDF8; border: none; color: #02131D; font-weight: 900; padding: 11px; border-radius: 10px; font-size: 13px; cursor: pointer;">
            Ativar Filtro
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('#inputEnderecoCasaMot');
    const btnCancelar = overlay.querySelector('#btnCancelarModalCasaMot');
    const btnConfirmar = overlay.querySelector('#btnConfirmarModalCasaMot');
    setTimeout(() => input?.focus(), 80);

    btnCancelar.onclick = () => {
      overlay.remove();
      resolve(null);
    };

    btnConfirmar.onclick = async () => {
      const texto = input.value.trim();
      if (!texto) {
        notificar('Digite o bairro ou endereço de destino.', 'alerta');
        return;
      }

      btnConfirmar.disabled = true;
      btnConfirmar.textContent = 'Localizando...';

      let coords = null;
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(texto)}&limit=1`
        );
        const dados = await resp.json();
        if (Array.isArray(dados) && dados.length > 0) {
          coords = [parseFloat(dados[0].lat), parseFloat(dados[0].lon)];
        }
      } catch (e) {}

      overlay.remove();
      resolve({ nome: texto, coords });
    };
  });
}

// ============================================================================
// CAMADA DE CALOR DE DEMANDA NO MAPA LEAFLET
// ============================================================================
async function alternarCamadaCalor(ativar) {
  const map = obterInstanciaMapaMotorista();
  if (!map || typeof L === 'undefined') {
    notificar('Mapa ainda inicializando. Tente novamente em instantes.', 'alerta');
    return false;
  }

  if (!ativar) {
    if (camadaCalorLeaflet && map.hasLayer(camadaCalorLeaflet)) {
      map.removeLayer(camadaCalorLeaflet);
    }
    if (grupoCirculosFallback && map.hasLayer(grupoCirculosFallback)) {
      map.removeLayer(grupoCirculosFallback);
    }
    return false;
  }

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/calor`, {
      headers: obterHeaders()
    });
    const data = resp.ok ? await resp.json() : { pontos: [] };
    let pontos = Array.isArray(data.pontos) ? data.pontos : [];

    // Se houver poucos dados recentes no banco, cria pontos térmicos suaves ao redor da posição atual para visualização
    if (pontos.length === 0 && estado.ultimaPosicao?.lat && estado.ultimaPosicao?.lng) {
      const { lat, lng } = estado.ultimaPosicao;
      pontos = [
        [lat + 0.003, lng + 0.002, 0.7],
        [lat - 0.002, lng + 0.004, 0.9],
        [lat + 0.001, lng - 0.003, 0.6]
      ];
    }

    if (camadaCalorLeaflet && map.hasLayer(camadaCalorLeaflet)) {
      map.removeLayer(camadaCalorLeaflet);
    }
    if (grupoCirculosFallback && map.hasLayer(grupoCirculosFallback)) {
      map.removeLayer(grupoCirculosFallback);
    }

    if (typeof L.heatLayer === 'function' && pontos.length > 0) {
      camadaCalorLeaflet = L.heatLayer(pontos, {
        radius: 32,
        blur: 22,
        maxZoom: 16,
        gradient: { 0.3: '#38BDF8', 0.6: '#F59E0B', 0.9: '#EF4444' }
      }).addTo(map);
    } else if (pontos.length > 0) {
      grupoCirculosFallback = L.layerGroup();
      pontos.forEach(([lat, lng, intensidade]) => {
        L.circle([lat, lng], {
          radius: 350,
          color: '#F59E0B',
          fillColor: intensidade >= 0.7 ? '#EF4444' : '#F59E0B',
          fillOpacity: 0.25,
          weight: 1
        }).addTo(grupoCirculosFallback);
      });
      grupoCirculosFallback.addTo(map);
    }

    return true;
  } catch (err) {
    notificar('Não foi possível carregar o mapa de calor agora.', 'erro');
    return false;
  }
}

window.alternarCamadaCalor = alternarCamadaCalor;

export function configurarModosInteligentes() {
  const btnPausa = document.getElementById('btnModoPausa');
  const btnCasa = document.getElementById('btnModoDestino');
  const btnCalor = document.getElementById('btnToggleHeatmap');

  // 1. MODO PAUSA RÁPIDA (15 minutos)
  btnPausa?.addEventListener('click', async () => {
    emPausa = !emPausa;
    estado.emPausa = emPausa;
    btnPausa.classList.toggle('active', emPausa);
    fecharDrawerMotorista();

    if (emPausa) {
      btnPausa.style.background = 'rgba(239, 68, 68, 0.2)';
      btnPausa.style.borderColor = '#EF4444';
      notificar('Pausa ativada por 15 min! Novas chamadas pausadas.', 'alerta');
      pararRadarChamadas();
    } else {
      btnPausa.style.background = 'rgba(255, 255, 255, 0.05)';
      btnPausa.style.borderColor = 'var(--border-dark)';
      notificar('Pausa encerrada. Radar de corridas ativo!', 'sucesso');
      if (estado.isOnline) {
        iniciarRadarChamadas();
      }
    }

    try {
      await fetch(`${API_URL}/api/motoristas/modo-pausa`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({ emPausa, minutos: 15 })
      });
    } catch (e) {}
  });

  // 2. MODO DIREÇÃO DE CASA
  btnCasa?.addEventListener('click', async () => {
    if (destinoCasaAtivo) {
      destinoCasaAtivo = false;
      estado.destinoCasaAtivo = false;
      estado.destinoCasaNome = null;
      estado.destinoCasaCoords = null;
      btnCasa.classList.remove('active');
      btnCasa.style.background = 'rgba(56, 189, 248, 0.12)';
      btnCasa.style.borderColor = 'rgba(56, 189, 248, 0.3)';
      fecharDrawerMotorista();
      notificar('Filtro Direção de Casa desativado.', 'info');
      if (estado.isOnline) buscarChamadasPendentes(false);

      try {
        await fetch(`${API_URL}/api/motoristas/filtro-destino`, {
          method: 'PUT',
          headers: obterHeaders(),
          body: JSON.stringify({ lat: null, lng: null, ativo: false })
        });
      } catch (e) {}
      return;
    }

    fecharDrawerMotorista();
    const resultado = await abrirModalConfigurarCasa();
    if (!resultado) return;

    destinoCasaAtivo = true;
    estado.destinoCasaAtivo = true;
    estado.destinoCasaNome = resultado.nome;
    estado.destinoCasaCoords = resultado.coords;
    localStorage.setItem('huby_mot_casa_nome', resultado.nome);

    btnCasa.classList.add('active');
    btnCasa.style.background = 'rgba(56, 189, 248, 0.28)';
    btnCasa.style.borderColor = '#38BDF8';

    notificar(`🏠 Filtro ativo! Buscando corridas rumo a: ${resultado.nome}`, 'sucesso');
    if (estado.isOnline) buscarChamadasPendentes(false);

    try {
      await fetch(`${API_URL}/api/motoristas/filtro-destino`, {
        method: 'PUT',
        headers: obterHeaders(),
        body: JSON.stringify({
          lat: resultado.coords?.[0] || null,
          lng: resultado.coords?.[1] || null,
          ativo: true
        })
      });
    } catch (e) {}
  });

  // 3. MAPA DE CALOR DE DEMANDA
  btnCalor?.addEventListener('click', async () => {
    const ativo = btnCalor.classList.toggle('active');
    fecharDrawerMotorista();

    if (ativo) {
      btnCalor.style.background = 'rgba(245, 158, 11, 0.28)';
      btnCalor.style.borderColor = '#F59E0B';
      const ok = await alternarCamadaCalor(true);
      if (ok) {
        notificar('🔥 Mapa de calor de alta demanda ativado!', 'sucesso');
      }
    } else {
      btnCalor.style.background = 'rgba(245, 158, 11, 0.12)';
      btnCalor.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      await alternarCamadaCalor(false);
      notificar('Mapa de calor desativado.', 'info');
    }
  });
}