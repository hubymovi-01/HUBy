import { API_URL } from './config.js';
import { HubyMapa } from './mapa.js';
import { io } from 'https://cdn.socket.io/4.7.2/socket.io.esm.min.js';

let hubyMapa = null;
let pedidoAceitoAtual = null;
let pedidoEmAnalise = null; // Guarda a chamada que o motorista está visualizando no mapa
let intervalRadar = null;
let chamadasAnterioresIds = new Set();
let statusAprovacaoAtual = 'aprovado';
let categoriaMotorista = 'carro';
let socketRadar = null; 

// Filtro Direção de Casa
let direcaoCasaAtiva = false;
let coordsCasaMotorista = null;

// Telemetria GPS em Tempo Real para o Radar Master
let intervalTelemetria = null;

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('huby_token');
  const role = localStorage.getItem('huby_user_role');

  if (!token || role !== 'motorista') {
    alert('Acesso restrito a condutores parceiros.');
    window.location.replace('./login.html');
    return;
  }

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
      iniciarTransmissaoTelemetria(pos);
    });
  } catch (err) {
    console.warn('Erro ao inicializar mapa do motorista:', err);
  }

  configurarModalSaquePix();
  configurarChatMotorista();
  configurarFiltroDirecaoCasa();

  await atualizarPerfilESaldo();

  if (statusAprovacaoAtual === 'aprovado') {
    iniciarRadarChamadas();
  }

  window.addEventListener('beforeunload', () => {
    if (intervalRadar) clearInterval(intervalRadar);
    if (intervalTelemetria) clearInterval(intervalTelemetria);
    if (socketRadar) socketRadar.disconnect();
    if (hubyMapa?.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(hubyMapa.watchId);
    }
  });
});

// ==========================================
// 1. TRANSMISSÃO TELEMÉTRICA GPS (RADAR MASTER)
// ==========================================
function iniciarTransmissaoTelemetria(posicaoInicial) {
  const token = localStorage.getItem('huby_token');
  if (!token) return;

  const enviarPosicao = async (lat, lng) => {
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
          emCorrida: !!pedidoAceitoAtual
        })
      });
    } catch (e) {
      console.warn('Falha na telemetria GPS:', e);
    }
  };

  if (posicaoInicial) enviarPosicao(posicaoInicial.lat, posicaoInicial.lng);

  if (intervalTelemetria) clearInterval(intervalTelemetria);
  intervalTelemetria = setInterval(() => {
    if (hubyMapa && hubyMapa.coordsOrigem) {
      enviarPosicao(hubyMapa.coordsOrigem[0], hubyMapa.coordsOrigem[1]);
    }
  }, 10000);
}

// ==========================================
// 2. FILTRO "DIREÇÃO DE CASA"
// ==========================================
function configurarFiltroDirecaoCasa() {
  const btnCasa = document.getElementById('btnFiltroCasa');
  if (!btnCasa) return;

  btnCasa.addEventListener('click', async () => {
    const token = localStorage.getItem('huby_token');

    if (!direcaoCasaAtiva) {
      const enderecoCasa = prompt('Insira o endereço ou ponto de referência de sua casa:');
      if (!enderecoCasa) return;

      const latCasa = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[0] : -8.3580;
      const lngCasa = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[1] : -42.2460;
      coordsCasaMotorista = { lat: latCasa, lng: lngCasa };

      try {
        const resp = await fetch(`${API_URL}/api/motoristas-regras/filtro-destino`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ativo: true,
            lat: coordsCasaMotorista.lat,
            lng: coordsCasaMotorista.lng
          })
        });

        if (resp.ok) {
          direcaoCasaAtiva = true;
          btnCasa.style.background = '#F59E0B';
          btnCasa.style.color = '#000';
          btnCasa.textContent = '🏠 Rumo a Casa (Ativo)';
          alert('Filtro ativado! Receberá chamadas com rota direcionada à sua residência.');
        }
      } catch (err) {
        alert('Erro ao ativar filtro.');
      }
    } else {
      try {
        await fetch(`${API_URL}/api/motoristas-regras/filtro-destino`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ ativo: false })
        });
        direcaoCasaAtiva = false;
        btnCasa.style.background = '';
        btnCasa.style.color = '';
        btnCasa.textContent = '🏠 Direção de Casa';
        alert('Filtro desativado. Modo normal restaurado.');
      } catch (err) {
        alert('Erro ao desativar filtro.');
      }
    }
  });
}

