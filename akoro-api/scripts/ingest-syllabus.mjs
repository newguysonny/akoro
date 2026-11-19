/**
 * ingest-syllabus.mjs — load a structured syllabus JSON into the knowledge base.
 *
 *   node scripts/ingest-syllabus.mjs [path-to-json]
 *
 * Defaults to the sample WASSCE Physics subject. Requires SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY in the environment (embeds each
 * subtopic via text-embedding-3-small). Re-running replaces that subject's
 * content, so it's safe to iterate.
 *
 * To add real subjects: convert the official WAEC syllabus PDF into the same
 * JSON shape (see data/syllabus/wassce-physics.sample.json) and point this
 * script at it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSubject } from "../modules/adaptive-learning/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(__dirname, "..", "data", "syllabus", "wassce-physics.sample.json");

const doc = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`[ingest] ${doc.exam || "WASSCE"} · ${doc.name} — from ${file}`);

ingestSubject(doc)
  .then((r) => { console.log("[ingest] ✅ done:", r); process.exit(0); })
  .catch((e) => { console.error("[ingest] ❌ failed:", e.message); process.exit(1); });
