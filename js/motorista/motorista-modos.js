// js/motorista/motorista-modos.js - Ferramentas Pró-Motorista: Mapa de Calor, Direção de Casa e Modo Pausa
// Cada modo só muda na tela depois que o servidor confirma.
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';
import { notificar } from '../util/alertas-huby.js';
import { pararRadarChamadas, buscarChamadasPendentes, iniciarRadarChamadas } from './motorista-radar.js';

const MINUTOS_PAUSA = 15;

let emPausa = false;
let timerFimPausa = null;
let destinoCasaAtivo = false;
let camadaCalor = null;
let ocupado = { pausa: false, casa: false, calor: false };

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

async function chamarServidor(caminho, corpo) {
  const resp = await fetch(`${API_URL}${caminho}`, {
    method: 'PUT',
    headers: obterHeaders(),
    body: JSON.stringify(corpo)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.erro || 'O servidor não confirmou a alteração.');
  return data;
}

function mensagemErro(err) {
  return err instanceof TypeError ? 'Sem conexão. Nada foi alterado.' : (err.message || 'Não foi possível alterar agora.');
}

// ============================================================================
// FILTRO "DIREÇÃO DE CASA" (USADO PELO RADAR)
// ============================================================================
export function pedidoCompativelComRotaCasa(pedido) {
  if (!estado.destinoCasaAtivo || !estado.destinoCasaCoords) return true;

  const [casaLat, casaLng] = estado.destinoCasaCoords;
  const destLat = parseFloat(pedido.destino_lat ?? pedido.coordsDestino?.[0]);
  const destLng = parseFloat(pedido.destino_lng ?? pedido.coordsDestino?.[1]);

  // Sem coordenadas do destino não dá para saber: mostra a chamada
  if (isNaN(destLat) || isNaN(destLng)) return true;

  // Aceita se o destino deixa o motorista a até 4 km de casa
  // ou mais perto de casa do que ele está agora
  const distDestinoAteCasa = calcularDistanciaKm(destLat, destLng, casaLat, casaLng);
  if (distDestinoAteCasa <= 4.0) return true;

  if (estado.ultimaPosicao?.lat && estado.ultimaPosicao?.lng) {
    const distAtualAteCasa = calcularDistanciaKm(estado.ultimaPosicao.lat, estado.ultimaPosicao.lng, casaLat, casaLng);
    return distDestinoAteCasa < distAtualAteCasa;
  }

  return false;
}

window.pedidoCompativelComRotaCasa = pedidoCompativelComRotaCasa;

// Janela para digitar o endereço de casa (campo de texto puro)
function abrirModalConfigurarCasa() {
  return new Promise((resolve) => {
    document.getElementById('modalConfigCasaMotorista')?.remove();

    const enderecoSalvo = String(localStorage.getItem('huby_mot_casa_nome') || estado.destinoCasaNome || '').slice(0, 120);

    const overlay = document.createElement('div');
    overlay.id = 'modalConfigCasaMotorista';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100080;background:rgba(6,10,18,0.88);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:16px;';

    overlay.innerHTML = `
      <div style="background: #0E1422; border: 1.5px solid rgba(56, 189, 248, 0.4); border-radius: 20px; width: 100%; max-width: 360px; padding: 20px; color: #FFF; box-shadow: 0 20px 50px rgba(0,0,0,0.85);">
        <h3 style="margin: 0 0 6px; font-size: 16px; font-weight: 900;">🏠 Filtro Direção de Casa</h3>
        <p style="margin: 0 0 14px; font-size: 12px; color: #94A3B8; line-height: 1.4;">
          Informe o bairro, rua ou cidade do seu destino final. O radar vai mostrar só corridas que te aproximam de casa.
        </p>
        <input type="text" id="inputEnderecoCasaMot" maxlength="120" placeholder="Ex: Centro, São João do Piauí"
          style="width: 100%; box-sizing: border-box; background: #070B12; border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 11px 12px; color: #FFF; font-size: 13px; margin-bottom: 14px; outline: none;">
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
    input.value = enderecoSalvo; // valor como texto, nunca como HTML
    setTimeout(() => input?.focus(), 80);

    btnCancelar.onclick = () => {
      overlay.remove();
      resolve(null);
    };

    btnConfirmar.onclick = async () => {
      const texto = input.value.trim().slice(0, 120);
      if (!texto) {
        notificar('Digite o bairro ou endereço de destino.', 'alerta');
        return;
      }

      btnConfirmar.disabled = true;
      btnConfirmar.textContent = 'Localizando...';

      let coords = null;
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(texto)}`
        );
        const dados = await resp.json();
        if (Array.isArray(dados) && dados.length > 0) {
          const lat = parseFloat(dados[0].lat);
          const lng = parseFloat(dados[0].lon);
          if (Number.isFinite(lat) && Number.isFinite(lng)) coords = [lat, lng];
        }
      } catch (e) {}

      if (!coords) {
        notificar('Endereço não encontrado no mapa. Tente com mais detalhes (bairro e cidade).', 'alerta', 6000);
        btnConfirmar.disabled = false;
        btnConfirmar.textContent = 'Ativar Filtro';
        return;
      }

      overlay.remove();
      resolve({ nome: texto, coords });
    };
  });
}

