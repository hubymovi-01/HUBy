// js/motorista/motorista-chat.js - Chat em Tempo Real do Motorista com Notificação Visual (Bolinha Vermelha)
import { API_URL, sonsHUBy } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';

let chatInterval = null;
let ultimoIdMensagemVistaMotorista = 0;
let pedidoMonitoradoMotorista = null;

function escaparHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injetarEstiloBadgeChatMotorista() {
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
      top: -2px;
      right: -2px;
      width: 14px;
      height: 14px;
      background: #EF4444;
      border: 2px solid #090D16;
      border-radius: 50%;
      z-index: 25;
      animation: hubyPulseDot 1.3s infinite;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

export function atualizarNotificacaoChatMotorista(temNovaMensagem) {
  injetarEstiloBadgeChatMotorista();
  const btnAbrirChat = document.getElementById('btnAbrirChat');
  if (!btnAbrirChat) return;

  let dot = btnAbrirChat.querySelector('.huby-chat-red-dot');
  if (temNovaMensagem) {
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'huby-chat-red-dot';
      btnAbrirChat.appendChild(dot);
    }
  } else if (dot) {
    dot.remove();
  }
}

export function configurarChatMotorista() {
  const btnAbrirChat = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  if (btnAbrirChat) {
    btnAbrirChat.onclick = () => {
      if (modalChat) modalChat.style.display = 'flex';
      atualizarNotificacaoChatMotorista(false);
      carregarMensagensChat(true);
    };
  }

  if (btnFecharChat) {
    btnFecharChat.onclick = fecharChat;
  }

  if (btnEnviarMsg) {
    btnEnviarMsg.onclick = (e) => {
      e.preventDefault();
      enviarMensagemChat();
    };
  }

  if (inputMsg) {
    inputMsg.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        enviarMensagemChat();
      }
    };
  }

  // Polling contínuo enquanto houver corrida ativa para acender a bolinha vermelha mesmo com o chat fechado
  if (!chatInterval) {
    chatInterval = setInterval(() => {
      const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
      const pedidoId = pedido?.id || localStorage.getItem('huby_corrida_ativa_mot_id');
      if (pedidoId) {
        if (pedidoId !== pedidoMonitoradoMotorista) {
          pedidoMonitoradoMotorista = pedidoId;
          ultimoIdMensagemVistaMotorista = 0;
        }
        carregarMensagensChat(false);
      } else {
        pedidoMonitoradoMotorista = null;
        ultimoIdMensagemVistaMotorista = 0;
        atualizarNotificacaoChatMotorista(false);
      }
    }, 2500);
  }
}

export function fecharChat() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) modalChat.style.display = 'none';
}

async function enviarMensagemChat() {
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
  const pedidoId = pedido?.id || localStorage.getItem('huby_corrida_ativa_mot_id');

  if (!txt || !pedidoId) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return;
  }

  const meuNome = estado.motoristaNome || localStorage.getItem('huby_user_name') || 'Motorista';
  if (inputMsg) inputMsg.value = '';

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (areaMensagens) {
    areaMensagens.insertAdjacentHTML('beforeend', `
      <div style="display: flex; flex-direction: column; align-items: flex-end; margin-bottom: 6px;">
        <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${escaparHTML(meuNome)}</small>
        <div style="background: #10B981; color: #02261C; font-weight: 600; padding: 8px 12px; border-radius: 12px; font-size: 13px; max-width: 80%;">
          ${escaparHTML(txt)}
        </div>
      </div>
    `);
    areaMensagens.scrollTop = areaMensagens.scrollHeight;
  }

  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      method: 'POST',
      headers: obterHeaders(),
      body: JSON.stringify({
        mensagem: txt,
        remetenteNome: meuNome
      })
    });
    await carregarMensagensChat(true);
  } catch (err) {
    console.warn('Erro ao enviar msg:', err);
  }
}

async function carregarMensagensChat(marcarComoLida = false) {
  const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo;
  const pedidoId = pedido?.id || localStorage.getItem('huby_corrida_ativa_mot_id');
  if (!pedidoId) return;

  const token = estado.token || localStorage.getItem('huby_token');
  let meuId = estado.motoristaId || localStorage.getItem('huby_user_id');

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
      headers: obterHeaders()
    });
    if (!resp.ok) return;
    const msgs = await resp.json();

    if (Array.isArray(msgs) && msgs.length > 0) {
      const ultima = msgs[msgs.length - 1];
      const ultimoId = Number(ultima.id || msgs.length);
      const veioDoPassageiro = String(ultima.remetente_id) !== String(meuId);

      if (modalAberto || marcarComoLida) {
        ultimoIdMensagemVistaMotorista = Math.max(ultimoIdMensagemVistaMotorista, ultimoId);
        atualizarNotificacaoChatMotorista(false);
      } else if (ultimoId > ultimoIdMensagemVistaMotorista && veioDoPassageiro) {
        atualizarNotificacaoChatMotorista(true);
        if (sonsHUBy?.tocarAlertaChamada) {
          sonsHUBy.tocarAlertaChamada();
        }
      }
    }

    if (!areaMensagens) return;

    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat é monitorizado por segurança.</div>';

    msgs.forEach((m) => {
      const souEu = String(m.remetente_id) === String(meuId);
      html += `
        <div style="display: flex; flex-direction: column; align-items: ${souEu ? 'flex-end' : 'flex-start'}; margin-bottom: 6px;">
          <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${escaparHTML(m.remetente_nome || 'Mensagem')}</small>
          <div style="background: ${souEu ? '#10B981' : '#1F2937'}; color: ${souEu ? '#02261C' : '#FFF'}; font-weight: 600; padding: 8px 12px; border-radius: 12px; font-size: 13px; max-width: 80%;">
            ${escaparHTML(m.mensagem)}
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