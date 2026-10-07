/* push-sw.js — Web Push handlers, imported into the generated Workbox service
 * worker via vite-plugin-pwa's workbox.importScripts. Runs in the SW context.
 *
 * Backend payload shape (see modules/notifications/webpush.js):
 *   { title, body, link, tag, type }
 */

let badgeCount = 0;   // pushes that arrived while no window was showing the app

const clearBadge = async () => {
  badgeCount = 0;
  try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch { /* unsupported */ }
};

const dismissOneBadge = async () => {
  badgeCount = Math.max(0, badgeCount - 1);
  try {
    if (!navigator.setAppBadge) return;
    if (badgeCount > 0) await navigator.setAppBadge(badgeCount);
    else if (navigator.clearAppBadge) await navigator.clearAppBadge();
  } catch { /* unsupported */ }
};

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
    vibrate:  [100, 50, 100],
    data:     { link: data.link || '/notifications' },
    actions:  [
      { action: 'view',    title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Badge the app icon while no window is showing the app, so a quiet push
    // is still visible on the home screen / taskbar. Cleared when opened.
    try {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const anyVisible = wins.some((w) => w.visibilityState === 'visible');
      if (!anyVisible && navigator.setAppBadge) {
        badgeCount += 1;
        await navigator.setAppBadge(badgeCount);
      }
    } catch { /* badge API unsupported — the toast alone is fine */ }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // "Dismiss" only closes the toast (and gives one badge back); anything
  // else — "View" or a body tap — opens the target.
  if (event.action === 'dismiss') { event.waitUntil(dismissOneBadge()); return; }
  const link = (event.notification.data && event.notification.data.link) || '/notifications';
  event.waitUntil((async () => {
    await clearBadge();
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
