// js/push-cliente.js - Receptor de Notificações Push HUBy (Motorista e Passageiro)
import { API_URL } from './config.js';
import { estado } from './motorista/motorista-estado.js';

const ESTILO_ID = 'huby-push-toast-styles';

function injetarEstilosPush() {
  if (document.getElementById(ESTILO_ID)) return;

  const style = document.createElement('style');
  style.id = ESTILO_ID;
  style.textContent = `
    .huby-push-toast {
      position: fixed;
      top: -120px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100% - 28px);
      max-width: 420px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(56, 189, 248, 0.45);
      border-radius: 16px;
      padding: 14px 16px;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.75);
      z-index: 99999;
      transition: top 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      display: flex;
      gap: 12px;
      align-items: flex-start;
      cursor: pointer;
    }
    .huby-push-toast.show {
      top: calc(env(safe-area-inset-top, 12px) + 14px);
    }
    .huby-push-icon {
      font-size: 22px;
      background: rgba(56, 189, 248, 0.16);
      border: 1px solid rgba(56, 189, 248, 0.3);
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
      min-width: 0;
    }
    .huby-push-content h4 {
      margin: 0 0 4px 0;
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 800;
    }
    .huby-push-content p {
      margin: 0;
      color: #CBD5E1;
      font-size: 12px;
      line-height: 1.45;
      word-wrap: break-word;
    }
    .huby-push-tag {
      display: inline-block;
      margin-top: 6px;
      font-size: 10px;
      font-weight: 800;
      color: #10B981;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
  `;
  document.head.appendChild(style);
}

function resolverIcone(titulo = '') {
  const txt = String(titulo).toLowerCase();
  if (txt.includes('chuva') || txt.includes('tempo')) return '⛈️';
  if (txt.includes('bônus') || txt.includes('ganho') || txt.includes('pix')) return '💰';
  if (txt.includes('demanda') || txt.includes('calor') || txt.includes('dinâmica')) return '🔥';
  return '📢';
}

function mostrarToastPush(titulo, mensagem, regiao = 'todas') {
  injetarEstilosPush();

  document.querySelectorAll('.huby-push-toast').forEach((el) => el.remove());

  const toast = document.createElement('div');
  toast.className = 'huby-push-toast';

  const labelRegiao =
    regiao && regiao !== 'todas'
      ? `HUBy • ${String(regiao).replace(/_/g, ' ').toUpperCase()}`
      : 'HUBy • Central Operacional';

  toast.innerHTML = `
    <div class="huby-push-icon">${resolverIcone(titulo)}</div>
    <div class="huby-push-content">
      <h4>${escaparTexto(titulo)}</h4>
      <p>${escaparTexto(mensagem)}</p>
      <span class="huby-push-tag">${escaparTexto(labelRegiao)}</span>
    </div>
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    setTimeout(() => toast.classList.add('show'), 60);
  });

  const fechar = () => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 450);
  };

  toast.addEventListener('click', fechar);
  setTimeout(fechar, 8000);
}

function escaparTexto(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function obterSocketAtivo() {
  if (estado?.socket) return estado.socket;
  const token = localStorage.getItem('huby_token') || '';
  const ioClient = typeof io !== 'undefined' ? io : window.io;
  if (!ioClient) return null;
  return ioClient(API_URL, { auth: { token } });
}

let listenerRegistrado = false;

export function inicializarPushNotifications() {
  if (listenerRegistrado) return;

  const socket = obterSocketAtivo();
  if (!socket) return;

  listenerRegistrado = true;

  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  socket.on('nova_notificacao_push', (dados) => {
    if (!dados || !dados.titulo || !dados.mensagem) return;

    const roleAtual = String(localStorage.getItem('huby_user_role') || '').toLowerCase();
    const publicoAlvo = String(dados.publico || 'todos').toLowerCase();

    if (publicoAlvo === 'motoristas' && roleAtual && roleAtual !== 'motorista' && roleAtual !== 'admin') {
      return;
    }
    if (publicoAlvo === 'passageiros' && roleAtual && roleAtual !== 'cliente' && roleAtual !== 'passageiro' && roleAtual !== 'admin') {
      return;
    }

    const regiaoMensagem = String(dados.regiao || 'todas').toLowerCase();
    const regiaoUsuario = String(localStorage.getItem('huby_regiao') || 'sao_joao_pi').toLowerCase();

    if (regiaoMensagem !== 'todas' && regiaoUsuario && regiaoMensagem !== regiaoUsuario) {
      return;
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(dados.titulo, {
          body: dados.mensagem,
          icon: './img/icon-192.png'
        });
      } catch (_) {}
    }

    mostrarToastPush(dados.titulo, dados.mensagem, regiaoMensagem);
  });
}

window.inicializarPushNotifications = inicializarPushNotifications;

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(inicializarPushNotifications, 600);
});