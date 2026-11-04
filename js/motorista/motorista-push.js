// js/motorista/motorista-push.js - Alertas sonoros e Push em segundo plano
export function inicializarPushNotifications() {
  if (!('Notification' in window)) {
    console.warn('Este navegador não suporta notificações de sistema.');
    return;
  }

  // Pede autorização ao condutor se ainda estiver pendente
  if (Notification.permission === 'default') {
    // Aguarda 3 segundos após abrir para não ser invasivo
    setTimeout(() => {
      Notification.requestPermission().then(permissao => {
        if (permissao === 'granted') {
          console.log('✅ Notificações HUBy autorizadas pelo condutor.');
        }
      }).catch(() => {});
    }, 3000);
  }
}

export function dispararNotificacaoChamada(pedido) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const valorFormatado = Number(pedido.valorTotal || 0).toFixed(2).replace('.', ',');
  const titulo = `🚖 Nova Chamada HUBy: R$ ${valorFormatado}`;
  
  const opcoes = {
    body: `Origem: ${pedido.origem || 'Embarque próximo'}\nDestino: ${pedido.destino || 'Destino do passageiro'}`,
    icon: './assets/icons/icon-192.png',
    badge: './assets/icons/icon-192.png',
    vibrate: [300, 150, 300, 150, 450],
    tag: `huby_pedido_${pedido.id || Date.now()}`,
    renotify: true,
    requireInteraction: true // Mantém o alerta no ecrã até o motorista interagir
  };

  // Delegar preferencialmente ao Service Worker (funciona em segundo plano e ecrã bloqueado)
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(titulo, opcoes);
    }).catch(() => {
      new Notification(titulo, opcoes);
    });
  } else {
    new Notification(titulo, opcoes);
  }
}