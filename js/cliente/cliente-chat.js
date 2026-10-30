// js/cliente/cliente-chat.js
import { API_URL } from '../config.js';

let chatIntervalCliente = null;

export function configurarChatCliente(pedidoId) {
  const btnAbrirChatCard = document.getElementById('btnAbrirChatClienteCard');
  const btnAbrirChatFlut = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  const abrirChat = () => {
    if (modalChat) modalChat.style.display = 'flex';
    carregarMensagensChatCliente(pedidoId);
    if (!chatIntervalCliente) {
      chatIntervalCliente = setInterval(() => carregarMensagensChatCliente(pedidoId), 3000);
    }
  };

  btnAbrirChatCard?.addEventListener('click', abrirChat);
  btnAbrirChatFlut?.addEventListener('click', abrirChat);

  btnFecharChat?.addEventListener('click', fecharChatCliente);

  btnEnviarMsg?.addEventListener('click', () => enviarMensagemChatCliente(pedidoId));
  inputMsg?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensagemChatCliente(pedidoId);
  });
}

export function fecharChatCliente() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) modalChat.style.display = 'none';
  if (chatIntervalCliente) {
    clearInterval(chatIntervalCliente);
    chatIntervalCliente = null;
  }
}

export async function enviarMensagemChatCliente(pedidoId) {
  const inputMsg = document.getElementById('inputChatMsg');
  const txt = inputMsg ? inputMsg.value.trim() : '';
  if (!txt || !pedidoId) return;

  const quantidadeNumeros = (txt.match(/\d/g) || []).length;
  if (quantidadeNumeros >= 4) {
    alert('⚠️ Segurança HUBy:\nPor motivos de segurança, não é permitido partilhar números de telefone ou contactos no chat.');
    return; 
  }

  const token = localStorage.getItem('huby_token');
  if (inputMsg) inputMsg.value = '';

  try {
    await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ mensagem: txt })
    });
    carregarMensagensChatCliente(pedidoId);
  } catch (err) {
    console.warn('Erro ao enviar mensagem:', err);
  }
}

export async function carregarMensagensChatCliente(pedidoId) {
  if (!pedidoId) return;
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
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!resp.ok) return;
    const msgs = await resp.json();
    
    let html = '<div style="text-align: center; color: #64748B; font-size: 11px; margin-bottom: 10px;">O chat foi iniciado. Evite partilhar dados pessoais.</div>';
    
    msgs.forEach(m => {
      const souEu = (String(m.remetente_id) === String(meuId));
      const alinhamento = souEu ? 'flex-end' : 'flex-start';
      const corFundo = souEu ? '#38BDF8' : '#1F2937';
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
    console.warn('Erro ao carregar mensagens:', err);
  }
}