import { API_URL } from './config.js';
import { HubyMapa } from './mapa.js';

let hubyMapa = null;
let pedidoAceitoAtual = null;
let intervalRadar = null;
let chamadasAnterioresIds = new Set();
let statusAprovacaoAtual = 'aprovado';
let categoriaMotorista = 'carro';

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || role !== 'motorista') {
    alert('Acesso restrito a condutores parceiros.');
    window.location.replace('./login.html');
    return;
  }

  // 1. Inicializa o mapa Leaflet no motorista com recentralização forçada
  try {
    hubyMapa = new HubyMapa('mapaMotorista');
    hubyMapa.inicializar();

    setTimeout(() => {
      if (hubyMapa && hubyMapa.map) {
        hubyMapa.map.invalidateSize();
      }
    }, 250);

    hubyMapa.obterGPS((pos) => {
      console.log('GPS do motorista fixado com sucesso:', pos);
    });
  } catch (err) {
    console.warn('Erro ao inicializar mapa do motorista:', err);
  }

  // 2. Configura modal de saque Pix
  configurarModalSaquePix();

  // 3. Carregar saldo, checar aprovação e identificar categoria (carro, moto, frete)
  await atualizarPerfilESaldo();

  // 4. Se aprovado, liga o radar de chamadas filtrado por categoria
  if (statusAprovacaoAtual === 'aprovado') {
    iniciarRadarChamadas();
  }

  // 5. Limpeza de recursos ao fechar ou recarregar
  window.addEventListener('beforeunload', () => {
    if (intervalRadar) clearInterval(intervalRadar);
    if (hubyMapa?.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(hubyMapa.watchId);
    }
  });
});

// Emissor sonoro nativo via Web Audio API + Vibração
function tocarAlertaSonoro() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();

    const tocarTom = (freq, inicio, duracao) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + inicio);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + inicio);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + inicio + duracao);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + inicio);
      osc.stop(audioCtx.currentTime + inicio + duracao);
    };

    tocarTom(880, 0, 0.15);
    tocarTom(1174.66, 0.18, 0.25);

    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch (err) {
    console.warn('Erro ao emitir som do radar:', err);
  }
}

async function atualizarPerfilESaldo() {
  const token = localStorage.getItem('huby_token');
  try {
    const resp = await fetch(`${API_URL}/api/motoristas/meu-saldo`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        localStorage.clear();
        window.location.replace('./login.html');
      }
      return;
    }

    const dados = await resp.json();
    statusAprovacaoAtual = dados.status_aprovacao || 'aprovado';
    categoriaMotorista = dados.categoria || 'carro';

    const saldoEl = document.getElementById('saldoCarteiraValor') || document.getElementById('txtSaldoMotorista');
    if (saldoEl) {
      saldoEl.textContent = `R$ ${Number(dados.saldo_carteira || 0).toFixed(2).replace('.', ',')}`;
    }

    if (statusAprovacaoAtual !== 'aprovado') {
      const feedEl = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
      if (feedEl) {
        feedEl.innerHTML = `
          <div class="dock-empty" style="color: #F59E0B; padding: 18px; text-align: center;">
            <strong>Acesso em Análise (${statusAprovacaoAtual.toUpperCase()})</strong>
            <p style="font-size: 12px; margin-top: 6px; color: #8F9CAE;">
              ${dados.motivo_recusa || 'Seus documentos estão em triagem pela administração. Você será notificado assim que aprovado.'}
            </p>
          </div>
        `;
      }
    }
  } catch (err) {
    console.warn('Erro ao carregar perfil do motorista:', err);
  }
}

// Configuração do Modal e Envio do Pedido de Saque Pix
function configurarModalSaquePix() {
  const modalSaque = document.getElementById('modalSaquePix');
  const btnAbrirSaque = document.getElementById('btnAbrirModalSaque');
  const btnFecharSaque = document.getElementById('btnFecharModalSaque');
  const btnConfirmarSaque = document.getElementById('btnConfirmarSaquePix');

  btnAbrirSaque?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'flex';
  });

  btnFecharSaque?.addEventListener('click', () => {
    if (modalSaque) modalSaque.style.display = 'none';
  });

  btnConfirmarSaque?.addEventListener('click', async () => {
    const token = localStorage.getItem('huby_token');
    const chavePix = document.getElementById('saqueChavePix')?.value.trim();
    const tipoChave = document.getElementById('saqueTipoChave')?.value || 'cpf';
    const valor = Number(document.getElementById('saqueValor')?.value);

    if (!chavePix || !valor || valor <= 0) {
      alert('Informe uma chave Pix válida e o valor desejado.');
      return;
    }

    try {
      btnConfirmarSaque.disabled = true;
      btnConfirmarSaque.textContent = 'Enviando...';

      const resp = await fetch(`${API_URL}/api/motoristas/saques`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ chavePix, tipoChave, valor })
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.erro || 'Falha ao solicitar saque.');

      alert('Solicitação de Saque Pix enviada com sucesso! Aguarde a liquidação.');
      if (modalSaque) modalSaque.style.display = 'none';

      const inValor = document.getElementById('saqueValor');
      if (inValor) inValor.value = '';

      await atualizarPerfilESaldo();
    } catch (err) {
      alert(err.message);
    } finally {
      btnConfirmarSaque.disabled = false;
      btnConfirmarSaque.textContent = 'Confirmar Saque';
    }
  });
}

