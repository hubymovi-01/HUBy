// js/monitor-erros.js - Captura Silenciosa de Falhas no Navegador/PWA
import { API_URL } from './config.js';

function enviarLogErro(mensagem, stack = '') {
  try {
    fetch(`${API_URL}/api/admin/logs-erro`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origem: 'frontend_pwa',
        rota: window.location.pathname,
        mensagem: String(mensagem).slice(0, 450),
        stack: String(stack).slice(0, 1800)
      })
    }).catch(() => {});
  } catch (e) {}
}

window.addEventListener('error', (event) => {
  if (event?.message) {
    enviarLogErro(event.message, `${event.filename}:${event.lineno}:${event.colno}`);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const motivo = event?.reason?.message || String(event?.reason || 'Promise rejeitada');
  const pilha = event?.reason?.stack || '';
  enviarLogErro(motivo, pilha);
});