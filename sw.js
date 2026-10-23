/**
 * HUBy Service Worker - VERSÃO DE LIMPEZA PROFUNDA (KILL SWITCH)
 * Este script obriga o telemóvel a apagar a cache antiga e a transferir o GPS corrigido.
 */

const CACHE_NAME = 'huby-v4-limpeza-total-gps';

self.addEventListener('install', (e) => {
  // Força a atualização imediata do Service Worker no telemóvel
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Destrói TODOS os caches antigos assim que a página é aberta
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          console.log('A apagar cache antigo:', k);
          return caches.delete(k);
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Ignora completamente o cache do Service Worker e vai sempre buscar à rede (Internet)
  // Isto garante que o telemóvel transfere a versão real do mapa.js
  e.respondWith(
    fetch(e.request).catch((err) => {
      console.warn('Erro de rede no SW:', err);
      throw err;
    })
  );
});