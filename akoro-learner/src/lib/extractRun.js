/**
 * extractRun.js — the reader's extraction run, as plain logic (no pdf.js, no
 * fetch): the API calls come in as `submit` / `poll`, so the contract test
 * drives every branch with fakes. components/library/extractPages.js binds
 * it to the real API as runRecordExtraction.
 */
/**
 * runExtraction — batch → submit → poll → merge. Each ≤8-page batch is
 * SUBMITTED (the API answers at once) and then polled until every page is
 * settled; the API releases the file's claim then, so the next batch can go.
 * No GPU work rides an open request, so a slow worker can't trip a proxy.
 *
 * Resolves with { pages: [{pageNumber, markdown, blocks}], failed:
 * [{pageNumber, error}], error } — pages saved before a failure are kept
 * (they're already cached server-side). `contentKey` selects the shared
 * file's cache (discovered records) instead of the owner's record.
 * `isCancelled()` stops polling when the reader closes.
 */
export const EXTRACT_POLL_MS = 3000;
export const EXTRACT_BATCH_DEADLINE_MS = 12 * 60_000;   // the API fails a page after 10 min

export async function runExtraction({
  submit, poll,
  recordId, contentKey = null, pages, onProgress, isCancelled = () => false,
  pollMs = EXTRACT_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now,
  readSaved = null,
} = {}) {
  const BATCH = 8;
  const target = { recordId, contentKey };
  const byPage = new Map();          // pageNumber → { pageNumber, markdown, blocks }
  const failedByPage = new Map();    // pageNumber → { pageNumber, error }
  const wanted = new Set(pages.map((p) => p.pageNumber));
  const progress = () => onProgress?.(
    Math.min(pages.length, [...wanted].filter((n) => byPage.has(n) || failedByPage.has(n)).length), pages.length);
  const STOPPED = Symbol('stopped');

  // Poll the file's running batch until it settles. Returns STOPPED, an
  // error string, or null when done.
  const pollUntilDone = async () => {
    const deadline = now() + EXTRACT_BATCH_DEADLINE_MS;
    for (;;) {
      if (isCancelled()) return STOPPED;
      await sleep(pollMs);
      if (isCancelled()) return STOPPED;
      const st = await poll(target);
      for (const p of st?.pages || []) { byPage.set(p.pageNumber, p); failedByPage.delete(p.pageNumber); }
      for (const f of st?.failed || []) if (!byPage.has(f.pageNumber)) failedByPage.set(f.pageNumber, f);
      progress();
      if (st?.done) return null;
      if (now() > deadline) return 'The parse worker is taking too long — try again in a few minutes.';
    }
  };

  let error = null;
  for (let i = 0; i < pages.length && !error; i += BATCH) {
    const batch = pages.slice(i, i + BATCH);
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
          if (e?.status !== 409) throw e;
        }
        const r = await pollUntilDone();
        if (r === STOPPED) return { pages: [...byPage.values()], failed: [...failedByPage.values()], error: 'Stopped.' };
        if (r) { error = r; break; }
      }
      if (!submitted && !error) error = 'This file is busy being extracted by someone else — try again shortly.';
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
