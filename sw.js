// sw.js - Service Worker HUBy (Blindagem Anti-Cache + Push Notifications)
const CACHE_NAME = 'huby-v9-network-first-live';

// 1. INSTALAÇÃO: Força o novo Service Worker a assumir o controlo de imediato
self.addEventListener('install', () => {
  self.skipWaiting();
});

// 2. ATIVAÇÃO: Elimina qualquer cache antigo/residual e toma o controlo dos clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. INTERCEPTAÇÃO DE REQUISIÇÕES (NETWORK-FIRST COM BYPASS DE CACHE)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. Ignora chamadas para APIs, WebSockets e serviços externos dinâmicos
  if (
    url.hostname.includes('onrender.com') ||
    url.hostname.includes('openstreetmap.org') ||
    url.pathname.includes('/api/') ||
    url.pathname.includes('/socket.io/')
  ) {
    return;
  }

  // B. Para requisições do próprio app (HTML, CSS, JS, Imagens): Força sempre rede limpa
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch((err) => {
      console.warn('⚠️ [SW HUBy] Falha de rede ao buscar:', event.request.url);

      if (event.request.mode === 'navigate') {
        return new Response(
          `<!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>HUBy • Sem Conexão</title>
            <style>
              body { background: #090D16; color: #FFF; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; box-sizing: border-box; }
              .card { background: #121826; border: 1px solid rgba(255,255,255,0.1); padding: 30px 20px; border-radius: 16px; max-width: 360px; }
              h2 { margin: 0 0 10px; color: #38BDF8; font-size: 20px; }
              p { color: #94A3B8; font-size: 13px; line-height: 1.5; margin: 0 0 20px; }
              button { background: #10B981; border: none; color: #02261C; font-weight: 800; padding: 12px 24px; border-radius: 10px; font-size: 14px; cursor: pointer; }
            </style>
          </head>
          <body>
            <div class="card">
              <span style="font-size: 40px; display: block; margin-bottom: 12px;">📡</span>
              <h2>Sem Ligação à Rede</h2>
              <p>Verifique o seu sinal móvel ou Wi-Fi para continuar a usar o HUBy.</p>
              <button onclick="window.location.reload()">Tentar Novamente</button>
            </div>
          </body>
          </html>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }

      return new Response('Recurso temporariamente indisponível.', { status: 503, statusText: 'Service Unavailable' });
    })
  );
});

// ============================================================================
// 4. NOTIFICAÇÕES EM SEGUNDO PLANO E PUSH
// ============================================================================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlDestino = event.notification.data?.url || './motorista.html';
  const alvoArquivo = urlDestino.includes('index.html')
    ? 'index.html'
    : (urlDestino.includes('admin.html') ? 'admin.html' : 'motorista.html');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(alvoArquivo) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlDestino);
      }
    })
  );
});

self.addEventListener('push', (event) => {
  let dados = {
    titulo: '🚘 HUBy: Nova corrida disponível!',
    corpo: 'Há uma nova chamada aguardando você. Toque para visualizar.',
    url: './motorista.html'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      dados = {
        titulo: payload.titulo || payload.title || dados.titulo,
        corpo: payload.corpo || payload.body || dados.corpo,
        url: payload.url || dados.url
      };
    } catch (e) {
      dados.corpo = event.data.text() || dados.corpo;
    }
  }

  const opcoes = {
    body: dados.corpo,
    icon: './img/icon-192.png',
    badge: './img/icon-192.png',
    vibrate: [300, 150, 300, 150, 300],
    tag: 'huby-notificacao',
    renotify: true,
    data: { url: dados.url }
  };

  event.waitUntil(self.registration.showNotification(dados.titulo, opcoes));
});