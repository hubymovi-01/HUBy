// js/push-cliente.js - Recetor de Notificações Inteligentes
import { API_URL } from './config.js';

// ============================================================================
// 1. ESTILOS DO ALERTA ELEGANTE IN-APP (Injetado dinamicamente)
// ============================================================================
const style = document.createElement('style');
style.innerHTML = `
  .huby-push-toast {
    position: fixed;
    top: -100px;
    left: 50%;
    transform: translateX(-50%);
    width: 90%;
    max-width: 400px;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 14px 40px rgba(0,0,0,0.6);
    z-index: 99999;
    transition: top 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .huby-push-toast.show {
    top: 24px;
  }
  .huby-push-icon {
    font-size: 24px;
    background: rgba(56, 189, 248, 0.15);
    width: 42px;
    height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    flex-shrink: 0;
  }
  .huby-push-content {
    flex: 1;
  }
  .huby-push-content h4 { 
    margin: 0 0 4px 0; 
    color: #FFF; 
    font-size: 15px; 
    font-weight: 800; 
    font-family: -apple-system, sans-serif;
  }
  .huby-push-content p { 
    margin: 0; 
    color: #94A3B8; 
    font-size: 13px; 
    line-height: 1.4; 
  }
`;
document.head.appendChild(style);

// ============================================================================
// 2. FUNÇÃO PRINCIPAL DE ESCUTA
// ============================================================================
export function inicializarPushNotifications() {
  const token = localStorage.getItem('huby_token') || '';
  
  // Descobre se quem está a usar é motorista ou passageiro
  const role = localStorage.getItem('huby_user_role') || 'motorista'; 
  
  // Pega a região do utilizador (Ex: 'sao_joao_pi'). Se não tiver, assume um padrão ou vazio.
  const minhaRegiao = localStorage.getItem('huby_regiao') || 'sao_joao_pi'; 

  // Pede permissão para notificações nativas do Android/iOS
  if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  // Conecta ao Socket para escutar o servidor
  const socket = window.io ? window.io(API_URL, { auth: { token } }) : null;
  if (!socket) return;

  socket.on('nova_notificacao_push', (dados) => {
    // 1. FILTRO DE PÚBLICO ALVO
    if (dados.publico !== 'todos' && dados.publico !== `${role}s`) {
      return; // Se for para passageiros e eu for motorista, ignora.
    }

    // 2. FILTRO DE REGIÃO INTELIGENTE
    if (dados.regiao !== 'todas' && dados.regiao !== minhaRegiao) {
      return; // Ignora alertas de São Paulo se eu estiver no Piauí
    }

    // 3. EXIBE NOTIFICAÇÃO NATIVA (Se a app estiver minimizada)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(dados.titulo, {
          body: dados.mensagem,
          icon: './img/icon-192.png'
        });
      } catch (e) {
        console.warn('O browser bloqueou o push nativo, caindo para o in-app.', e);
      }
    }

    // 4. EXIBE O TOAST ELEGANTE DENTRO DO APP (Estilo Apple)
    mostrarToastElegante(dados.titulo, dados.mensagem);
  });
}

// ============================================================================
// 3. DESENHO E ANIMAÇÃO DA NOTIFICAÇÃO NO ECRÃ
// ============================================================================
function mostrarToastElegante(titulo, mensagem) {
  const toast = document.createElement('div');
  toast.className = 'huby-push-toast';
  
  // Define o ícone com base no título (dinâmico)
  let icone = '🚀';
  const txtLower = titulo.toLowerCase();
  if (txtLower.includes('chuva') || txtLower.includes('tempo')) icone = '⛈️';
  if (txtLower.includes('bônus') || txtLower.includes('ganho')) icone = '💰';
  if (txtLower.includes('demanda') || txtLower.includes('calor')) icone = '🔥';

  toast.innerHTML = `
    <div class="huby-push-icon">${icone}</div>
    <div class="huby-push-content">
      <h4>${titulo}</h4>
      <p>${mensagem}</p>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Animação de entrada
  setTimeout(() => toast.classList.add('show'), 100);

  // Remove automaticamente após 7 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 7000);
  
  // Permite arrastar para cima / clicar para fechar antes do tempo
  toast.addEventListener('click', () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  });
}