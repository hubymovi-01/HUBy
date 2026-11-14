// js/motorista/motorista-chat.js - Chat em Tempo Real do Motorista HUBy
import { API_URL } from '../config.js';
import { estado, obterHeaders } from './motorista-estado.js';

let chatInterval = null;

function escaparHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function configurarChatMotorista() {
  const btnAbrirChat = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  btnAbrirChat?.addEventListener('click', () => {
    if (modalChat) modalChat.style.display = 'flex';
    carregarMensagensChat();
    if (!chatInterval) chatInterval = setInterval(carregarMensagensChat, 2500);
  });

  btnFecharChat?.addEventListener('click', fecharChat);

  btnEnviarMsg?.addEventListener('click', enviarMensagemChat);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      enviarMensagemChat();
    }
  });
}

export function fecharChat() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) modalChat.style.display = 'none';
  if (chatInterval) {
    clearInterval(chatInterval);
    chatInterval = null;
  }
}

async function enviarMensagemChat() {
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo || estado.corridaAtiva;
  const pedidoId = pedido?.id || localStorage.getItem('huby_corrida_ativa_mot_id');

  if (!txt || !pedidoId) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return;
  }

  if (inputMsg) inputMsg.value = '';

  // Renderização imediata (otimista) para o motorista ver na hora
  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (areaMensagens) {
    const meuNome = localStorage.getItem('huby_user_name') || 'Motorista';
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
        remetenteNome: localStorage.getItem('huby_user_name') || 'Motorista'
      })
    });
    await carregarMensagensChat();
  } catch (err) {
    console.warn('Erro ao enviar msg:', err);
  }
}

async function carregarMensagensChat() {
  const pedido = estado.pedidoAceitoAtual || estado.pedidoAtivo || estado.corridaAtiva;
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

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat?t=${Date.now()}`, {
      headers: obterHeaders()
    });
    if (!resp.ok) return;
    const msgs = await resp.json();

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