function iniciarRadarChamadas() {
  if (intervalRadar) clearInterval(intervalRadar);

  intervalRadar = setInterval(async () => {
    if (pedidoAceitoAtual || statusAprovacaoAtual !== 'aprovado') return;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(categoriaMotorista)}`);
      if (!resp.ok) return;

      const pedidos = await resp.json();

      const idsAtuais = pedidos.map(p => p.id);
      const existeNovaChamada = idsAtuais.some(id => !chamadasAnterioresIds.has(id));

      if (existeNovaChamada && pedidos.length > 0) {
        tocarAlertaSonoro();
      }

      chamadasAnterioresIds = new Set(idsAtuais);
      renderizarRadar(pedidos);
    } catch (err) {
      console.warn('Erro no radar:', err);
    }
  }, 4000);
}

function renderizarRadar(pedidos) {
  const feedEl = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
  if (!feedEl) return;

  if (!pedidos || pedidos.length === 0) {
    feedEl.innerHTML = '<div class="dock-empty">Aguardando novas chamadas na região...</div>';
    return;
  }

  feedEl.innerHTML = pedidos.map(p => `
    <div class="order-card">
      <div class="order-card-header">
        <span class="order-badge">${p.sub_tipo_label || 'HUBy'} #${String(p.id).slice(-4)}</span>
        <span class="order-price">R$ ${Number(p.valor_total).toFixed(2).replace('.', ',')}</span>
      </div>
      <div class="order-route">
        <span><strong>Partida:</strong> ${p.origem_endereco || 'Local do passageiro'}</span>
        <span><strong>Destino:</strong> ${p.destino_endereco}</span>
        <small style="color: var(--primary-green, #10B981); font-weight: 700;">${p.distancia_km} km • ${p.duracao_min || 5} min</small>
      </div>
      <button type="button" 
              class="btn-accept-order" 
              data-id="${p.id}" 
              data-lat-orig="${p.origem_lat || ''}" 
              data-lng-orig="${p.origem_lng || ''}" 
              data-lat-dest="${p.destino_lat || ''}" 
              data-lng-dest="${p.destino_lng || ''}">
        Aceitar Corrida
      </button>
    </div>
  `).join('');

  feedEl.querySelectorAll('.btn-accept-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const latOrig = parseFloat(btn.getAttribute('data-lat-orig'));
      const lngOrig = parseFloat(btn.getAttribute('data-lng-orig'));
      const latDest = parseFloat(btn.getAttribute('data-lat-dest'));
      const lngDest = parseFloat(btn.getAttribute('data-lng-dest'));

      const coordsOrig = (!isNaN(latOrig) && !isNaN(lngOrig)) ? [latOrig, lngOrig] : null;
      const coordsDest = (!isNaN(latDest) && !isNaN(lngDest)) ? [latDest, lngDest] : null;

      aceitarChamada(id, coordsOrig, coordsDest);
    });
  });
}

async function aceitarChamada(pedidoId, coordsOrig, coordsDest) {
  const token = localStorage.getItem('huby_token');

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/aceitar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Não foi possível aceitar a chamada.');

    pedidoAceitoAtual = data.pedido;

    if (coordsOrig && coordsDest && hubyMapa) {
      await hubyMapa.calcularRota(coordsOrig, coordsDest, '#10B981');
    }

    const feed = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
    if (feed) {
      feed.innerHTML = `
        <div class="order-card" style="border-color: var(--primary-green, #10B981);">
          <div class="order-card-header">
            <span class="order-badge" style="background: rgba(16,185,129,0.25);">EM ATENDIMENTO</span>
            <span class="order-price">R$ ${Number(pedidoAceitoAtual.valor_total).toFixed(2).replace('.', ',')}</span>
          </div>
          <div class="order-route">
            <span><strong>Destino:</strong> ${pedidoAceitoAtual.destino_endereco}</span>
            <small>Dirija-se ao local do passageiro.</small>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 10px;">
            <button type="button" id="btnCancelarPeloMotorista" style="flex: 1; background: #EF4444; color: #FFF; border: none; border-radius: 10px; padding: 12px; font-weight: 800; cursor: pointer;">
              Cancelar
            </button>
            <button type="button" id="btnConcluirCorrida" style="flex: 2; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 12px; font-weight: 800; cursor: pointer;">
              Concluir & Receber
            </button>
          </div>
        </div>
      `;

      document.getElementById('btnConcluirCorrida')?.addEventListener('click', concluirCorridaAtual);
      document.getElementById('btnCancelarPeloMotorista')?.addEventListener('click', cancelarCorridaAtual);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function cancelarCorridaAtual() {
  if (!pedidoAceitoAtual) return;
  if (!confirm('Tem certeza de que deseja cancelar este atendimento?')) return;

  const token = localStorage.getItem('huby_token');
  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/cancelar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ motivo: 'Cancelado pelo motorista parceiro' })
    });
  } catch (err) {
    console.warn('Erro ao notificar cancelamento:', err);
  }

  limparAtendimento();
}

async function concluirCorridaAtual() {
  if (!pedidoAceitoAtual) return;

  const token = localStorage.getItem('huby_token');

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/concluir`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.erro || 'Falha ao liquidar corrida.');

    alert(`Viagem Concluída!\n\nLíquido do Parceiro (85%): R$ ${Number(data.repasseLiquido).toFixed(2).replace('.', ',')}\nTaxa Plataforma (15%): R$ ${Number(data.taxaHuby).toFixed(2).replace('.', ',')}`);

    limparAtendimento();
    await atualizarPerfilESaldo();
  } catch (err) {
    alert(err.message);
  }
}

function limparAtendimento() {
  if (hubyMapa && hubyMapa.rotaLayer && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.rotaLayer);
    hubyMapa.rotaLayer = null;
  }
  pedidoAceitoAtual = null;
  iniciarRadarChamadas();
}