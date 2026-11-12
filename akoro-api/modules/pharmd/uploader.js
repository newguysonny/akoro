/**
 * modules/pharmd/uploader.js — the PHARM.D upload engine.
 *
 * Loads the pilot course packages into Supabase: one Storage object
 * per topic PDF (public bucket "pharmd-courses") plus the matching
 * pharmd_topics rows. The programme/year/course structure is seeded
 * by the migration (2026-pharmd-courses.sql); this fills in topics.
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
 * first year with the next sort order, so future packages drop in
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

  const { data: programme } = await edu().from("pharmd_programmes")
    .select("id, code, name").eq("code", PROGRAMME_CODE).maybeSingle();
  if (!programme) {
    throw new Error("the PHARMD programme row is missing — run the migrations first (the API applies them at boot)");
  }

  const zips = readdirSync(dir).filter((f) => /\.zip$/i.test(f)).sort();
  if (!zips.length) throw new Error(`no .zip files in ${dir}`);

  let totalTopics = 0, totalBytes = 0, courses = 0;
  const failures = [];

  for (const zipName of zips) {
    const code = zipName.replace(/\.zip$/i, "").trim();
    if (only && code.toLowerCase() !== only.toLowerCase()) continue;

    // The course row: seeded by the migration, or created here for a
    // new package (parked in the programme's first year).
    let { data: course } = await edu().from("pharmd_courses")
      .select("id, code, sort_order").eq("code", code).maybeSingle();
    if (!course) {
      const { data: year } = await edu().from("pharmd_years")
        .select("id").eq("programme_id", programme.id).order("number").limit(1).maybeSingle();
      if (!year) { failures.push(`${code}: no year to put it in`); continue; }
      const { data: last } = await edu().from("pharmd_courses")
        .select("sort_order").eq("year_id", year.id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
      const row = {
        programme_id: programme.id, year_id: year.id, code,
        sort_order: (last?.sort_order ?? 0) + 1,
      };
      const { data: created, error } = await edu().from("pharmd_courses").insert(row).select("id, code, sort_order").single();
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
      const file = {
        course_id: course.id, position: parsed.position, title: parsed.title,
        file_bucket: PHARMD_BUCKET, file_path: path,
        file_name: entry.entryName.split("/").pop(),
        file_size: buffer.length, file_mime: "application/pdf",
        // Versioned content key input: a re-uploaded file gets a new identity,
        // so the shared parse cache can never serve the old markdown.
        file_hash: createHash("sha256").update(buffer).digest("hex").slice(0, 32),
      };
      if (!dryRun) {
        const { error: upErr } = await db.storage.from(PHARMD_BUCKET)
          .upload(path, buffer, { contentType: "application/pdf", upsert: true });
        if (upErr) { failures.push(`${code} topic ${parsed.position}: ${upErr.message}`); continue; }
        const { error: rowErr } = await edu().from("pharmd_topics")
          .upsert(file, { onConflict: "course_id,position" });
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
