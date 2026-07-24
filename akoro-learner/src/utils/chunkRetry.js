/**
 * chunkRetry — reload-once recovery for a failed dynamic import(), used by
 * lazyWithRetry. React-free so it can be unit-tested in isolation.
 *
 * A failed route-chunk fetch is almost always a stale chunk after a deploy
 * (hashed filenames change, old ones 404). A plain reload is NOT enough: the
 * service worker intercepts the navigation and re-serves the SAME cached old
 * index.html, which points at the same missing chunk — so the reload loops
 * straight back into the white screen. Before reloading we therefore force the
 * SW to give up the stale shell (activate a waiting worker, or unregister and
 * drop the app-shell/asset caches) so the reload fetches the fresh index.html
 * from the network. A sessionStorage guard prevents an infinite loop, and it's
 * cleared on any successful load so the next deploy can retry again.
 */
const KEY = 'akoro_chunk_reloaded';

// Force the browser off the stale, service-worker-cached app shell so the
// next navigation loads the freshly-deployed index.html (and its new chunks).
async function escapeStaleShell() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const regs = await navigator.serviceWorker.getRegistrations();

    // Fast path: a new SW is already downloaded and waiting — tell it to take
    // over immediately (the generated SW listens for SKIP_WAITING).
    let activated = false;
    for (const r of regs) {
      if (r.waiting) { r.waiting.postMessage({ type: 'SKIP_WAITING' }); activated = true; }
    }
    if (activated) return;

    // Otherwise unregister every SW and drop the precache + lazy-asset caches so
    // the reload can't be served the old shell from cache. Data caches
    // (akoro-catalog / akoro-api) are left intact.
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => /precache|workbox|akoro-assets/i.test(k)).map((k) => caches.delete(k).catch(() => {}))
      );
    }
  } catch { /* best-effort — reload anyway */ }
}

export async function retryImport(factory) {
  try {
    const mod = await factory();
    try { window.sessionStorage?.removeItem(KEY); } catch { /* private mode */ }
    return mod;
  } catch (err) {
    let retried = false;
    try { retried = window.sessionStorage?.getItem(KEY) === '1'; } catch { /* ignore */ }
    if (!retried) {
      try { window.sessionStorage?.setItem(KEY, '1'); } catch { /* ignore */ }
      // Escape the stale SW-cached shell, THEN reload — otherwise the reload is
      // served the same old index.html and hits the same missing chunk again.
      await escapeStaleShell();
      window.location.reload();
      // Hold the render until the reload takes effect so React never surfaces
      // the error to the user.
      return new Promise(() => {});
    }
    throw err;   // already retried — surface the real error
  }
}
