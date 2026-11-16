/**
 * modules/pharmd/uploader.js — the PHARM.D upload engine.
 *
 * Loads the pilot course packages into Supabase: one Storage object
 * per topic PDF (public bucket "pharmd-courses") plus the matching
 * programme_materials rows in the UNIFIED Program Courses tables
 * (the programme with source='pharmd', managed from the admin
 * Program Courses section). The programme/section/course structure
 * is seeded by the migrations; this fills in the materials.
 *
 * Two front doors share this engine:
 *   • scripts/upload-pharmd-courses.mjs — the CLI (local .env).
 *   • /api/pharmd/admin/upload — the browser console served by the
 *     API itself (modules/pharmd/routes.js), for when the real
 *     credentials only exist in the deployed environment.
 *
 * Pure helpers (parseTopicFile, topicPath) are exported for the
 * contract test; runPharmdUpload reports progress through onLog and
 * returns a summary — no console, no process.exit, so both the CLI
 * and an HTTP response can render it.
 *
 * The db client is imported lazily inside runPharmdUpload so the
 * exported parser stays importable by tests without Supabase env.
 */
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import AdmZip from "adm-zip";
import { createHash } from "node:crypto";

export const PHARMD_BUCKET = "pharmd-courses";
export const PROGRAMME_CODE = "PHARMD";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = join(here, "..", "..", "..", "reference", "PHARM.D PILOT PROGRAMME COURSES");

/**
 * parseTopicFile — read (position, title) out of a pilot topic PDF
 * name. The packages mix several styles, sometimes in one course:
 *
 *   Topic 1_BIO111_Cell_Structure_and_Organization.pdf
 *   Toipc 1_BIO121_Parasites_and_Parasitic_Associations.pdf   (sic)
 *   CSC_111_Topic 14_Internet_and_world_wide_web.pdf
 *   GST111_Topic 3 Sentence_in_English_PharmD_Lecture_Note.pdf
 *   GST_113_Nigerian_Peoples_and_Culture_Topic_1_Precolonial_History_Culture_Arts.pdf
 *   PHY111_Topic 1 Space_and_Time_PharmD_Lecture_Note.pdf
 *
 * Returns { position, title } or null when the name carries no
 * "Topic N" marker. Pure — exported for the contract test.
 */
export function parseTopicFile(rawName) {
  // Underscores are the de-facto separators; make them spaces so
  // word boundaries behave (Culture_Topic_1 has no \b before "Topic").
  const name = String(rawName).replace(/\.pdf$/i, "").replace(/_/g, " ");
  const m = name.match(/(?:^|[^a-z0-9])(?:topic|toipc)\s*(\d+)\b/i);
  if (!m) return null;
  const position = Number(m[1]);
  let title = name.slice(m.index + m[0].length);
  // A course code may trail the number (BIO 111 / BIO111 / BIO 111) — strip it.
  title = title.replace(/^\s*[A-Z]{2,4}\s?\d{3}\b[\s-]*/i, "");
  // Trailing note markers ("PharmD Lecture Note", "Lecture Note").
  title = title.replace(/\s*(?:pharmd\s+lecture\s+note|lecture\s+note)$/i, "");
  title = title.replace(/\s+/g, " ").trim();
  return title ? { position, title } : null;
}

/** Storage object path for one topic — readable, deterministic, per course. */
export function topicPath(code, position, title) {
  return `${code}/${String(position).padStart(2, "0")} - ${title}.pdf`;
}

/** adm-zip 0.5 calls isDirectory(), 0.6 makes it a property — read both. */
const isDir = (e) => (typeof e.isDirectory === "function" ? e.isDirectory() : e.isDirectory);

/**
 * runPharmdUpload — walk the course zips in `dir` and load their
 * topic PDFs. Options:
 *   dryRun  count and report only — no writes at all
 *   only    a single course code ("BIO 111") instead of every zip
 *   dir     defaults to the repo's reference/PHARM.D PILOT PROGRAMME COURSES/
 *   onLog   progress callback, one line per event
 *
 * Idempotent: files upload with upsert and rows upsert on
 * (course_id, position) — re-running simply refreshes. A course
 * whose code isn't seeded yet is created under the programme's
 * first section with the next position, so future packages drop in
 * without touching SQL.
 *
 * Returns { ok, dryRun, courses, topics, bytes, failures[] } and
 * throws only on setup problems (missing folder/programme, bucket
 * failure) — per-topic problems land in `failures`.
 */
