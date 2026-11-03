/* sw-repair.js — imported into the generated Workbox service worker (see
 * vite.config.js workbox.importScripts). Runs when a new version activates.
 *
 * Before 2026-11 a missing lazy chunk was answered with index.html (Vercel SPA
 * rewrite, 200 text/html) and the runtime asset cache stored it under the .js
 * URL — that feature then failed on every open until the learner cleared site
 * data. This removes any such poisoned entry (and any non-200) from the
 * runtime caches so devices that were already broken heal on update.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      for (const name of ['akoro-assets', 'akoro-html']) {
        if (!(await caches.has(name))) continue;
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          const isAsset = /\.(?:js|css)$/.test(new URL(req.url).pathname);
          const type = (res && res.headers.get('content-type')) || '';
          const bad = !res || (res.status !== 200 && res.type !== 'opaque')
            || (isAsset && !/javascript|css/i.test(type));
          if (bad) await cache.delete(req);
        }
      }
    } catch { /* best-effort — never block activation */ }
  })());
});
