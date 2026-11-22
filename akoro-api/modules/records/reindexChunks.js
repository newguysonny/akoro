/**
 * modules/records/reindexChunks.js — re-chunk/re-embed rows written by an
 * older chunker (index_version < INDEX_VERSION).
 *
 * Mirrors the extraction backfill: a dry run counts, the run is a background
 * job polled from the admin console, and every indexing call is unmetered
 * (`bill: false`) because it is platform work.
 *
 * Batch by RECORD: indexRecord writes name/paste/page/transcript chunks in one
 * pass, and replaceRecordChunks keeps their per-kind delete/replace semantics.
 * A record with no remaining source pages/transcript cannot be re-chunked; its
 * stale rows are stamped with the current version (still searchable) so a
 * bounded scan can never loop on them forever.
 */
import { INDEX_VERSION, indexRecord } from "./searchLib.js";
import { getExtraction } from "./extractLib.js";
import { getTranscript } from "./avTranscribeLib.js";

const dbLazy = async () => (await import("../../db.js")).default;
const SCAN_ROWS = 2000;
const MAX_BATCH = 25;
const SETTINGS_PREFIX = "chunk_reindex:";
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

async function staleRecordIds({ rows = SCAN_ROWS } = {}) {
  const db = await dbLazy();
  const { data, error } = await db.schema("edu").from("record_chunks")
    .select("record_id").lt("index_version", INDEX_VERSION)
    .order("record_id", { ascending: true }).limit(rows);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((r) => r.record_id).filter(Boolean))];
}

async function staleCountFor(recordId) {
  const db = await dbLazy();
  const { count } = await db.schema("edu").from("record_chunks")
    .select("id", { count: "exact", head: true })
    .eq("record_id", recordId).lt("index_version", INDEX_VERSION);
  return count || 0;
}

/** Dry run: how many records/chunks are on an older chunker. */
export async function scanStaleChunks() {
  const db = await dbLazy();
  const [{ count: chunks }, ids] = await Promise.all([
    db.schema("edu").from("record_chunks").select("id", { count: "exact", head: true }).lt("index_version", INDEX_VERSION),
    staleRecordIds(),
  ]);
  return { indexVersion: INDEX_VERSION, chunks: chunks || 0, records: ids.length, sample: ids.slice(0, 10) };
}

async function saveJob(jobId, value) {
  const db = await dbLazy();
  const { error } = await db.schema("edu").from("platform_settings")
    .upsert({ key: SETTINGS_PREFIX + jobId, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Start a reindex job (off the request path). → { jobId, total }. */
export async function startChunkReindex({ limit = 10 } = {}) {
  const requested = Number(limit);
  const batch = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_BATCH, Math.floor(requested)) : 10;
  const ids = (await staleRecordIds({ rows: Math.max(batch * 8, 200) })).slice(0, batch);

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = {
    id: jobId, status: "running", indexVersion: INDEX_VERSION,
    startedAt: new Date().toISOString(), total: ids.length, processed: 0, results: [],
  };
  await saveJob(jobId, job);

  void (async () => {
    const db = await dbLazy();
    for (const id of ids) {
      const t0 = Date.now();
      try {
        const { data: rec } = await db.schema("edu").from("records")
          .select("id, user_id, kind, name, content, file_key, created_at")
          .eq("id", id).maybeSingle();
        if (!rec) {
          job.results.push({ id, status: "missing-record", ms: Date.now() - t0 });
        } else {
          const [ext, tr] = rec.file_key
            ? await Promise.all([
                getExtraction(rec.file_key).catch(() => null),
                getTranscript(rec.file_key).catch(() => null),
              ])
            : [null, null];
          const pages = ext?.pages?.length ? ext.pages : null;
          const segments = tr?.segments?.length ? tr.segments : null;
          const pasteText = rec.kind === "paste" ? (rec.content || null) : null;
          if (!pages && !segments && !pasteText) {
            await stampStale(id);
            job.results.push({ id, name: rec.name, status: "stamped", note: "no source text left; kept searchable", ms: Date.now() - t0 });
          } else {
            await indexRecord({
              userId: rec.user_id, recordId: rec.id, name: rec.name, contentKey: rec.file_key,
              pasteText, pages, segments, bill: false,
              sourceType: pages ? "upload" : segments ? "transcript" : rec.kind,
              docAt: rec.created_at || null,
              extractVersion: pages?.[0]?.model || segments?.[0]?.model || null,
            });
            const left = await staleCountFor(id);
            if (left > 0) await stampStale(id);
            job.results.push({
              id, name: rec.name, status: "reindexed", ms: Date.now() - t0,
              chunks: pages?.length || null, stampedLeft: left || 0,
            });
          }
        }
      } catch (err) {
        job.results.push({ id, status: "failed", error: String(err?.message || err).slice(0, 300), ms: Date.now() - t0 });
      }
      job.processed += 1;
      await saveJob(jobId, job).catch(() => {});
    }
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    try { job.remaining = (await scanStaleChunks()).records; } catch { job.remaining = null; }
    await saveJob(jobId, job).catch(() => {});
  })().catch(async (err) => {
    job.status = "failed";
    job.error = String(err?.message || err).slice(0, 300);
    job.finishedAt = new Date().toISOString();
    await saveJob(jobId, job).catch(() => {});
  });

  return { jobId, total: ids.length };
}

async function stampStale(recordId) {
  const db = await dbLazy();
  await db.schema("edu").from("record_chunks")
    .update({ index_version: INDEX_VERSION })
    .eq("record_id", recordId).lt("index_version", INDEX_VERSION);
}

/** Read one job (admin polls this). */
export async function getChunkReindex(jobId) {
  const id = String(jobId || "");
  if (!/^[a-z0-9]{4,40}$/i.test(id)) return null;
  const db = await dbLazy();
  const { data } = await db.schema("edu").from("platform_settings")
    .select("value").eq("key", SETTINGS_PREFIX + id).maybeSingle();
  const job = data?.value || null;
  if (!job) return null;
  const age = Date.now() - Date.parse(job.startedAt || 0);
  if (job.status !== "running" && age > JOB_TTL_MS) return null;
  return job;
}

/**
 * Opt-in background sweep (RECORDS_REINDEX_SWEEP=on): a small bounded batch at
 * boot + every 6 hours. Off by default — re-embedding is a platform cost that
 * an operator should choose. The job row records each pass for the console.
 */
let sweepTimer = null;
export function startChunkReindexSweep() {
  if (sweepTimer) return sweepTimer;
  if (process.env.RECORDS_REINDEX_SWEEP !== "on") {
    console.log("[reindex] sweep off (set RECORDS_REINDEX_SWEEP=on to enable)");
    return null;
  }
  const run = async () => {
    try {
      const gap = await scanStaleChunks();
      if (!gap.records) return;
      const { jobId, total } = await startChunkReindex({ limit: 5 });
      console.log(`[reindex] sweep started ${jobId}: ${total} record(s)`);
    } catch (err) {
      console.warn("[reindex] sweep failed:", String(err?.message || err).slice(0, 160));
    }
  };
  setTimeout(() => { void run(); }, 10 * 60_000).unref?.();
  sweepTimer = setInterval(() => { void run(); }, 6 * 60 * 60_000);
  sweepTimer.unref?.();
  return sweepTimer;
}
