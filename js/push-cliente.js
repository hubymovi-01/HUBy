// js/push-client.js - Registro Automático de Web Push Notifications (PWA HUBy)
import { API_URL } from './config.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registrarPushDispositivo() {
  try {
    const token = localStorage.getItem('huby_token');
    if (!token) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;

    let permissao = Notification.permission;
    if (permissao === 'default') {
      permissao = await Notification.requestPermission();
    }
    if (permissao !== 'granted') return;

    const respKey = await fetch(`${API_URL}/api/push/vapid-public-key`);
    if (!respKey.ok) return;
    const { publicKey } = await respKey.json();
    if (!publicKey) return;

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await fetch(`${API_URL}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ subscription })
    });
  } catch (err) {
    console.warn('Aviso ao registrar Push no aparelho:', err.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  registrarPushDispositivo();
});