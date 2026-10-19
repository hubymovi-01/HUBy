// ./service-worker.js
const CACHE_NAME = 'huby-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Responde com a rede ou fallback para o cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});