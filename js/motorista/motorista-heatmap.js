// js/motorista/motorista-heatmap.js
import { API_URL } from '../config.js';

let camadaCalor = null;
let calorAtivo = false;
let emPausa = false;
let destinoAtivo = false;

// 1. Exportação nomeada principal exigida pelo app-motorista.js
export function configurarRecursosInteligentes(mapaInstancia, token) {
  configurarHeatmap(mapaInstancia, token);
  configurarModoPausa(token);
  configurarModoDestino(token);
}

// 2. Exportação de compatibilidade retroativa
export function inicializarHeatmapDemanda(mapaInstancia, token) {
  configurarRecursosInteligentes(mapaInstancia, token);
}

// ============================================================================
// 1. MAPA DE CALOR LEAFLET.HEAT
// ============================================================================
function configurarHeatmap(mapaInstancia, token) {
  const btnCalor = document.getElementById('btnToggleHeatmap');
  if (!btnCalor) return;

  btnCalor.addEventListener('click', async () => {
    if (calorAtivo) {
      if (camadaCalor && mapaInstancia) {
        mapaInstancia.removeLayer(camadaCalor);
        camadaCalor = null;
      }
      calorAtivo = false;
      btnCalor.classList.remove('active');
      btnCalor.style.color = 'var(--text-sec)';
      btnCalor.style.borderColor = 'var(--border-dark)';
      return;
    }

    try {
      btnCalor.textContent = '⏳ Carregando...';
      const authToken = token || localStorage.getItem('huby_token');
      const res = await fetch(`${API_URL}/api/motoristas/calor`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });

      if (!res.ok) throw new Error('Falha ao obter dados térmicos');
      const data = await res.json();
      const pontos = data.pontos || [];

      if (!pontos.length) {
        alert('Sem corridas recentes suficientes para desenhar a mancha de calor.');
        btnCalor.textContent = '🔥 Calor';
        return;
      }

      if (typeof L !== 'undefined' && L.heatLayer && mapaInstancia) {
        camadaCalor = L.heatLayer(pontos, {
          radius: 25,
          blur: 18,
          maxZoom: 17,
          gradient: { 0.2: '#38BDF8', 0.5: '#10B981', 0.8: '#F59E0B', 1.0: '#EF4444' }
        }).addTo(mapaInstancia);

        calorAtivo = true;
        btnCalor.classList.add('active');
        btnCalor.style.color = '#F59E0B';
        btnCalor.style.borderColor = '#F59E0B';
      }
    } catch (e) {
      console.warn('Erro ao carregar mapa térmico:', e);
      alert('Não foi possível gerar a mancha de calor no momento.');
    } finally {
      btnCalor.textContent = '🔥 Calor';
    }
  });
}

// ============================================================================
// 2. MODO PAUSA RÁPIDA (LANCHE / ABASTECIMENTO)
// ============================================================================
function configurarModoPausa(token) {
  const btnPausa = document.getElementById('btnModoPausa');
  const modalPausa = document.getElementById('modalConfigPausa');
  const btnConfirmar = document.getElementById('btnConfirmarIniciarPausa');

  btnPausa?.addEventListener('click', async () => {
    const authToken = token || localStorage.getItem('huby_token');
    if (emPausa) {
      if (confirm('Deseja encerrar o intervalo e voltar a receber chamadas?')) {
        await alternarPausaServidor(authToken, false, 0);
      }
    } else {
      if (modalPausa) modalPausa.style.display = 'flex';
    }
  });

  btnConfirmar?.addEventListener('click', async () => {
    const authToken = token || localStorage.getItem('huby_token');
    const minutos = Number(document.getElementById('selectTempoPausa')?.value || 15);
    await alternarPausaServidor(authToken, true, minutos);
    if (modalPausa) modalPausa.style.display = 'none';
  });
}

async function alternarPausaServidor(token, ativar, minutos) {
  const btnPausa = document.getElementById('btnModoPausa');
  try {
    const res = await fetch(`${API_URL}/api/motoristas/modo-pausa`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ emPausa: ativar, minutos })
    });

    if (res.ok) {
      emPausa = ativar;
      if (btnPausa) {
        if (emPausa) {
          btnPausa.classList.add('active');
          btnPausa.style.color = 'var(--amber)';
          btnPausa.style.borderColor = 'var(--amber)';
          btnPausa.textContent = '☕ Pausado';
        } else {
          btnPausa.classList.remove('active');
          btnPausa.style.color = 'var(--text-sec)';
          btnPausa.style.borderColor = 'var(--border-dark)';
          btnPausa.textContent = '☕ Pausa';
        }
      }
    }
  } catch (err) {
    alert('Erro ao sincronizar status de pausa.');
  }
}

// ============================================================================
// 3. MODO DIREÇÃO DE CASA
// ============================================================================
function configurarModoDestino(token) {
  const btnCasa = document.getElementById('btnModoDestino');
  btnCasa?.addEventListener('click', async () => {
    const authToken = token || localStorage.getItem('huby_token');

    if (destinoAtivo) {
      if (confirm('Deseja desativar o filtro "Direção de Casa"?')) {
        await atualizarDestinoServidor(authToken, null, null, false);
      }
      return;
    }

    const endereco = prompt('Digite o endereço ou bairro de retorno para casa:');
    if (!endereco || !endereco.trim()) return;

    await atualizarDestinoServidor(authToken, -8.358, -42.246, true);
  });
}

async function atualizarDestinoServidor(token, lat, lng, ativo) {
  const btnCasa = document.getElementById('btnModoDestino');
  try {
    const res = await fetch(`${API_URL}/api/motoristas/filtro-destino`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ lat, lng, ativo })
    });

    if (res.ok) {
      destinoAtivo = ativo;
      if (btnCasa) {
        if (destinoAtivo) {
          btnCasa.classList.add('active');
          btnCasa.style.color = 'var(--blue)';
          btnCasa.style.borderColor = 'var(--blue)';
          btnCasa.textContent = '🏠 Casa (Ativo)';
        } else {
          btnCasa.classList.remove('active');
          btnCasa.style.color = 'var(--text-sec)';
          btnCasa.style.borderColor = 'var(--border-dark)';
          btnCasa.textContent = '🏠 Casa';
        }
      }
    }
  } catch (e) {
    alert('Erro ao salvar filtro de rota para casa.');
  }
}

export default {
  configurarRecursosInteligentes,
  inicializarHeatmapDemanda
};