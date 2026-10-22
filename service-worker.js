// ./service-worker.js
const CACHE_NAME = 'huby-v3';

// Recursos essenciais para inicialização offline da interface estática
const ASSETS_ESTATICOS = [
  './',
  './index.html',
  './login.html',
  './cadastro-cliente.html',
  './cadastro-motorista.html',
  './motorista.html',
  './admin.html',
  './css/global.css',
  './css/cliente.css',
  './css/welcome.css',
  './css/login.css',
  './css/motorista.css',
  './css/admin.css',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_ESTATICOS).catch((err) => {
        console.warn('[HUBy SW] Falha não impeditiva ao pré-carregar assets estáticos:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Limpeza de caches obsoletos de versões antigas
  event.waitUntil(
    caches.keys().then((chaves) => {
      return Promise.all(
        chaves.map((chave) => {
          if (chave !== CACHE_NAME) {
            console.log('[HUBy SW] Removendo cache legado:', chave);
            return caches.delete(chave);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Ignorar métodos que não sejam GET (POST de login, cadastro, PATCH de status, etc.)
  if (req.method !== 'GET') {
    return;
  }

  // 2. Ignorar chamadas de API, endpoints de banco/Render e requisições externas de mapas dinâmicos
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('onrender.com') ||
    url.hostname.includes('project-osrm.org') ||
    url.hostname.includes('nominatim.openstreetmap.org')
  ) {
    return;
  }

  // 3. Estratégia Network First com fallback de Cache para arquivos estáticos locais
  event.respondWith(
    fetch(req)
      .then((respostaRede) => {
        // Se a resposta for válida e do mesmo domínio, atualiza a cópia de cache
        if (respostaRede && respostaRede.status === 200 && respostaRede.type === 'basic') {
          const respostaClone = respostaRede.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respostaClone));
        }
        return respostaRede;
      })
      .catch(() => {
        // Se a rede cair, serve a versão salva em cache se existir
        return caches.match(req).then((respostaCache) => {
          if (respostaCache) {
            return respostaCache;
          }
          // Fallback de página se o usuário navegar desconectado
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});