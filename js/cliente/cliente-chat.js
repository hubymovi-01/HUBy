// js/cliente/cliente-chat.js - Chat em Tempo Real do Passageiro HUBy (Renderização Instantânea)
import { API_URL } from '../config.js';
import { estadoCliente } from './cliente-estado.js';

let chatIntervalCliente = null;
let pedidoChatAtual = null;

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

export function configurarChatCliente(pedidoId) {
  if (pedidoId) pedidoChatAtual = pedidoId;

  const btnAbrirChatCard = document.getElementById('btnAbrirChatClienteCard');
  const btnAbrirChatFlut = document.getElementById('btnAbrirChat');
  const modalChat = document.getElementById('modalChatCorrida');
  const btnFecharChat = document.getElementById('btnFecharChat');
  const btnEnviarMsg = document.getElementById('btnEnviarMsgChat');
  const inputMsg = document.getElementById('inputChatMsg');

  const abrirChat = () => {
    const idAtivo = obterPedidoIdChat(pedidoId);
    if (modalChat) modalChat.style.display = 'flex';
    carregarMensagensChatCliente(idAtivo);
    if (!chatIntervalCliente) {
      chatIntervalCliente = setInterval(() => carregarMensagensChatCliente(obterPedidoIdChat(pedidoId)), 2500);
    }
  };

  if (btnAbrirChatCard) {
    btnAbrirChatCard.onclick = abrirChat;
  }
  if (btnAbrirChatFlut) {
    btnAbrirChatFlut.onclick = abrirChat;
  }
  if (btnFecharChat) {
    btnFecharChat.onclick = fecharChatCliente;
  }

  // Usa .onclick / .onkeydown para evitar disparos duplicados durante o polling
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
}

export function fecharChatCliente() {
  const modalChat = document.getElementById('modalChatCorrida');
  if (modalChat) modalChat.style.display = 'none';
  if (chatIntervalCliente) {
    clearInterval(chatIntervalCliente);
    chatIntervalCliente = null;
  }
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

  // Renderização imediata na tela antes mesmo da resposta do servidor
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
    await carregarMensagensChatCliente(pedidoId);
  } catch (err) {
    console.warn('Erro ao enviar mensagem:', err);
  }
}

export async function carregarMensagensChatCliente(pedidoIdParam) {
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

  const areaMensagens = document.getElementById('chatAreaMensagens');
  if (!areaMensagens) return;

  try {
    const resp = await fetch(`${API_URL}/api/pedidos/${pedidoId}/chat?t=${Date.now()}`, {
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