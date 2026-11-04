/**
 * fetchFile.js — the stored-file read, with the same radio-blip tolerance
 * the extraction run itself has.
 *
 * Downloading the file (presigned GET) is the FIRST network call of any
 * extraction: it failed with a bare "Failed to fetch" on one dropped
 * connection, before the resilient run loop was ever reached — the one
 * fetch the original fix didn't wrap. Transient failures (dropped
 * connection, 5xx, 429) back off and retry; a real answer (404, 403,
 * expired signature) returns as-is so the caller can message it exactly.
 */
export const FETCH_FILE_TRIES = 4;

export async function fetchFileWithRetry(url, {
  tries = FETCH_FILE_TRIES,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      if (attempt >= tries) throw e;   // the network is really gone
      await sleep(1500 * attempt);     // a blip — back off and try again
      continue;
    }
    if (res.ok) return res;
    const transient = res.status >= 500 || res.status === 429;
    if (!transient || attempt >= tries) return res;
    await sleep(1500 * attempt);
  }
}