export async function runPharmdUpload({ dryRun = false, only = null, dir = DEFAULT_DIR, onLog = () => {} } = {}) {
  const log = (line) => onLog(line);
  if (!existsSync(dir)) {
    throw new Error(`course folder not found: ${dir} — pass dir, or run where the repo's reference/ folder is present`);
  }

  // Lazy so importing this module for parseTopicFile needs no env.
  const { default: db } = await import("../../db.js");
  const edu = () => db.schema("edu");

  // The public bucket, once (ignores "already exists" — the
  // templateStorage pattern).
  if (!dryRun) {
    const { error } = await db.storage.createBucket(PHARMD_BUCKET, { public: true });
    if (error && !/exist/i.test(error.message || "")) throw new Error(`bucket: ${error.message}`);
  }

  // Unified target: the generic programme (source='pharmd'). The legacy
  // pharmd_* rows are read only for source links, so content the first
  // import connected keeps its identity (progress, parse cache).
  const { data: legacyProgramme } = await edu().from("pharmd_programmes")
    .select("id").eq("code", PROGRAMME_CODE).maybeSingle();
  const { data: programme } = await edu().from("programmes")
    .select("id, code, name").eq("source", "pharmd").eq("code", PROGRAMME_CODE).maybeSingle();
  if (!programme) {
    throw new Error("the unified PHARM.D programme row is missing — run the migrations first (the API applies them at boot)");
  }
  const { data: sections } = await edu().from("programme_sections")
    .select("id, name, position").eq("programme_id", programme.id).order("position");
  if (!sections?.length) {
    throw new Error("the unified PHARM.D programme has no sections — run the migrations first");
  }

  const zips = readdirSync(dir).filter((f) => /\.zip$/i.test(f)).sort();
  if (!zips.length) throw new Error(`no .zip files in ${dir}`);

  let totalTopics = 0, totalBytes = 0, courses = 0;
  const failures = [];

  for (const zipName of zips) {
    const code = zipName.replace(/\.zip$/i, "").trim();
    if (only && code.toLowerCase() !== only.toLowerCase()) continue;

    // The course row in the unified tables: seeded by the migrations,
    // or created here for a new package (parked in the first section).
    const { data: legacyCourse } = legacyProgramme
      ? await edu().from("pharmd_courses").select("id, code").eq("code", code).maybeSingle()
      : { data: null };
    let { data: course } = await edu().from("programme_courses")
      .select("id, code").eq("programme_id", programme.id).eq("code", code).maybeSingle();
    if (!course) {
      const section = sections[0];
      const { data: last } = await edu().from("programme_courses")
        .select("position").eq("section_id", section.id).order("position", { ascending: false }).limit(1).maybeSingle();
      const row = {
        programme_id: programme.id, section_id: section.id, code, title: code,
        status: "published", position: (last?.position ?? -1) + 1,
        source_course_id: legacyCourse?.id ?? null,
      };
      const { data: created, error } = await edu().from("programme_courses").insert(row).select("id, code").single();
      if (error) { failures.push(`${code}: ${error.message}`); continue; }
      course = created;
      log(`+ course ${code} created`);
    }

    const zip = new AdmZip(join(dir, zipName));
    const pdfs = zip.getEntries().filter((e) => !isDir(e) && /\.pdf$/i.test(e.entryName));

    let count = 0, bytes = 0;
    for (const entry of pdfs) {
      const parsed = parseTopicFile(entry.entryName.split("/").pop());
      if (!parsed) { failures.push(`${code}: unparseable name — ${entry.entryName}`); continue; }
      const path = topicPath(code, parsed.position, parsed.title);
      const buffer = entry.getData();
      // Versioned content key input: a re-uploaded file gets a new identity,
      // so the shared parse cache can never serve the old markdown.
      const fileHash = createHash("sha256").update(buffer).digest("hex").slice(0, 32);
      if (!dryRun) {
        const { error: upErr } = await db.storage.from(PHARMD_BUCKET)
          .upload(path, buffer, { contentType: "application/pdf", upsert: true });
        if (upErr) { failures.push(`${code} topic ${parsed.position}: ${upErr.message}`); continue; }
        // The material row — the topic's unified home. Upsert on
        // (course_id, position) by hand: select, then update or insert.
        // The public URL + file identity live on the material itself.
        let legacyTopicId = null;
        if (legacyCourse) {
          const { data: lt } = await edu().from("pharmd_topics")
            .select("id").eq("course_id", legacyCourse.id).eq("position", parsed.position).maybeSingle();
          legacyTopicId = lt?.id ?? null;
        }
        const row = {
          course_id: course.id, position: parsed.position, title: parsed.title,
          type: "pdf", status: "published",
          meta: `${(buffer.length / 1048576).toFixed(1)} MB`,
          url: db.storage.from(PHARMD_BUCKET).getPublicUrl(path).data.publicUrl,
          file_path: path, file_hash: fileHash,
          source_topic_id: legacyTopicId,
        };
        const { data: existing } = await edu().from("programme_materials")
          .select("id").eq("course_id", course.id).eq("position", parsed.position).maybeSingle();
        const { error: rowErr } = existing
          ? await edu().from("programme_materials").update(row).eq("id", existing.id)
          : await edu().from("programme_materials").insert(row);
        if (rowErr) { failures.push(`${code} topic ${parsed.position}: ${rowErr.message}`); continue; }
      }
      count += 1; bytes += buffer.length;
    }
    courses += 1;
    totalTopics += count; totalBytes += bytes;
    log(`${dryRun ? "would load" : "loaded"} ${code}: ${count} topics (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }

  log(`${dryRun ? "DRY RUN — " : ""}${totalTopics} topics, ${(totalBytes / 1024 / 1024).toFixed(1)} MB → bucket "${PHARMD_BUCKET}"`);
  if (failures.length) log(`${failures.length} problem(s) — see failures in the result`);
  return { ok: failures.length === 0, dryRun, courses, topics: totalTopics, bytes: totalBytes, failures };
}
