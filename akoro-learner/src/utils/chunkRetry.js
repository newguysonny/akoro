/**
 * chunkRetry — reload-once recovery for a failed dynamic import(), used by
 * lazyWithRetry. React-free so it can be unit-tested in isolation.
 *
 * A failed route-chunk fetch is almost always a stale chunk after a deploy
 * (hashed filenames change, old ones 404). We reload ONCE to pull the fresh
 * manifest; a sessionStorage guard prevents an infinite loop, and it's cleared
 * on any successful load so the next deploy can retry again.
 */
const KEY = 'akoro_chunk_reloaded';

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
      window.location.reload();
      // Hold the render until the reload takes effect so React never surfaces
      // the error to the user.
      return new Promise(() => {});
    }
    throw err;   // already retried — surface the real error
  }
}
