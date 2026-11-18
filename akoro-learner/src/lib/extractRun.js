/**
 * extractRun.js — the reader's extraction run, as plain logic (no pdf.js, no
 * fetch): the API calls come in as `submit` / `poll`, so the contract test
 * drives every branch with fakes. components/library/extractPages.js binds
 * it to the real API as runRecordExtraction.
 */
/**
 * runExtraction — batch → submit → poll → merge. Each batch (up to
 * EXTRACT_BATCH_PAGES pages, size-capped) is SUBMITTED (the API answers at
 * once) and then polled until every page is settled; the API releases the
 * file's claim then, so the next batch can go.
 * No GPU work rides an open request, so a slow worker can't trip a proxy.
 *
 * Resolves with { pages: [{pageNumber, markdown, blocks}], failed:
 * [{pageNumber, error}], error } — pages saved before a failure are kept
 * (they're already cached server-side). `contentKey` selects the shared
 * file's cache (discovered records) instead of the owner's record.
 * `isCancelled()` stops polling when the reader closes.
 */
export const EXTRACT_BATCH_PAGES = 16;
export const EXTRACT_BATCH_MAX_B64_CHARS = 14 * 1024 * 1024;   // one POST stays well under the API's 25 MB JSON cap

/** Greedy batches: at most EXTRACT_BATCH_PAGES pages and at most
 *  EXTRACT_BATCH_MAX_B64_CHARS of base64 per batch (a batch always holds
 *  at least one page, however large). Bigger batches mean fewer serial
 *  claim rounds per document — the claim allows one live batch per file,
 *  so rounds, not pages, are what a long document pays for. */
