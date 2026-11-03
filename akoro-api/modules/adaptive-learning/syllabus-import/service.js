/**
 * syllabus-import/service.js — a syllabus PDF → a draft in
 * edu.syllabus_imports → (admin publishes) → edu.syllabus_* via ingestSubject.
 *
 *   start({ buffer, fileName, exam, name, code, userId }) → { importId }   (runs in the background)
 *   run(...)                                   → the finished row (awaits the work; gate + scripts)
 *   list() / get(id) / publish(id, userId) / discard(id)
 *
 * The draft is what the review screen shows; learners and agents read only the
 * published edu.syllabus_* tables. The model reads the text the PDF already
 * has — no OCR (every reference syllabus is a digital PDF).
 */
import db from "../../../db.js";
import { pdfLayoutPages } from "./layoutText.js";
import { structureSyllabus, toIngestDoc } from "./structure.js";

const T = () => db.schema("edu").from("syllabus_imports");
const now = () => new Date().toISOString();
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
export const EXAMS = Object.freeze(["WASSCE", "NECO", "JAMB", "NCEE", "BECE", "IGCSE"]);

/**
 * The importer's model: DeepSeek wherever the server has it set up (key,
 * DEEPSEEK_MODEL and a price), else gpt-4.1-mini — so an import never fails
 * just because one provider isn't configured. SYLLABUS_IMPORT_MODEL overrides.
 */
export async function importModel() {
  const { modelRegistry, availabilityOf } = await import("../../../lib/modelRegistry.js");
  for (const id of [process.env.SYLLABUS_IMPORT_MODEL, "deepseek", "gpt-4.1-mini"].filter(Boolean)) {
    const e = modelRegistry.get(id);
    if (e && availabilityOf(e).available) return id;
  }
  return "gpt-4.1-mini";
}

/** The model call: billed to the platform, JSON out. */
async function ask({ system, user, maxTokens }) {
  const { openai } = await import("../../../lib/aiModel.js");
  const res = await openai.chat.completions.create({
    model: await importModel(), temperature: 0.1, max_tokens: maxTokens, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    __role: "background", __payer: "platform", __feature: "syllabus_import",
  });
  return res.choices?.[0]?.message?.content || "";
}

async function work(id, { buffer, fileName, exam, name, code }, { askFn = ask } = {}) {
  try {
    const pages = await pdfLayoutPages(buffer);
    const textChars = pages.reduce((n, p) => n + p.text.replace(/\s+/g, "").length, 0);
    if (textChars < 200) throw Object.assign(new Error("This PDF has no readable text layer (a scan). Scanned syllabi need the page reader; this importer reads digital PDFs."), { code: "scanned_pdf" });
    await T().update({ progress: { step: "structuring", pages: pages.length }, updated_at: now() }).eq("id", id);
    const out = await structureSyllabus({
      pages, hint: { exam, name, code }, ask: askFn,
      onProgress: (p) => { T().update({ progress: { step: "structuring", pages: pages.length, ...p }, updated_at: now() }).eq("id", id).then(() => {}, () => {}); },
    });
    const { data } = await T().update({
      status: "draft", name: out.doc.name, doc: out.doc, stats: { ...out.stats, model: await importModel() }, warnings: out.warnings,
      progress: { step: "done", pages: pages.length }, updated_at: now(),
    }).eq("id", id).select("*").single();
    return data;
  } catch (e) {
    console.warn("[syllabus-import]", e?.message || e);
    const { data } = await T().update({ status: "failed", error: clip(e?.message || "Import failed", 500), updated_at: now() }).eq("id", id).select("*").single();
    return data;
  }
}

async function create({ fileName, exam, name, userId }) {
  const ex = EXAMS.includes(String(exam || "").toUpperCase()) ? String(exam).toUpperCase() : "WASSCE";
  const { data, error } = await T().insert({
    exam: ex, name: clip(name, 120) || null, source_file: clip(fileName, 300) || null, status: "extracting",
    progress: { step: "reading" }, created_by: userId || null,
  }).select("id, exam").single();
  if (error) throw error;
  return data;
}

/** Start an import; the work runs in the background. */
export async function start({ buffer, fileName, exam, name, code, userId }) {
  const row = await create({ fileName, exam, name, userId });
  setImmediate(() => { work(row.id, { buffer, fileName, exam: row.exam, name, code }).catch(() => {}); });
  return { importId: row.id };
}

