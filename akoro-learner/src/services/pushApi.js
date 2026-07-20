/**
 * pushApi.js — Web Push subscription flow for the learner PWA.
 *
 * Ties together: Notification permission → PushManager subscription (using the
 * server's VAPID public key) → save on the backend. The service worker
 * (public/push-sw.js, imported into the Workbox SW) renders the pushes.
 */
import { apiGet, apiPost } from './api.js';

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

// VAPID public key (base64url) → Uint8Array for applicationServerKey.
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function getPushStatus() {
  if (!pushSupported()) return { supported: false, subscribed: false, permission: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return { supported: true, subscribed: !!sub, permission: Notification.permission };
  } catch {
    return { supported: true, subscribed: false, permission: Notification.permission };
  }
}

/** Request permission, subscribe, and persist on the backend. Returns true on success. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported on this device.');

  const { enabled, public_key } = await apiGet('/api/notifications/push/public-key').then((r) => r.data ?? r);
  if (!enabled || !public_key) throw new Error('Push notifications are not configured yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
  }

  await apiPost('/api/notifications/push/subscribe', { subscription: sub.toJSON() });
  return true;
}

/** Unsubscribe this device and tell the backend to drop it. */
export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiPost('/api/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* best-effort */ }
}
