// js/motorista/motorista-chat.js
import { API_URL } from '../config.js';
import { estado } from './motorista-estado.js';

let chatInterval = null;

export function configurarChatMotorista() {
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

  btnFecharChat?.addEventListener('click', fecharChat);

  btnEnviarMsg?.addEventListener('click', enviarMensagemChat);
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChat();
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
  if (!txt || !estado.pedidoAceitoAtual?.id) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return;
  }

  const token = localStorage.getItem('huby_token');
  if (inputMsg) inputMsg.value = '';

  try {
    await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/chat`, {
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
  if (!estado.pedidoAceitoAtual?.id) return;
  const token = localStorage.getItem('huby_token');

  let meuId = null;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      meuId = payload.id;
    } catch (e) {}
  }

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${estado.pedidoAceitoAtual.id}/chat`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();

    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat é monitorizado por segurança.</div>';

    msgs.forEach((m) => {
      const souEu = String(m.remetente_id) === String(meuId);
      html += `
        <div style="display: flex; flex-direction: column; align-items: ${souEu ? 'flex-end' : 'flex-start'}; margin-bottom: 6px;">
          <small style="font-size: 9px; color: #94A3B8; margin-bottom: 2px;">${m.remetente_nome}</small>
          <div style="background: ${souEu ? '#10B981' : '#1F2937'}; color: ${souEu ? '#000' : '#FFF'}; padding: 8px 12px; border-radius: 12px; font-size: 13px; max-width: 80%;">
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