/**
 * PURE: a subject name and code from a syllabus file name.
 *   "biology-0610-2026-2028.pdf" → { name: "Biology", code: "0610" }
 *   "biology-9-1-0970-2026-2028.pdf" → { name: "Biology (9-1)", code: "0970" }
 *   "further-mathematics-or-mathematics-elective.pdf" → { name: "Further Mathematics or Mathematics Elective" }
 *   "animal-husbandry-alt-a.pdf" → { name: "Animal Husbandry (Alt A)" }
 */
export function nameFromFile(fileName) {
  let base = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "").replace(/^copy of\s+/i, "");
  let code = null;
  const graded = /(^|-)9-1(-|$)/.test(base);
  base = base.replace(/(^|-)9-1(?=-|$)/, "$1");
  base = base.replace(/(-(19|20)\d{2})+$/, "");                 // trailing years
  const c = base.match(/-(\d{4})$/); if (c) { code = c[1]; base = base.slice(0, -5); }
  const alt = base.match(/-alt-([a-z])$/i); if (alt) base = base.slice(0, alt.index);
  base = base.replace(/-new$/i, "");
  const small = new Set(["and", "of", "in", "or", "to", "the", "for", "with"]);
  const words = base.split(/[-_\s]+/).filter(Boolean).map((w, i) => (i && small.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)));
  let name = words.join(" ").replace(/\bIct\b/, "ICT").replace(/\bGsm\b/, "GSM").trim() || "Untitled";
  if (graded) name += " (9-1)";
  if (alt) name += ` (Alt ${alt[1].toUpperCase()})`;
  return { name, code };
}

/** A small in-process queue: batch imports run two at a time. */
const queue = [];
let running = 0;
const MAX_RUNNING = 2;
function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift();
    running++;
    work(job.id, job.input).catch(() => {}).finally(() => { running--; pump(); });
  }
}

/** Queue many PDFs at once (one exam per batch); each becomes its own draft. */
export async function startBatch({ files = [], exam, userId }) {
  const ids = [];
  for (const f of files) {
    const { name, code } = nameFromFile(f.originalname);
    const row = await create({ fileName: f.originalname, exam, name, userId });
    await T().update({ progress: { step: "queued" } }).eq("id", row.id);
    queue.push({ id: row.id, input: { buffer: f.buffer, fileName: f.originalname, exam: row.exam, name, code } });
    ids.push({ importId: row.id, file: f.originalname, name, code });
  }
  pump();
  return { queued: ids };
}

/** Run an import to the end (scripts, the gate). */
export async function run({ buffer, fileName, exam, name, code, userId, askFn }) {
  const row = await create({ fileName, exam, name, userId });
  return work(row.id, { buffer, fileName, exam: row.exam, name, code }, askFn ? { askFn } : {});
}

const STALE_MS = 20 * 60_000;

export async function list({ limit = 200 } = {}) {
  // An import still "extracting" long after its last update was cut off (a deploy or restart): say so, so it can be tried again.
  await T().update({ status: "failed", error: "Stopped before it finished (the server restarted). Upload the PDF again.", updated_at: now() })
    .eq("status", "extracting").lt("updated_at", new Date(Date.now() - STALE_MS).toISOString()).then(() => {}, () => {});
  const { data, error } = await T().select("id, exam, name, source_file, status, progress, stats, warnings, error, subject_id, created_at, updated_at, published_at")
    .neq("status", "discarded").order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function get(id) {
  const { data } = await T().select("*").eq("id", id).maybeSingle();
  return data || null;
}

/** Publish the reviewed draft into the syllabus the app reads (replaces that exam + subject). */
export async function publish(id, userId) {
  const row = await get(id);
  if (!row) throw Object.assign(new Error("Import not found"), { status: 404 });
  if (row.status !== "draft") throw Object.assign(new Error(`Only a draft can be published (this one is ${row.status})`), { status: 409 });
  const { ingestSubject } = await import("../syllabus.js");
  const result = await ingestSubject(toIngestDoc(row.doc, `${row.source_file || "syllabus PDF"} (imported ${row.created_at?.slice(0, 10) || ""})`));
  const { data: subject } = await db.schema("edu").from("syllabus_subjects").select("id").eq("exam", row.doc.exam).eq("name", row.doc.name).maybeSingle();
  await T().update({ status: "published", subject_id: subject?.id || null, published_by: userId || null, published_at: now(), updated_at: now() }).eq("id", id);
  return { ...result, subjectId: subject?.id || null };
}

export async function discard(id) {
  await T().update({ status: "discarded", updated_at: now() }).eq("id", id).in("status", ["draft", "failed", "extracting"]);
  return { ok: true };
}