// ==========================================
// 3. BOTÃO DE PÂNICO / SOS DO MOTORISTA
// ==========================================
function configurarBotaoSosMotorista() {
  const btnSos = document.getElementById('btnSosMotorista');
  if (!btnSos) return;

  btnSos.addEventListener('click', async () => {
    if (!pedidoAceitoAtual) {
      alert('O alerta SOS só pode ser emitido durante um atendimento em andamento.');
      return;
    }

    if (!confirm('🚨 ALERTA DE EMERGÊNCIA HUBy!\nDeseja acionar a central de segurança da plataforma agora?')) {
      return;
    }

    const token = localStorage.getItem('huby_token');
    const lat = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[0] : null;
    const lng = hubyMapa?.coordsOrigem ? hubyMapa.coordsOrigem[1] : null;

    try {
      const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/sos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          lat,
          lng,
          relato: 'SOS emitido pelo motorista parceiro durante a corrida.'
        })
      });

      if (resp.ok) {
        alert('🚨 SOS REGISTRADO!\nA central de suporte do Admin Master foi notificada com a sua posição GPS.');
      }
    } catch (err) {
      alert('Falha ao acionar socorro via rede. Contate a polícia (190).');
    }
  });
}

// ==========================================
// 4. ALERTA SONORO
// ==========================================
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

// ==========================================
// 5. ATUALIZAR PERFIL E SALDO
// ==========================================
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

// ==========================================
// 6. GESTÃO DE SAQUES PIX
// ==========================================
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

// ==========================================
// 7. CHAT DO MOTORISTA
// ==========================================
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
    if (!chatInterval) chatInterval = setInterval(carregarMensagensChat, 3000);
  });

  btnFecharChat?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'none';
    if (chatInterval) {
      clearInterval(chatInterval);
      chatInterval = null;
    }
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

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return;
  }

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
  
  let meuId = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      meuId = payload.id;
    } catch(e) {}
  }

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoAceitoAtual.id}/chat`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();
    
    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat é monitorizado por segurança.</div>';
    
    msgs.forEach(m => {
      const souEu = (String(m.remetente_id) === String(meuId));
      
      const alinhamento = souEu ? 'flex-end' : 'flex-start';
      const corFundo = souEu ? '#10B981' : '#1F2937'; 
      const corTexto = souEu ? '#000' : '#FFF';
      const borderRadius = souEu ? '12px 12px 0 12px' : '12px 12px 12px 0';
      
      html += `
        <div style="display: flex; flex-direction: column; align-items: ${alinhamento}; margin-bottom: 6px;">
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
// 8. RADAR DE CHAMADAS E SOCKET.IO BROADCAST
// ==========================================
function iniciarRadarChamadas() {
  buscarChamadasPendentes();

  if (!socketRadar) {
    socketRadar = io(API_URL);
    
    socketRadar.on('nova_chamada', () => {
      // Se não estiver em corrida e nem estiver analisando uma rota, atualiza o feed
      if (!pedidoAceitoAtual && !pedidoEmAnalise && statusAprovacaoAtual === 'aprovado') {
        buscarChamadasPendentes(true); 
      }
    });

    socketRadar.on('alerta_broadcast_geral', (dados) => {
      if (dados.publico === 'todos' || dados.publico === 'motoristas') {
        alert(`📢 COMUNICADO OFICIAL HUBY:\n\n${dados.titulo}\n\n${dados.mensagem}`);
      }
    });
  }

  if (intervalRadar) clearInterval(intervalRadar);
  intervalRadar = setInterval(() => {
    if (!pedidoAceitoAtual && !pedidoEmAnalise) {
      buscarChamadasPendentes(false);
    }
  }, 10000);
}

