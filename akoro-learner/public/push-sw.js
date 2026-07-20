/* push-sw.js — Web Push handlers, imported into the generated Workbox service
 * worker via vite-plugin-pwa's workbox.importScripts. Runs in the SW context.
 *
 * Backend payload shape (see modules/notifications/webpush.js):
 *   { title, body, link, tag, type }
 */

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Akoro';
  const options = {
    body:     data.body || '',
    icon:     '/favicon-192.png',
    badge:    '/favicon-192.png',
    tag:      data.tag || 'akoro',
    renotify: true,
    data:     { link: data.link || '/notifications' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/notifications';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      // Focus an already-open tab and route it to the target.
      if ('focus' in c) {
        try { if ('navigate' in c) await c.navigate(link); } catch { /* cross-origin nav guard */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(link);
  })());
});
