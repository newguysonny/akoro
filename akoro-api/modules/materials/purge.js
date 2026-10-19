/**
 * modules/materials/purge.js — Recently deleted ends after 30 days (Grand
 * Plan §7.17, D51): an upload the learner undid is deleted for good — its
 * records (their search chunks and past-paper questions go with them), the
 * stored files, and the ingest is marked purged so Restore says so.
 *
 *   purgeDeleted({ limit })  one pass → { records, files, ingests }
 *   startMaterialsPurge()    a pass soon after boot, then every 6 hours
 */
import db from "../../db.js";
import { removeRecordFile } from "../records/lib/storage.js";
import { RESTORE_DAYS } from "./ingestCore.js";
import { workerTick } from "../../lib/workerLog.js";

const edu = () => db.schema("edu");

export async function purgeDeleted({ limit = 200, now = Date.now() } = {}) {
  const cutoff = new Date(now - RESTORE_DAYS * 86_400_000).toISOString();
  const { data: recs, error } = await edu().from("records").select("id, user_id, file_key")
    .not("deleted_at", "is", null).lt("deleted_at", cutoff).limit(limit);
  if (error) throw error;
  let files = 0;
  if (recs?.length) {
    await edu().from("records").delete().in("id", recs.map((r) => r.id));
    for (const r of recs) if (r.file_key) { void removeRecordFile(r.file_key); files += 1; }
  }
  // The uploads whose 30 days are up: their questions go, and Restore answers "deleted for good".
  const { data: rows } = await edu().from("material_ingests").select("id, user_id, filing")
    .eq("state", "undone").lt("updated_at", cutoff).limit(limit);
  let ingests = 0;
  for (const row of rows || []) {
    const f = row.filing || {};
    if (f.purged || !f.deletedAt || new Date(f.deletedAt).toISOString() >= cutoff) continue;
    await edu().from("material_questions").delete().eq("user_id", row.user_id).eq("ingest_id", row.id);
    await edu().from("material_ingests").update({ filing: { ...f, purged: true, trash: null } }).eq("id", row.id);
    ingests += 1;
  }
  return { records: recs?.length || 0, files, ingests };
}

let timer = null;
export function startMaterialsPurge() {
  if (timer) return;
  const run = (reason) => {
    const start = Date.now();
    purgeDeleted()
      .then((r) => workerTick("materials-purge", { reason, jobsFound: r.records + r.ingests, jobsProcessed: r.records + r.ingests, durationMs: Date.now() - start }))
      .catch((e) => console.warn("[materials-purge] failed:", String(e?.message || e).slice(0, 160)));
  };
  setTimeout(() => run("boot"), 10 * 60_000).unref?.();
  timer = setInterval(() => run("interval"), 6 * 3_600_000);
  timer.unref?.();
}
