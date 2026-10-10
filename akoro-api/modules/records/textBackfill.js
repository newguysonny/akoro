/**
 * modules/records/textBackfill.js — bring the shelf that existed BEFORE
 * upload-time extraction up to date, for free.
 *
 *   1. Uploads whose text the server can read itself (PDFs with a text
 *      layer, .txt / .md / .csv, Word, PowerPoint) and that have no saved
 *      extraction yet → read, save, index (storedText.js).
 *   2. Pasted notes with no search chunks yet → indexed.
 *
 * Scanned PDFs, images and recordings are NOT touched: they cost GPU /
 * transcription money and stay on the reader's tap-to-extract offer.
 *
 * Idempotent and cheap to re-run: a file with saved pages, a live claim,
 * or an earlier server-text verdict (read, scanned or failed) is skipped,
 * so later passes only see what's new. Indexing is unmetered (bill:false)
 * — the owners didn't ask for this work. Runs as the "record text
 * backfill" startup job and as `npm run records:backfill-text`.
 */
import { storedTextKindOf, extractStoredText } from "./storedText.js";

const PAGE = 200;            // records per query
const KEYS_PER_CHECK = 100;  // file keys per "already done?" lookup

const dbLazy = async () => (await import("../../db.js")).default;

/** Which of these keys still need server text → Set(key). Pure over the rows. */
export function keysNeedingText(keys, parsedKeys, jobs) {
  const parsed = new Set(parsedKeys);
  const jobBy = new Map((jobs || []).map((j) => [j.content_key, j]));
  const out = new Set();
  for (const k of keys) {
    if (parsed.has(k)) continue;
    const job = jobBy.get(k);
    if (job?.status === "running") continue;                                   // someone is on it
    if (job && ["text", "office"].includes(job.result?.mode)) continue;        // already judged by the server
    out.add(k);
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * One full pass. deps (all optional, for the test): db, extract, presign,
 * indexRecord, log. → counts { files: {done, scanned, failed, running, already}, pastes }.
 */
export async function backfillRecordText({ concurrency = 2, limit = Infinity } = {}, deps = {}) {
  const db = deps.db || await dbLazy();
  const extract = deps.extract || extractStoredText;
  const presign = deps.presign || (await import("./lib/storage.js")).createPresignedDownload;
  const indexRecord = deps.indexRecord || (await import("./searchLib.js")).indexRecord;
  const log = deps.log || ((...a) => console.log("[records/text-backfill]", ...a));
  const edu = () => db.schema("edu");
  const counts = { files: { done: 0, scanned: 0, failed: 0, running: 0, already: 0 }, pastes: 0 };

  // 1. Uploads the server can read, oldest first; one job per file key
  //    (a shared key belongs to its earliest record, as everywhere else).
  const seen = new Set();
  let handled = 0;
  for (let from = 0; handled < limit; from += PAGE) {
    const { data: rows, error } = await edu().from("records")
      .select("id, user_id, name, mime, file_key").eq("kind", "upload").not("file_key", "is", null)
      .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows?.length) break;
    const candidates = [];
    for (const r of rows) {
      if (!storedTextKindOf(r.mime, r.name) || seen.has(r.file_key)) continue;
      seen.add(r.file_key);
      candidates.push(r);
    }
    for (let i = 0; i < candidates.length && handled < limit; i += KEYS_PER_CHECK) {
      const slice = candidates.slice(i, i + KEYS_PER_CHECK);
      const keys = slice.map((r) => r.file_key);
      const [{ data: parsed }, { data: jobs }] = await Promise.all([
        edu().from("content_parses").select("content_key").in("content_key", keys),
        edu().from("content_jobs").select("content_key, status, result").eq("lane", "parse").in("content_key", keys),
      ]);
      const need = keysNeedingText(keys, (parsed || []).map((p) => p.content_key), jobs);
      const todo = slice.filter((r) => need.has(r.file_key)).slice(0, limit - handled);
      counts.files.already += slice.length - todo.length;
      handled += todo.length;
      await mapLimit(todo, concurrency, async (r) => {
        try {
          const fileUrl = await presign(r.file_key, { downloadName: r.name });
          const out = await extract({ userId: r.user_id, contentKey: r.file_key, name: r.name, mime: r.mime, fileUrl, rememberScanned: true, bill: false });
          counts.files[out.status] = (counts.files[out.status] || 0) + 1;
        } catch (e) {
          counts.files.failed += 1;
          log(`file ${r.id} failed:`, String(e?.message || e).slice(0, 160));
        }
      });
    }
    if (rows.length < PAGE) break;
  }

  // 2. Pastes with no paste chunks yet.
  for (let from = 0; ; from += PAGE) {
    const { data: rows, error } = await edu().from("records")
      .select("id, user_id, name, content").eq("kind", "paste")
      .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows?.length) break;
    const { data: chunks } = await edu().from("record_chunks").select("record_id")
      .eq("kind", "paste").in("record_id", rows.map((r) => r.id));
    const indexed = new Set((chunks || []).map((c) => c.record_id));
    const todo = rows.filter((r) => !indexed.has(r.id) && String(r.content || "").trim());
    await mapLimit(todo, concurrency, async (r) => {
      await indexRecord({ userId: r.user_id, recordId: r.id, name: r.name, pasteText: r.content, bill: false });
      counts.pastes += 1;
    });
    if (rows.length < PAGE) break;
  }

  log(`files: ${JSON.stringify(counts.files)} · pastes indexed: ${counts.pastes}`);
  return counts;
}