export function extractionBatches(pages) {
  const batches = [];
  let cur = [], chars = 0;
  for (const p of pages || []) {
    const c = typeof p?.imageBase64 === 'string' ? p.imageBase64.length : 0;
    if (cur.length && (cur.length >= EXTRACT_BATCH_PAGES || chars + c > EXTRACT_BATCH_MAX_B64_CHARS)) {
      batches.push(cur); cur = []; chars = 0;
    }
    cur.push(p); chars += c;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

export const EXTRACT_POLL_MS = 3000;
export const EXTRACT_BATCH_DEADLINE_MS = 12 * 60_000;   // the API fails a page after 10 min
// A 429 is "slow down", not "failed": the work is still running server-side.
// Back off and carry on — this is exactly what surfaced as "Extraction didn't
// finish — That's a lot at once" while the GPU was still parsing the pages.
export const EXTRACT_RATE_LIMIT_BACKOFF_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 8;
// A dropped connection ("Failed to fetch" — no HTTP status at all) is the
// mobile case, not the failure case: the batch keeps running server-side
// and every finished page is already cached. Ride out short outages on the
// long poll (and the big image upload) instead of failing a 10-minute run
// on one radio blip. Sustained outages still end the run with an error.
export const EXTRACT_NETWORK_RETRIES = 6;
export const EXTRACT_NETWORK_BACKOFF_MS = 5_000;
const isTransient = (e) => e && !e.status;   // fetch threw before any HTTP answer

export async function runExtraction({
  submit, poll,
  recordId, contentKey = null, pages, onProgress, isCancelled = () => false,
  pollMs = EXTRACT_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  readSaved = null,
} = {}) {
  const target = { recordId, contentKey };
  const byPage = new Map();          // pageNumber → { pageNumber, markdown, blocks }
  const failedByPage = new Map();    // pageNumber → { pageNumber, error }
  const wanted = new Set(pages.map((p) => p.pageNumber));
  const progress = () => onProgress?.(
    Math.min(pages.length, [...wanted].filter((n) => byPage.has(n) || failedByPage.has(n)).length), pages.length);
  const STOPPED = Symbol('stopped');
  let limited = 0;       // 429s absorbed so far across this run
  let flaky = 0;         // consecutive dropped polls, reset by a good one
  let submitFlaky = 0;   // dropped submits across this run

  // Poll the file's running batch until it settles. Returns STOPPED, an
  // error string, or null when done.
  const pollUntilDone = async () => {
    const deadline = now() + EXTRACT_BATCH_DEADLINE_MS;
    for (;;) {
      if (isCancelled()) return STOPPED;
      await sleep(pollMs);
      if (isCancelled()) return STOPPED;
      let st;
      try { st = await poll(target); }
      catch (e) {
        if (e?.status === 429 && ++limited <= MAX_RATE_LIMIT_RETRIES) {
          await sleep(EXTRACT_RATE_LIMIT_BACKOFF_MS);
          continue;
        }
        if (isTransient(e) && ++flaky <= EXTRACT_NETWORK_RETRIES) {
          await sleep(EXTRACT_NETWORK_BACKOFF_MS);
          continue;
        }
        throw e;
      }
      flaky = 0;
      for (const p of st?.pages || []) { byPage.set(p.pageNumber, p); failedByPage.delete(p.pageNumber); }
      for (const f of st?.failed || []) if (!byPage.has(f.pageNumber)) failedByPage.set(f.pageNumber, f);
      progress();
      if (st?.done) return null;
      if (now() > deadline) return 'The parse worker is taking too long — try again in a few minutes.';
    }
  };

  let error = null;
  for (const batch of extractionBatches(pages)) {
    if (error) break;
    try {
      // Submit; a 409 means another opener's batch holds the file — help
      // finish it, then submit ours (twice at most).
      let submitted = false;
      for (let attempt = 0; attempt < 2 && !submitted; attempt += 1) {
        try {
          const sub = await submit({ ...target, pages: batch });
          for (const f of sub?.failed || []) failedByPage.set(f.pageNumber, f);
          submitted = true;
        } catch (e) {
          if (e?.status === 429 && ++limited <= MAX_RATE_LIMIT_RETRIES) {
            await sleep(EXTRACT_RATE_LIMIT_BACKOFF_MS);
            attempt -= 1;          // a rate limit isn't one of the two 409 tries
            continue;
          }
          if (isTransient(e) && ++submitFlaky <= EXTRACT_NETWORK_RETRIES) {
            await sleep(EXTRACT_NETWORK_BACKOFF_MS);
            attempt -= 1;          // a dropped upload isn't one of the two 409 tries
            continue;
          }
          if (e?.status !== 409) throw e;
        }
        const r = await pollUntilDone();
        if (r === STOPPED) return { pages: [...byPage.values()], failed: [...failedByPage.values()], error: 'Stopped.' };
        if (r) { error = r; break; }
      }
      // A 409 run that still collected every page it wanted (another opener's
      // batch settled while we polled) is a success — the busy note is only
      // an error when pages are genuinely still missing.
      if (!submitted && !error
          && batch.some((p) => !byPage.has(p.pageNumber) && !failedByPage.has(p.pageNumber))) {
        error = 'This file is busy being extracted by someone else — try again shortly.';
      }
    } catch (e) {
      error = e?.message || 'Extraction failed — try again in a moment.';
    }
  }

  // Pages another opener's poll saved never reached ours: fill them from the
  // file's saved extraction (the source of truth), for the pages we wanted.
  if (readSaved && [...wanted].some((n) => !byPage.has(n))) {
    try {
      const saved = await readSaved();
      for (const p of saved?.pages || []) {
        if (wanted.has(p.pageNumber) && !byPage.has(p.pageNumber)) { byPage.set(p.pageNumber, p); failedByPage.delete(p.pageNumber); }
      }
    } catch { /* keep what we collected */ }
  }

  const failed = [...failedByPage.values()].filter((f) => !byPage.has(f.pageNumber));
  if (!error && failed.length) {
    error = failed.length === 1
      ? `Page ${failed[0].pageNumber} could not be read: ${failed[0].error}`
      : `${failed.length} pages could not be read (pages ${failed.map((f) => f.pageNumber).join(', ')}).`;
  }
  const out = [...byPage.values()].filter((p) => wanted.has(p.pageNumber)).sort((a, b) => a.pageNumber - b.pageNumber);
  return { pages: out, failed, error };
}