// ============================================================================
// MAPA DE CALOR (só com dados reais de demanda)
// ============================================================================
function removerCamadaCalor() {
  if (camadaCalor && typeof camadaCalor.remove === 'function') {
    try { camadaCalor.remove(); } catch (e) {}
  }
  camadaCalor = null;
}

async function alternarCamadaCalor(ativar) {
  if (!ativar) {
    removerCamadaCalor();
    return false;
  }

  if (!estado.mapa || typeof window.L?.heatLayer !== 'function') {
    notificar('Mapa ainda carregando. Tente de novo em instantes.', 'alerta');
    return false;
  }

  try {
    const resp = await fetch(`${API_URL}/api/motoristas/calor?t=${Date.now()}`, {
      cache: 'no-store',
      headers: obterHeaders()
    });
    if (!resp.ok) throw new Error('falha');
    const data = await resp.json();

    // Só aceita pontos válidos [lat, lng, intensidade]
    const pontos = (Array.isArray(data.pontos) ? data.pontos : [])
      .map((p) => [Number(p?.[0]), Number(p?.[1]), Math.min(1, Math.max(0.1, Number(p?.[2]) || 0.6))])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      .slice(0, 2000);

    if (pontos.length === 0) {
      notificar('Ainda não há pedidos recentes suficientes para mostrar a demanda.', 'info', 5000);
      return false;
    }

    removerCamadaCalor();
    camadaCalor = window.L.heatLayer(pontos).addTo(estado.mapa);
    return true;
  } catch (err) {
    notificar('Não foi possível carregar o mapa de calor agora.', 'erro');
    return false;
  }
}

window.alternarCamadaCalor = alternarCamadaCalor;

// ============================================================================
// VISUAL DOS BOTÕES
// ============================================================================
function visualPausa(btn, ativo) {
  btn.classList.toggle('active', ativo);
  btn.style.background = ativo ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.05)';
  btn.style.borderColor = ativo ? '#EF4444' : 'var(--border-dark)';
}

function visualCasa(btn, ativo) {
  btn.classList.toggle('active', ativo);
  btn.style.background = ativo ? 'rgba(56, 189, 248, 0.28)' : 'rgba(56, 189, 248, 0.12)';
  btn.style.borderColor = ativo ? '#38BDF8' : 'rgba(56, 189, 248, 0.3)';
}

function visualCalor(btn, ativo) {
  btn.classList.toggle('active', ativo);
  btn.style.background = ativo ? 'rgba(245, 158, 11, 0.28)' : 'rgba(245, 158, 11, 0.12)';
  btn.style.borderColor = ativo ? '#F59E0B' : 'rgba(245, 158, 11, 0.3)';
}

