import { API_URL } from './config.js';
import { HubyMapa } from './mapa.js';
// ADICIONADO: Importação direta da antena do Socket.IO para o frontend!
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

let hubyMapa = null;
let pedidoAceitoAtual = null;
let intervalRadar = null;
let chamadasAnterioresIds = new Set();
let statusAprovacaoAtual = 'aprovado';
let categoriaMotorista = 'carro';
let socketRadar = null; // Variável para manter a conexão em tempo real

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

  // 2. Configura modal de saque Pix e Chat
  configurarModalSaquePix();
  configurarChatMotorista();

  // 3. Carregar saldo, checar aprovação e identificar categoria (carro, moto, frete)
  await atualizarPerfilESaldo();

  // 4. Se aprovado, liga o radar de chamadas filtrado por categoria
  if (statusAprovacaoAtual === 'aprovado') {
    iniciarRadarChamadas();
  }

  // 5. Limpeza de recursos ao fechar ou recarregar
  window.addEventListener('beforeunload', () => {
    if (intervalRadar) clearInterval(intervalRadar);
    if (socketRadar) socketRadar.disconnect();
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

let chatInterval = null;

function configurarChatMotorista() {
  const btnAbrirChat = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  btnAbrirChat?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'flex';
    carregarMensagensChat();
    chatInterval = setInterval(carregarMensagensChat, 3000);
  });

  btnFecharChat?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'none';
    if (chatInterval) clearInterval(chatInterval);
  });

  btnEnviarMsg?.addEventListener('click', enviarMensagemChat);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
  });
}

async function enviarMensagemChat() {
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  if (!txt || !pedidoAceitoAtual || !pedidoAceitoAtual.id) return;

  const token = localStorage.getItem('huby_token');
  if (inputMsg) inputMsg.value = '';

  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}` 
      },
      body: JSON.stringify({ mensagem: txt })
    });
    carregarMensagensChat();
  } catch (err) {
    console.warn('Erro ao enviar msg:', err);
  }
}

async function carregarMensagensChat() {
  if (!pedidoAceitoAtual || !pedidoAceitoAtual.id) return;
  const token = localStorage.getItem('huby_token');
  const meuId = localStorage.getItem('huby_user_id');
  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/chat`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();
    
    let html = '<div style="text-align: center; color: #94A3B8; font-size: 11px;">O chat é monitorizado por segurança.</div>';
    
    msgs.forEach(m => {
      const souEu = (m.remetente_id === meuId);
      const alinhamento = souEu ? 'flex-end' : 'flex-start';
      const corFundo = souEu ? '#38BDF8' : '#1F2937';
      const corTexto = souEu ? '#000' : '#FFF';
      const borderRadius = souEu ? '12px 12px 0 12px' : '12px 12px 12px 0';
      
      html += `
        <div style="display: flex; flex-direction: column; align-items: ${alinhamento}; margin-bottom: 4px;">
          <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${m.remetente_nome}</small>
          <div style="background: ${corFundo}; color: ${corTexto}; padding: 8px 12px; border-radius: ${borderRadius}; font-size: 13px; max-width: 80%; word-wrap: break-word;">
            ${m.mensagem}
          </div>
        </div>
      `;
    });

    areaMensagens.innerHTML = html;
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  } catch (err) {
    console.warn('Erro ao ler chat:', err);
  }
}

// ==========================================
// RADAR DE CHAMADAS (AGORA EM TEMPO REAL!)
// ==========================================
function iniciarRadarChamadas() {
  // 1. Faz a busca inicial mal o motorista entra
  buscarChamadasPendentes();

  // 2. Conecta o Radar em Tempo Real (Socket.IO)
  if (!socketRadar) {
    socketRadar = io(API_URL);
    
    socketRadar.on('nova_chamada', (dados) => {
      // Se não estiver em viagem e estiver aprovado, força a atualização imediata da lista
      if (!pedidoAceitoAtual && statusAprovacaoAtual === 'aprovado') {
        console.log('⚡ CORRIDA RECEBIDA EM TEMPO REAL VIA SOCKET!', dados);
        buscarChamadasPendentes(true); // O true força o alerta sonoro
      }
    });
  }

  // 3. Mantém o Polling mais lento (10 seg) apenas como medida de segurança contra quebras de rede
  if (intervalRadar) clearInterval(intervalRadar);
  intervalRadar = setInterval(() => buscarChamadasPendentes(false), 10000);
}

// Função isolada para buscar as chamadas na base de dados
async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (pedidoAceitoAtual || statusAprovacaoAtual !== 'aprovado') return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/pendentes?categoria=${encodeURIComponent(categoriaMotorista)}`);
    if (!resp.ok) return;

    const pedidos = await resp.json();

    const idsAtuais = pedidos.map(p => p.id);
    const existeNovaChamada = idsAtuais.some(id => !chamadasAnterioresIds.has(id));

    if ((existeNovaChamada && pedidos.length > 0) || tocarSomForcado) {
      tocarAlertaSonoro();
    }

    chamadasAnterioresIds = new Set(idsAtuais);
    renderizarRadar(pedidos);
  } catch (err) {
    console.warn('Erro no radar:', err);
  }
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
        <small style="color: #10B981; font-weight: 700;">${p.distancia_km} km • ${p.duracao_min || 5} min</small>
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

    // Mostra o botão flutuante de chat do motorista
    const btnChat = document.getElementById('btnAbrirChat');
    if (btnChat) btnChat.style.display = 'flex';

    if (coordsOrig && coordsDest && hubyMapa) {
      await hubyMapa.calcularRota(coordsOrig, coordsDest, '#10B981');
    }

    const feed = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
    if (feed) {
      feed.innerHTML = `
        <div class="order-card" style="border-color: #10B981;">
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

  // Esconde o botão e fecha a janela do chat
  const btnChat = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  if (btnChat) btnChat.style.display = 'none';
  if (modalChat) modalChat.style.display = 'none';
  if (chatInterval) clearInterval(chatInterval);

  iniciarRadarChamadas();
}