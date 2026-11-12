/**
 * modules/pharmd/hashBackfill.js — version older catalogue topics.
 *
 * New uploads carry file_hash (SHA-256 of the PDF bytes), which makes the
 * shared extraction key versioned (pharmd:<path>#<hash>). Rows uploaded before
 * that column existed get hashed here, and any parse already cached under the
 * legacy path-only key is MOVED to the versioned key — so nothing has to be
 * re-extracted just because the key gained a suffix.
 *
 * Idempotent: rows that already have a hash are skipped. One topic per loop,
 * with progress through onLog; a failure is reported, never fatal.
 */
import { createHash } from "node:crypto";
import db from "../../db.js";

const edu = () => db.schema("edu");
const BUCKET = "pharmd-courses";

export const shortHash = (buffer) => createHash("sha256").update(buffer).digest("hex").slice(0, 32);

export function legacyPharmdKey(path) { return `pharmd:${path}`; }
export function versionedPharmdKey(path, hash) { return `pharmd:${path}${hash ? `#${hash}` : ""}`; }

export async function runPharmdHashBackfill({ limit = 500, course = null, onLog = () => {} } = {}) {
  let courseId = null;
  if (course) {
    const { data: row, error: cErr } = await edu().from("pharmd_courses")
      .select("id").ilike("code", String(course)).maybeSingle();
    if (cErr) throw cErr;
    if (!row) throw new Error(`Unknown course "${course}".`);
    courseId = row.id;
  }
  const q = edu().from("pharmd_topics")
    .select("id, title, position, file_bucket, file_path, file_hash")
    .not("file_path", "is", null)
    .order("position", { ascending: true })
    .limit(limit);
  if (courseId) q.eq("course_id", courseId);
  const { data: topics, error } = await q;
  if (error) throw error;

  const out = { checked: 0, hashed: 0, already: 0, migratedPages: 0, migratedJobs: 0, failed: [] };
  for (const topic of topics || []) {
    out.checked += 1;
    if (topic.file_hash) { out.already += 1; continue; }
    try {
      const { data: blob, error: dlErr } = await db.storage.from(topic.file_bucket || BUCKET).download(topic.file_path);
      if (dlErr) throw dlErr;
      const hash = shortHash(Buffer.from(await blob.arrayBuffer()));
      const { error: upErr } = await edu().from("pharmd_topics").update({ file_hash: hash }).eq("id", topic.id);
      if (upErr) throw upErr;
      out.hashed += 1;

      const oldKey = legacyPharmdKey(topic.file_path);
      const newKey = versionedPharmdKey(topic.file_path, hash);
      const { data: moved, error: mvErr } = await edu().from("content_parses")
        .update({ content_key: newKey }).eq("content_key", oldKey).select("page_number");
      if (!mvErr) out.migratedPages += moved?.length || 0;
      const { data: jobs, error: jobErr } = await edu().from("content_jobs")
        .update({ content_key: newKey }).eq("content_key", oldKey).select("content_key");
      if (!jobErr) out.migratedJobs += jobs?.length || 0;
      onLog(`${topic.title || topic.file_path}: ${hash}${moved?.length ? ` (${moved.length} pages moved)` : ""}`);
    } catch (e) {
      out.failed.push(`${topic.title || topic.file_path}: ${e?.message || e}`);
      onLog(`FAILED ${topic.title || topic.file_path}: ${e?.message || e}`);
    }
  }
  onLog(`checked ${out.checked} · hashed ${out.hashed} · already ${out.already} · pages moved ${out.migratedPages} · failed ${out.failed.length}`);
  return out;
}