export function configurarModosInteligentes() {
  const btnPausa = document.getElementById('btnModoPausa');
  const btnCasa = document.getElementById('btnModoDestino');
  const btnCalor = document.getElementById('btnToggleHeatmap');

  // 1. MODO PAUSA (15 minutos, termina sozinho)
  async function definirPausa(ativar, avisarFimAutomatico = false) {
    if (ocupado.pausa || !btnPausa) return;
    if (ativar && (estado.pedidoAceitoAtual || estado.pedidoAtivo)) {
      notificar('Finalize a corrida atual antes de pausar.', 'alerta');
      return;
    }

    ocupado.pausa = true;
    try {
      await chamarServidor('/api/motoristas/modo-pausa', { emPausa: ativar, minutos: MINUTOS_PAUSA });
      emPausa = ativar;
      estado.emPausa = ativar;
      visualPausa(btnPausa, ativar);

      if (timerFimPausa) clearTimeout(timerFimPausa);
      timerFimPausa = null;

      if (ativar) {
        pararRadarChamadas();
        notificar(`☕ Pausa de ${MINUTOS_PAUSA} min ativada. Você não recebe chamadas agora.`, 'alerta');
        timerFimPausa = setTimeout(() => definirPausa(false, true), MINUTOS_PAUSA * 60 * 1000);
      } else {
        notificar(avisarFimAutomatico ? '⏰ Sua pausa terminou. Radar de corridas ativo!' : 'Pausa encerrada. Radar de corridas ativo!', 'sucesso');
        if (estado.isOnline) iniciarRadarChamadas();
      }
    } catch (err) {
      notificar(mensagemErro(err), 'erro');
    } finally {
      ocupado.pausa = false;
    }
  }

  btnPausa?.addEventListener('click', () => {
    fecharDrawerMotorista();
    definirPausa(!emPausa);
  });

  // 2. MODO DIREÇÃO DE CASA
  btnCasa?.addEventListener('click', async () => {
    if (ocupado.casa) return;
    fecharDrawerMotorista();

    if (destinoCasaAtivo) {
      ocupado.casa = true;
      try {
        await chamarServidor('/api/motoristas/filtro-destino', { lat: null, lng: null, ativo: false });
        destinoCasaAtivo = false;
        estado.destinoCasaAtivo = false;
        estado.destinoCasaNome = null;
        estado.destinoCasaCoords = null;
        visualCasa(btnCasa, false);
        notificar('Filtro Direção de Casa desativado.', 'info');
        if (estado.isOnline) buscarChamadasPendentes(false);
      } catch (err) {
        notificar(mensagemErro(err), 'erro');
      } finally {
        ocupado.casa = false;
      }
      return;
    }

    const resultado = await abrirModalConfigurarCasa();
    if (!resultado) return;

    ocupado.casa = true;
    try {
      await chamarServidor('/api/motoristas/filtro-destino', {
        lat: resultado.coords[0],
        lng: resultado.coords[1],
        ativo: true
      });
      destinoCasaAtivo = true;
      estado.destinoCasaAtivo = true;
      estado.destinoCasaNome = resultado.nome;
      estado.destinoCasaCoords = resultado.coords;
      localStorage.setItem('huby_mot_casa_nome', resultado.nome);
      visualCasa(btnCasa, true);
      notificar(`🏠 Filtro ativo! Buscando corridas rumo a: ${resultado.nome}`, 'sucesso');
      if (estado.isOnline) buscarChamadasPendentes(false);
    } catch (err) {
      notificar(mensagemErro(err), 'erro');
    } finally {
      ocupado.casa = false;
    }
  });

  // 3. MAPA DE CALOR
  btnCalor?.addEventListener('click', async () => {
    if (ocupado.calor) return;
    fecharDrawerMotorista();
    ocupado.calor = true;

    try {
      if (camadaCalor) {
        await alternarCamadaCalor(false);
        visualCalor(btnCalor, false);
        notificar('Mapa de calor desativado.', 'info');
      } else {
        const ok = await alternarCamadaCalor(true);
        visualCalor(btnCalor, ok);
        if (ok) notificar('🔥 Mapa de calor ativado: áreas com mais pedidos recentes.', 'sucesso');
      }
    } finally {
      ocupado.calor = false;
    }
  });
}