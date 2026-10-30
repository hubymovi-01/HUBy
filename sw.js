// sw.js - Service Worker HUBy (Cache Bypass + Push Notifications)
const CACHE_NAME = 'huby-v6-bypass-api';

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Força a atualização imediata
});

self.addEventListener('activate', (e) => {
  // Limpa qualquer cache antiga
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 🛑 REGRA DE OURO: Ignora chamadas para o Render ou rotas de API para evitar erro de CORS
  if (url.hostname.includes('onrender.com') || url.pathname.includes('/api/')) {
    return;
  }

  // Busca sempre na rede para evitar HTML/CSS desatualizado
  e.respondWith(
    fetch(e.request).catch((err) => {
      console.warn('Erro de rede no SW:', err);
      throw err;
    })
  );
});

// ============================================================================
// NOTIFICAÇÕES EM SEGUNDO PLANO / PUSH
// ============================================================================

// Foca a janela do motorista ou abre o app ao tocar na notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlDestino = event.notification.data?.url || './motorista.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes('motorista.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlDestino);
      }
    })
  );
});

// Trata eventos de push do navegador
self.addEventListener('push', (event) => {
  let dados = { 
    titulo: '🚘 HUBy: Nova corrida disponível!', 
    corpo: 'Há uma nova chamada aguardando você. Toque para visualizar.' 
  };

  if (event.data) {
    try {
      dados = event.data.json();
    } catch (e) {
      dados.corpo = event.data.text();
    }
  }

  const opcoes = {
    body: dados.corpo,
    icon: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=192&q=80',
    badge: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=192&q=80',
    vibrate: [300, 150, 300, 150, 300],
    tag: 'huby-nova-chamada',
    renotify: true,
    data: { url: './motorista.html' }
  };

  event.waitUntil(self.registration.showNotification(dados.titulo, opcoes));
});