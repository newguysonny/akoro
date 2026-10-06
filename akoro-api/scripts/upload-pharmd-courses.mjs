#!/usr/bin/env node
/**
 * upload-pharmd-courses.mjs — load the PHARM.D pilot course packages
 * into Supabase: one Storage object per topic PDF (public bucket
 * "pharmd-courses") plus the matching pharmd_topics rows. The
 * programme/year/course structure is seeded by the migration
 * (2026-pharmd-courses.sql); this script fills in the topics.
 *
 * Usage (from akoro-api/, with the API's .env present):
 *   node scripts/upload-pharmd-courses.mjs
 *   node scripts/upload-pharmd-courses.mjs --dir="/path/to/PHARM.D PILOT PROGRAMME COURSES"
 *   node scripts/upload-pharmd-courses.mjs --only="BIO 111"
 *   node scripts/upload-pharmd-courses.mjs --dry-run
 *
 * Defaults --dir to the repo's reference/PHARM.D PILOT PROGRAMME
 * COURSES/. Each <COURSE CODE>.zip holds one folder of topic PDFs
 * with the pilot's assorted name styles (see parseTopicFile).
 *
 * Idempotent: files upload with upsert and rows upsert on
 * (course_id, position) — re-running simply refreshes. A course
 * whose code isn't seeded yet is created under the programme's
 * first year with the next sort order, so future packages drop in
 * without touching SQL.
 *
 * The db client is imported lazily inside main() so the exported
 * parser stays importable by tests without Supabase env.
 */
import "dotenv/config";
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import AdmZip from "adm-zip";

export const PHARMD_BUCKET = "pharmd-courses";
export const PROGRAMME_CODE = "PHARMD";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = join(here, "..", "..", "reference", "PHARM.D PILOT PROGRAMME COURSES");

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

/** Parse CLI args: --dir, --only, --dry-run. */
function readArgs(argv) {
  const arg = (flag) => argv.find((a) => a.startsWith(flag))?.split("=").slice(1).join("=");
  const dir = arg("--dir") || DEFAULT_DIR;
  const only = arg("--only") || null;
  const dryRun = argv.includes("--dry-run");
  return { dir, only, dryRun };
}

async function main() {
  const { dir, only, dryRun } = readArgs(process.argv.slice(2));
  if (!existsSync(dir)) {
    console.error(`ERROR: course folder not found: ${dir}\nPass --dir="<path to the zips>" or run from the repo.`);
    process.exit(1);
  }

  // Lazy so importing this module for parseTopicFile needs no env.
  const { default: db } = await import("../db.js");
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
    console.error("ERROR: the PHARMD programme row is missing — run the migrations first (npm run db:migrate).");
    process.exit(1);
  }

  const zips = readdirSync(dir).filter((f) => /\.zip$/i.test(f)).sort();
  if (!zips.length) {
    console.error(`ERROR: no .zip files in ${dir}`);
    process.exit(1);
  }

  let totalTopics = 0, totalBytes = 0;
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
      console.log(`+ course ${code} created`);
    }

    const zip = new AdmZip(join(dir, zipName));
    // adm-zip 0.5 calls isDirectory(), 0.6 makes it a property — read both.
  const isDir = (e) => (typeof e.isDirectory === "function" ? e.isDirectory() : e.isDirectory);
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
    totalTopics += count; totalBytes += bytes;
    console.log(`${dryRun ? "would load" : "loaded"} ${code}: ${count} topics (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log(`\n${dryRun ? "DRY RUN — " : ""}${totalTopics} topics, ${(totalBytes / 1024 / 1024).toFixed(1)} MB → bucket "${PHARMD_BUCKET}"`);
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    for (const f of failures) console.error(`  • ${f}`);
    process.exitCode = 1;
  }
}

// Run only when executed directly (node scripts/upload-pharmd-courses.mjs).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => { console.error(`[ERROR] ${err.message}`); process.exit(1); });
}
