// js/cliente/cliente-chat.js - Chat em Tempo Real do Passageiro com Notificação Visual (Bolinha Vermelha)
import { API_URL, sonsHUBy } from '../config.js';
import { estadoCliente } from './cliente-estado.js';

let chatIntervalCliente = null;
let pedidoChatAtual = null;
let ultimoIdMensagemVistaCliente = 0;

function escaparHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function obterPedidoIdChat(pedidoIdParam = null) {
  return (
    pedidoIdParam ||
    pedidoChatAtual ||
    estadoCliente?.pedidoAtivoId ||
    localStorage.getItem('huby_pedido_ativo_id') ||
    ''
  );
}

function injetarEstiloBadgeChat() {
  if (document.getElementById('estilo-badge-chat-huby')) return;
  const style = document.createElement('style');
  style.id = 'estilo-badge-chat-huby';
  style.textContent = `
    @keyframes hubyPulseDot {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.85); }
      70% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }
    .huby-chat-red-dot {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 13px;
      height: 13px;
      background: #EF4444;
      border: 2px solid #090D16;
      border-radius: 50%;
      z-index: 20;
      animation: hubyPulseDot 1.3s infinite;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

export function atualizarNotificacaoChatCliente(temNovaMensagem) {
  injetarEstiloBadgeChat();
  const alvos = [
    document.getElementById('btnAbrirChat'),
    document.getElementById('btnAbrirChatClienteCard')
  ].filter(Boolean);

  alvos.forEach((btn) => {
    if (getComputedStyle(btn).position === 'static') {
      btn.style.position = 'relative';
    }
    let dot = btn.querySelector('.huby-chat-red-dot');
    if (temNovaMensagem) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'huby-chat-red-dot';
        btn.appendChild(dot);
      }
    } else if (dot) {
      dot.remove();
    }
  });
}

export function configurarChatCliente(pedidoId) {
  if (pedidoId && pedidoId !== pedidoChatAtual) {
    pedidoChatAtual = pedidoId;
    ultimoIdMensagemVistaCliente = 0;
  }

  const btnAbrirChatCard = document.getElementById('btnAbrirChatClienteCard');
  const btnAbrirChatFlut = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  const abrirChat = () => {
    const idAtivo = obterPedidoIdChat(pedidoId);
    if (modalChat) modalChat.style.display = 'flex';
    atualizarNotificacaoChatCliente(false);
    carregarMensagensChatCliente(idAtivo, true);
  };

  if (btnAbrirChatCard) btnAbrirChatCard.onclick = abrirChat;
  if (btnAbrirChatFlut) btnAbrirChatFlut.onclick = abrirChat;
  if (btnFecharChat) btnFecharChat.onclick = fecharChatCliente;

  if (btnEnviarMsg) {
    btnEnviarMsg.onclick = (e) => {
      e.preventDefault();
      enviarMensagemChatCliente(obterPedidoIdChat(pedidoId));
    };
  }
  if (inputMsg) {
    inputMsg.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enviarMensagemChatCliente(obterPedidoIdChat(pedidoId));
      }
    };
  }

  // Polling contínuo enquanto a corrida estiver ativa para acender a bolinha vermelha mesmo com o chat fechado
  if (!chatIntervalCliente) {
    chatIntervalCliente = setInterval(() => {
      const idAtivo = obterPedidoIdChat();
      if (idAtivo) {
        carregarMensagensChatCliente(idAtivo, false);
      }
    }, 2500);
  }
}

export function fecharChatCliente() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) modalChat.style.display = 'none';
}

export function encerrarMonitoramentoChatCliente() {
  if (chatIntervalCliente) {
    clearInterval(chatIntervalCliente);
    chatIntervalCliente = null;
  }
  pedidoChatAtual = null;
  ultimoIdMensagemVistaCliente = 0;
  atualizarNotificacaoChatCliente(false);
  fecharChatCliente();
}

export async function enviarMensagemChatCliente(pedidoIdParam) {
  const pedidoId = obterPedidoIdChat(pedidoIdParam);
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  if (!txt || !pedidoId) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return;
  }

  const token = localStorage.getItem('huby_token');
  const meuNome = localStorage.getItem('huby_user_name') || 'Passageiro';
  if (inputMsg) inputMsg.value = '';

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (areaMensagens) {
    areaMensagens.insertAdjacentHTML('beforeend', `
      <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px;">
        <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${escaparHTML(meuNome)}</small>
        <div style="background: #38BDF8; color: #000; font-weight: 600; padding: 8px 12px; border-radius: 12px 12px 0 12px; font-size: 13px; max-width: 80%; word-wrap: break-word;">
          ${escaparHTML(txt)}
        </div>
      </div>
    `);
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  }

  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ mensagem: txt, remetenteNome: meuNome })
    });
    await carregarMensagensChatCliente(pedidoId, true);
  } catch (err) {
    console.warn('Erro ao enviar mensagem:', err);
  }
}

export async function carregarMensagensChatCliente(pedidoIdParam, marcarComoLida = false) {
  const pedidoId = obterPedidoIdChat(pedidoIdParam);
  if (!pedidoId) return;
  const token = localStorage.getItem('huby_token');

  let meuId = localStorage.getItem('huby_user_id');
  if (!meuId && token && token.includes('.')) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      meuId = payload.id;
    } catch (e) {}
  }

  const modalChat = document.getElementById('modalChatCorrida');
  const modalAberto = modalChat && modalChat.style.display === 'flex';
  const areaMensagens = document.getElementById('chatAreaMensagens');

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat?t=${Date.now()}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();

    if (Array.isArray(msgs) && msgs.length > 0) {
      const ultima = msgs[msgs.length - 1];
      const ultimoId = Number(ultima.id || msgs.length);
      const veioDoMotorista = String(ultima.remetente_id) !== String(meuId);

      if (modalAberto || marcarComoLida) {
        ultimoIdMensagemVistaCliente = Math.max(ultimoIdMensagemVistaCliente, ultimoId);
        atualizarNotificacaoChatCliente(false);
      } else if (ultimoId > ultimoIdMensagemVistaCliente && veioDoMotorista) {
        atualizarNotificacaoChatCliente(true);
        if (sonsHUBy?.tocarAlertaChamada) {
          sonsHUBy.tocarAlertaChamada();
        }
      }
    }

    if (!areaMensagens) return;

    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat foi iniciado. Evite partilhar dados pessoais.</div>';

    msgs.forEach(m => {
      const souEu = (String(m.remetente_id) === String(meuId));
      const alinhamento = souEu ? 'flex-end' : 'flex-start';
      const corFundo = souEu ? '#38BDF8' : '#1F2937';
      const corTexto = souEu ? '#000' : '#FFF';
      const borderRadius = souEu ? '12px 12px 0 12px' : '12px 12px 12px 0';

      html += `
        <div style="display: flex; flex-direction: column; align-items: ${alinhamento}; margin-bottom: 6px;">
          <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${escaparHTML(m.remetente_nome || 'Mensagem')}</small>
          <div style="background: ${corFundo}; color: ${corTexto}; font-weight: 600; padding: 8px 12px; border-radius: ${borderRadius}; font-size: 13px; max-width: 80%; word-wrap: break-word;">
            ${escaparHTML(m.mensagem)}
          </div>
        </div>
      `;
    });

    areaMensagens.innerHTML = html;
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  } catch (err) {
    console.warn('Erro ao carregar mensagens:', err);
  }
}