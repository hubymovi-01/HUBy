// sw.js - Service Worker HUBy (Cache Bypass + Push Notifications)
const CACHE_NAME = 'huby-v7-bypass-network';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 1. Ignora chamadas para APIs, Render ou conexões de WebSocket/Socket.IO
  if (
    url.hostname.includes('onrender.com') ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/socket.io/')
  ) {
    return;
  }

  // 2. Encaminha nativamente para a rede sem propagar exceção corrompida
  e.respondWith(
    fetch(e.request).catch((err) => {
      console.warn('Falha de rede ao buscar recurso:', e.request.url, err);
      // Retorna uma resposta vazia de erro padrão em vez de corromper o pipeline
      return new Response('Falha de conexão', { status: 503, statusText: 'Service Unavailable' });
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