async function buscarChamadasPendentes(tocarSomForcado = false) {
  if (pedidoAceitoAtual || pedidoEmAnalise || statusAprovacaoAtual !== 'aprovado') return;

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

  feedEl.innerHTML = pedidos.map(p => {
    const latOrig = p.coordsOrigem ? p.coordsOrigem[0] : (p.origem_lat || '');
    const lngOrig = p.coordsOrigem ? p.coordsOrigem[1] : (p.origem_lng || '');
    const latDest = p.coordsDestino ? p.coordsDestino[0] : (p.destino_lat || '');
    const lngDest = p.coordsDestino ? p.coordsDestino[1] : (p.destino_lng || '');

    return `
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
              data-preco="${p.valor_total}"
              data-origem="${p.origem_endereco || 'Local do passageiro'}"
              data-destino="${p.destino_endereco}"
              data-dist="${p.distancia_km}"
              data-dur="${p.duracao_min || 5}"
              data-lat-orig="${latOrig}" 
              data-lng-orig="${lngOrig}" 
              data-lat-dest="${latDest}" 
              data-lng-dest="${lngDest}">
        Visualizar Rota no Mapa
      </button>
    </div>
  `}).join('');

  feedEl.querySelectorAll('.btn-accept-order').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const preco = btn.getAttribute('data-preco');
      const origem = btn.getAttribute('data-origem');
      const destino = btn.getAttribute('data-destino');
      const dist = btn.getAttribute('data-dist');
      const dur = btn.getAttribute('data-dur');
      const latOrig = parseFloat(btn.getAttribute('data-lat-orig'));
      const lngOrig = parseFloat(btn.getAttribute('data-lng-orig'));
      const latDest = parseFloat(btn.getAttribute('data-lat-dest'));
      const lngDest = parseFloat(btn.getAttribute('data-lng-dest'));

      const coordsOrig = (!isNaN(latOrig) && !isNaN(lngOrig)) ? [latOrig, lngOrig] : null;
      const coordsDest = (!isNaN(latDest) && !isNaN(lngDest)) ? [latDest, lngDest] : null;

      // ETAPA 1: Pré-visualizar no mapa sem mudar o status para o passageiro!
      preVisualizarRotaPedido({
        id,
        preco,
        origem,
        destino,
        dist,
        dur,
        coordsOrig,
        coordsDest
      });
    });
  });
}

// ==========================================
// 9. PRÉ-VISUALIZAÇÃO DA ROTA (SEM ACEITAR NO BANCO)
// ==========================================
async function preVisualizarRotaPedido(dados) {
  pedidoEmAnalise = dados;

  // Pausa a atualização periódica da lista para manter a análise na tela
  if (intervalRadar) clearInterval(intervalRadar);

  // 1. Plota a rota da viagem no mapa para o condutor inspecionar o trajeto
  if (dados.coordsOrig && dados.coordsDest && hubyMapa) {
    try {
      await hubyMapa.calcularRota(dados.coordsOrig, dados.coordsDest, '#38BDF8');
    } catch (err) {
      console.warn('Erro ao plotar prévia da rota no mapa:', err);
    }
  }

  // 2. Exibe o card de decisão: "Confirmar Aceite" ou "Voltar/Recusar"
  const feed = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
  if (feed) {
    feed.innerHTML = `
      <div class="order-card" style="border: 2px solid #F59E0B; background: #0E131F;">
        <div class="order-card-header">
          <span class="order-badge" style="background: rgba(245,158,11,0.2); color: #F59E0B;">🔍 ANALISANDO ROTA</span>
          <span class="order-price">R$ ${Number(dados.preco).toFixed(2).replace('.', ',')}</span>
        </div>
        <div class="order-route">
          <span style="display: block; color: #F59E0B; font-weight: 800; font-size: 14px; margin-bottom: 6px;">
            Confira o trajeto traçado no mapa antes de confirmar
          </span>
          <span><strong>Origem:</strong> ${dados.origem}</span>
          <span><strong>Destino:</strong> ${dados.destino}</span>
          <small style="color: #38BDF8; font-weight: 700; display: block; margin-top: 4px;">
            📏 Distância: ${dados.dist} km • ⏱️ Estimativa: ~${dados.dur} min
          </small>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 14px;">
          <button type="button" id="btnRecusarPrevia" style="flex: 1; background: #1F2937; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 12px; font-weight: 700; cursor: pointer;">
            ✕ Voltar
          </button>
          <button type="button" id="btnConfirmarAceite" style="flex: 1.3; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 12px; font-weight: 900; cursor: pointer; font-size: 14px;">
            ✓ Aceitar Viagem
          </button>
        </div>
      </div>
    `;

    document.getElementById('btnRecusarPrevia')?.addEventListener('click', () => {
      cancelarPrevia();
    });

    document.getElementById('btnConfirmarAceite')?.addEventListener('click', () => {
      // AGORA SIM: Motorista confirmou voluntariamente, altera o status para o cliente!
      efetivarAceiteChamada(dados.id, dados.coordsOrig, dados.coordsDest);
    });
  }
}

function cancelarPrevia() {
  pedidoEmAnalise = null;
  if (hubyMapa && hubyMapa.rotaLayer && hubyMapa.map) {
    hubyMapa.map.removeLayer(hubyMapa.rotaLayer);
    hubyMapa.rotaLayer = null;
  }
  iniciarRadarChamadas();
}

