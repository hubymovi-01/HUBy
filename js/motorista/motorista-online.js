// js/motorista/motorista-online.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';
import { iniciarRadarChamadas, pararRadarChamadas } from './motorista-radar.js';

export function configurarToggleOnline(callbackAtualizarInterface) {
  const btnToggle = document.getElementById('btnToggleStatusOnline');
  const badgeStatus = document.getElementById('badgeStatusTexto');
  const token = localStorage.getItem('huby_token');

  if (!btnToggle) return;

  btnToggle.addEventListener('click', async () => {
    // Se estiver em corrida ativa, impede ficar offline sem concluir
    if (estado.pedidoAceitoAtual && estado.isOnline) {
      alert('Não é possível ficar offline durante uma corrida em andamento.');
      return;
    }

    const novoStatus = !estado.isOnline;
    btnToggle.disabled = true;

    try {
      const resp = await fetch(`${API_URL}/api/motoristas/status-online`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ online: novoStatus })
      });

      if (!resp.ok) throw new Error('Falha ao atualizar status.');

      estado.isOnline = novoStatus;
      atualizarVisualStatus(novoStatus, btnToggle, badgeStatus);

      if (novoStatus) {
        iniciarRadarChamadas();
        iniciarTransmissaoTelemetria();
      } else {
        pararRadarChamadas();
        pararTransmissaoTelemetria();
        limparFeedChamadasOffline();
      }

      if (callbackAtualizarInterface) callbackAtualizarInterface(novoStatus);
    } catch (err) {
      alert(`Erro: ${err.message}`);
    } finally {
      btnToggle.disabled = false;
    }
  });
}

function atualizarVisualStatus(online, btn, badge) {
  if (online) {
    btn.style.background = '#10B981';
    btn.style.borderColor = '#10B981';
    btn.style.color = '#02261C';
    if (badge) {
      badge.textContent = 'ONLINE';
      badge.style.color = '#10B981';
    }
    btn.innerHTML = '<span>🟢</span> <strong>Você está Online</strong>';
  } else {
    btn.style.background = '#1F2937';
    btn.style.borderColor = 'rgba(255,255,255,0.1)';
    btn.style.color = '#94A3B8';
    if (badge) {
      badge.textContent = 'OFFLINE';
      badge.style.color = '#94A3B8';
    }
    btn.innerHTML = '<span>⚪</span> <strong>Ficar Online</strong>';
  }
}

export function iniciarTransmissaoTelemetria() {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  const enviar = async (lat, lng) => {
    if (!estado.isOnline) return;
    try {
      await fetch(`${API_URL}/api/pedidos/motoristas/localizacao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          lat,
          lng,
          emCorrida: !!estado.pedidoAceitoAtual
        })
      });
    } catch (e) {}
  };

  if (estado.intervalTelemetria) clearInterval(estado.intervalTelemetria);
  estado.intervalTelemetria = setInterval(() => {
    if (estado.hubyMapa && estado.hubyMapa.coordsOrigem && estado.isOnline) {
      enviar(estado.hubyMapa.coordsOrigem[0], estado.hubyMapa.coordsOrigem[1]);
    }
  }, 10000);
}

export function pararTransmissaoTelemetria() {
  if (estado.intervalTelemetria) {
    clearInterval(estado.intervalTelemetria);
    estado.intervalTelemetria = null;
  }
}

function limparFeedChamadasOffline() {
  const feed = document.getElementById('listaChamadasPendentes');
  if (feed && !estado.pedidoAceitoAtual) {
    feed.innerHTML = '<div class="dock-empty">Você está Offline. Toque em "Ficar Online" para receber chamadas.</div>';
  }
}