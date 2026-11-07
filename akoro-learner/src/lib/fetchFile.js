/**
 * fetchFile.js — the stored-file read, with the same radio-blip tolerance
 * the extraction run itself has — and, when it still fails, a diagnosis.
 *
 * Downloading the file (presigned GET) is the FIRST network call of any
 * extraction. When it fails persistently the cause is almost always one
 * of two, and they need opposite fixes:
 *   - CORS: the object store refuses the app's domain. The file renders
 *     fine in <img> viewers (no CORS there) but a readable fetch() is
 *     blocked — instantly, every time. Fix: a GET rule in the store's
 *     CORS config for the learner domain.
 *   - The store is genuinely unreachable from the network.
 * A no-cors probe tells them apart: if an opaque request succeeds while
 * the readable one is refused, it is CORS. The error message says which.
 */
export const FETCH_FILE_TRIES = 4;

/** Reachable-but-blocked check: an opaque (no-cors) response means the
 *  server answered, so the readable fetch's failure is a CORS refusal. */
async function probeOpaque(url) {
  try {
    const p = await fetch(url, { mode: "no-cors", cache: "no-store" });
    return !!p && p.type === "opaque";
  } catch {
    return false;
  }
}

export async function fetchFileWithRetry(url, {
  tries = FETCH_FILE_TRIES,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let lastErr = null;
  let lastRes = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      lastErr = e;
      if (attempt < tries) { await sleep(1500 * attempt); continue; }
      break;
    }
    if (res.ok) return res;
    lastRes = res;
    const transient = res.status >= 500 || res.status === 429;
    if (!transient) return res;              // a real answer (404, 403, expired)
    lastErr = lastErr || new Error(`HTTP ${res.status}`);
    if (attempt < tries) await sleep(1500 * attempt);
  }
  if (lastRes && !lastRes.ok) return lastRes;   // give the caller the status
  // The network layer refused every attempt — name the two possible worlds.
  if (lastErr?.name === "TypeError") {
    const blocked = await probeOpaque(url);
    lastErr.message = blocked
      ? "The file store is blocking the app (CORS). The file is fine — extraction reads need a GET rule for this domain in the store's CORS settings."
      : "The file store could not be reached from this device.";
    try { lastErr.corsBlocked = blocked; } catch { /* frozen error obj */ }
  }
  throw lastErr;
}
