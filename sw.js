const CACHE_NAME = 'huby-v5-bypass-api';

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

  // 🛑 REGRA DE OURO: Se a chamada vai para o Render ou para a /api/, o Service Worker ignora!
  // Isto resolve o erro de CORS instantaneamente.
  if (url.hostname.includes('onrender.com') || url.pathname.includes('/api/')) {
    return; // Deixa o navegador fazer a requisição natural sem interferências
  }

  // Para HTML, CSS e imagens locais, vai buscar sempre à rede para evitar cache encravada
  e.respondWith(
    fetch(e.request).catch((err) => {
      console.warn('Erro de rede no SW:', err);
      throw err;
    })
  );
});