// ==========================================
// 10. EFETIVAR ACEITE (NOTIFICA O CLIENTE)
// ==========================================
async function efetivarAceiteChamada(pedidoId, coordsOrig, coordsDest) {
  const token = localStorage.getItem('huby_token');
  const btn = document.getElementById('btnConfirmarAceite');

  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Confirmando...';
    }

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
    pedidoEmAnalise = null;

    const btnChat = document.getElementById('btnAbrirChat');
    if (btnChat) btnChat.style.display = 'flex';

    const feed = document.querySelector('.orders-feed') || document.getElementById('listaChamadasPendentes');
    if (feed) {
      feed.innerHTML = `
        <div class="order-card" style="border-color: #38BDF8;">
          <div class="order-card-header">
            <span class="order-badge" style="background: rgba(56,189,248,0.25); color: #38BDF8;">EM ATENDIMENTO</span>
            <span class="order-price">R$ ${Number(pedidoAceitoAtual.valor_total).toFixed(2).replace('.', ',')}</span>
          </div>
          <div class="order-route">
            <span style="display: block; color: #38BDF8; font-weight: 800; font-size: 15px; margin-bottom: 6px;" id="lblTempoPassageiro">
              📍 A calcular GPS até ao cliente...
            </span>
            <span><strong>Recolha:</strong> ${pedidoAceitoAtual.origem_endereco || 'Local do passageiro'}</span>
            <span><strong>Destino:</strong> ${pedidoAceitoAtual.destino_endereco}</span>
            <small style="color: #10B981; font-weight: 700; display: block; margin-top: 4px;">⏱️ Viagem até destino: ~${pedidoAceitoAtual.duracao_min || 5} min</small>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 14px;">
            <button type="button" id="btnNavegarDestino" style="flex: 1; background: #2563EB; color: #FFF; border: none; border-radius: 10px; padding: 12px; font-weight: 800; cursor: pointer; transition: 0.2s;">
              📍 Iniciar Viagem
            </button>
            <button type="button" id="btnConcluirCorrida" style="flex: 1; background: #10B981; color: #03251E; border: none; border-radius: 10px; padding: 12px; font-weight: 800; cursor: pointer; transition: 0.2s;">
              ✅ Concluir
            </button>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button type="button" id="btnCancelarPeloMotorista" style="flex: 1; background: transparent; color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 10px; font-weight: 700; cursor: pointer;">
              Cancelar Corrida
            </button>
            <button type="button" id="btnSosMotorista" style="flex: 1; background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid #EF4444; border-radius: 10px; padding: 10px; font-weight: 800; cursor: pointer;">
              🚨 SOS Alerta
            </button>
          </div>
        </div>
      `;

      document.getElementById('btnConcluirCorrida')?.addEventListener('click', concluirCorridaAtual);
      document.getElementById('btnCancelarPeloMotorista')?.addEventListener('click', cancelarCorridaAtual);
      configurarBotaoSosMotorista();
      
      document.getElementById('btnNavegarDestino')?.addEventListener('click', async () => {
         if (coordsOrig && coordsDest && hubyMapa) {
             await hubyMapa.calcularRota(coordsOrig, coordsDest, '#10B981'); 
             const lblTempo = document.getElementById('lblTempoPassageiro');
             if (lblTempo) {
               lblTempo.innerHTML = '🏁 A caminho do destino final!';
               lblTempo.style.color = '#10B981';
             }
         }
      });
    }

    // Traça rota até o cliente
    if (coordsOrig && hubyMapa) {
        if (hubyMapa.coordsOrigem) {
           hubyMapa.calcularRota(hubyMapa.coordsOrigem, coordsOrig, '#38BDF8');
        }
        
        hubyMapa.obterGPS(async (pos) => {
            try {
                const rotaAteCliente = await hubyMapa.calcularRota([pos.lat, pos.lng], coordsOrig, '#38BDF8');
                const lblTempo = document.getElementById('lblTempoPassageiro');
                if (lblTempo) {
                    lblTempo.innerHTML = `⏳ Chega ao passageiro em <span style="font-size:18px;">${rotaAteCliente.duracaoMin} min</span>`;
                }
            } catch (e) {
                console.warn('Erro ao traçar rota até cliente:', e);
                const lblTempo = document.getElementById('lblTempoPassageiro');
                if (lblTempo) lblTempo.textContent = '📍 Siga para o local de recolha';
            }
        });
    }

  } catch (err) {
    alert(err.message);
    cancelarPrevia();
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

    alert(`Viagem Concluída!\n\nLíquido do Parceiro: R$ ${Number(data.repasseLiquido).toFixed(2).replace('.', ',')}\nTaxa Plataforma: R$ ${Number(data.taxaHuby).toFixed(2).replace('.', ',')}`);

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
  pedidoEmAnalise = null;

  const btnChat = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  if (btnChat) btnChat.style.display = 'none';
  if (modalChat) modalChat.style.display = 'none';
  if (chatInterval) {
    clearInterval(chatInterval);
    chatInterval = null;
  }

  iniciarRadarChamadas();
}