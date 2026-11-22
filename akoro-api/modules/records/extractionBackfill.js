/**
 * modules/records/extractionBackfill.js — the admin "backfill extraction"
 * operation, the extraction counterpart of the preview backfill.
 *
 * Unlike previews, extraction is slow (an OCR run is 10–60 s per document) and
 * some lanes are metered, so this runs as a JOB: POST starts it, GET reads
 * progress from edu.platform_settings, and the admin console polls. A dry run
 * only counts what is missing and never downloads a file.
 *
 * The lane follows the deployment's extraction engine:
 *   • free stored-text read for PDFs with a text layer, .txt/.md, Word/PPT;
 *   • scanned PDFs / images through DeepSeek OCR, the vision model, or the
 *     RunPod worker — whichever is configured;
 *   • images are OCR-lane only (the vision/RunPod lanes take rendered JPEG
 *     pages, not arbitrary image files).
 *
 * Claims are taken for the model/RunPod lanes so a reader's own extraction and
 * a backfill never run the same file twice. Idempotent: a file with saved
 * pages, or a live claim, is skipped on the next run.
 */
import { renderPdfPages } from "./preview.js";
import { parsePagesWithModel } from "./extractModel.js";
import {
  parsePageOnRunpod, saveExtractionPages, claimContentJob, finishContentJob,
  MAX_RECORD_PAGES,
} from "./extractLib.js";
import { runOcrWithFallback, ocrConfigured } from "./extractOcr.js";
import { storedTextKindOf, extractStoredText } from "./storedText.js";
import { indexByContentKey } from "./searchLib.js";
import { readFileObject, createPresignedDownload } from "./lib/storage.js";
import { getExtractEngine, extractModelId } from "./extractEngine.js";

const dbLazy = async () => (await import("../../db.js")).default;
const PAGE = 200;
const SCAN_CAP = 3000;      // records inspected for a dry run / "remaining" count
const MAX_BATCH = 5;        // documents per job (each can cost a model/OCR call)
const SETTINGS_PREFIX = "extract_backfill:";
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

const isPdf = (r) => /pdf/i.test(r?.mime || "") || /\.pdf$/i.test(r?.name || "");
const isImage = (r) => /^image\//i.test(r?.mime || "");

/** Uploads whose file has no saved extraction and no live claim. */
async function missingRows({ limit = MAX_BATCH, scanCap = SCAN_CAP } = {}) {
  const db = await dbLazy();
  const edu = db.schema("edu");
  const out = [];
  let scanned = 0;
  for (let from = 0; out.length < limit && scanned < scanCap; from += PAGE) {
    const { data: rows, error } = await edu.from("records")
      .select("id, user_id, name, mime, file_key, created_at")
      .eq("kind", "upload").not("file_key", "is", null).is("deleted_at", null)
      .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!rows?.length) break;
    scanned += rows.length;
    // One row per file key — a shared file is parsed once, as everywhere else.
    const unique = new Map();
    for (const r of rows) if (!unique.has(r.file_key)) unique.set(r.file_key, r);
    const keys = [...unique.keys()];
    const [{ data: parsed, error: parseErr }, { data: jobs, error: jobErr }] = await Promise.all([
      edu.from("content_parses").select("content_key").in("content_key", keys),
      edu.from("content_jobs").select("content_key, status").eq("lane", "parse").in("content_key", keys),
    ]);
    if (parseErr) throw new Error(parseErr.message);
    if (jobErr) throw new Error(jobErr.message);
    const have = new Set((parsed || []).map((p) => p.content_key));
    const busy = new Set((jobs || []).filter((j) => j.status === "running").map((j) => j.content_key));
    for (const r of unique.values()) {
      if (have.has(r.file_key) || busy.has(r.file_key)) continue;
      out.push(r);
      if (out.length >= limit) break;
    }
    if (rows.length < PAGE) break;
  }
  return { rows: out, scanned, capped: scanned >= scanCap };
}

/** Dry run: how many uploads need extraction, split by what will read them. */
export async function scanExtractionGaps({ scanCap = SCAN_CAP } = {}) {
  const db = await dbLazy();
  const edu = db.schema("edu");
  const counts = { total: 0, text: 0, scannedPdf: 0, image: 0, other: 0 };
  const sample = [];
  let scanned = 0;
  for (let from = 0; scanned < scanCap; from += PAGE) {
    const { data: rows, error } = await edu.from("records")
      .select("id, name, mime, file_key, created_at")
      .eq("kind", "upload").not("file_key", "is", null).is("deleted_at", null)
      .order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!rows?.length) break;
    scanned += rows.length;
    const unique = new Map();
    for (const r of rows) if (!unique.has(r.file_key)) unique.set(r.file_key, r);
    const keys = [...unique.keys()];
    const [{ data: parsed }, { data: jobs }] = await Promise.all([
      edu.from("content_parses").select("content_key").in("content_key", keys),
      edu.from("content_jobs").select("content_key, status").eq("lane", "parse").in("content_key", keys),
    ]);
    const have = new Set((parsed || []).map((p) => p.content_key));
    const busy = new Set((jobs || []).filter((j) => j.status === "running").map((j) => j.content_key));
    for (const r of unique.values()) {
      if (have.has(r.file_key) || busy.has(r.file_key)) continue;
      counts.total += 1;
      if (storedTextKindOf(r.mime, r.name)) counts.text += 1;
      else if (isImage(r)) counts.image += 1;
      else if (isPdf(r)) counts.scannedPdf += 1;
      else counts.other += 1;
      if (sample.length < 10) sample.push({ id: r.id, name: r.name, kind: storedTextKindOf(r.mime, r.name) ? "text" : isImage(r) ? "image" : isPdf(r) ? "scanned" : "other" });
    }
    if (rows.length < PAGE) break;
  }
  return { ...counts, sample, inspected: scanned, capped: scanned >= scanCap };
}

/** One upload → { status, pages, lane, note }. Throws only for real failures. */
async function extractOne(row, { engine, maxPages }) {
  const contentKey = row.file_key;
  if (storedTextKindOf(row.mime, row.name)) {
    const fileUrl = await createPresignedDownload(contentKey, { downloadName: row.name });
    const out = await extractStoredText({
      userId: row.user_id, contentKey, name: row.name, mime: row.mime,
      fileUrl, rememberScanned: true, bill: false,
    });
    if (out.status === "done") return { status: "done", lane: "stored-text", pages: null };
    if (out.status === "scanned") {
      if (!isPdf(row)) return { status: "skipped", lane: "stored-text", note: "scanned, but not a PDF — open it in the reader" };
    } else {
      return { status: out.status, lane: "stored-text", note: out.error || null };
    }
  } else if (!isPdf(row) && !isImage(row)) {
    return { status: "skipped", lane: "none", note: "audio/video is transcribed on open" };
  }

  if (engine === "ocr") {
    if (!ocrConfigured()) throw new Error("DeepSeek OCR is not configured (DEEPSEEK_API_KEY).");
    const { body } = await readFileObject(contentKey);
    const out = await runOcrWithFallback({ buffer: body, filename: row.name || "document.pdf" });
    await saveExtractionPages({ contentKey, pages: out.pages, model: out.model });
    await indexByContentKey({ contentKey, pages: out.pages, bill: false });
    return { status: "done", lane: "ocr", pages: out.pages.length };
  }

  // Vision model / RunPod read rendered pages — a PDF only.
  if (!isPdf(row)) return { status: "skipped", lane: engine, note: "images need the DeepSeek OCR engine" };
  const claimed = await claimContentJob(contentKey, "parse", row.user_id).catch(() => false);
  if (!claimed) return { status: "skipped", lane: engine, note: "another extraction holds this file" };
  try {
    const { body } = await readFileObject(contentKey);
    const rendered = await renderPdfPages(body, { from: 1, to: Math.min(MAX_RECORD_PAGES, maxPages), width: 1100 });
    if (!rendered.length) throw new Error("No pages could be rendered.");
    let pages;
    if (engine === "model") {
      const parsed = await parsePagesWithModel({
        pages: rendered.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString("base64") })),
        userId: row.user_id, model: extractModelId(),
      });
      pages = parsed.filter((p) => !p.error)
        .map((p) => ({ pageNumber: p.pageNumber, blocks: [], markdown: p.markdown, model: p.model || extractModelId() }));
    } else if (engine === "runpod") {
      pages = [];
      for (const p of rendered) {
        const out = await parsePageOnRunpod({ imageBase64: p.jpeg.toString("base64") });
        pages.push({ pageNumber: p.pageNumber, blocks: out.blocks || [], markdown: out.markdown || "", model: out.model || "hanji-parse-4b" });
      }
    } else {
      throw new Error(`Unknown extraction engine: ${engine}`);
    }
    if (!pages.length) throw new Error("The lane returned no text.");
    await saveExtractionPages({ contentKey, pages, model: engine === "model" ? extractModelId() : "hanji-parse-4b" });
    await indexByContentKey({ contentKey, pages, bill: false });
    await finishContentJob(contentKey, "parse", "done", { mode: engine, pages: pages.length });
    return { status: "done", lane: engine, pages: pages.length };
  } catch (err) {
    await finishContentJob(contentKey, "parse", "failed", { mode: engine, error: String(err?.message || err) }).catch(() => {});
    throw err;
  }
}

async function saveJob(jobId, value) {
  const db = await dbLazy();
  const { error } = await db.schema("edu").from("platform_settings")
    .upsert({ key: SETTINGS_PREFIX + jobId, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/** Start a backfill run (off the request path). → { jobId, total, engine }. */
export async function startExtractionBackfill({ limit = 2, maxPages = MAX_RECORD_PAGES } = {}) {
  const requested = Number(limit);
  const batch = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_BATCH, Math.floor(requested)) : 2;
  const cap = Number.isFinite(Number(maxPages)) && Number(maxPages) > 0
    ? Math.min(MAX_RECORD_PAGES, Math.floor(Number(maxPages))) : MAX_RECORD_PAGES;
  const engine = await getExtractEngine();
  const { rows } = await missingRows({ limit: batch });

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = {
    id: jobId, status: "running", engine, startedAt: new Date().toISOString(),
    total: rows.length, processed: 0, results: [],
  };
  await saveJob(jobId, job);

  void (async () => {
    for (const row of rows) {
      const t0 = Date.now();
      try {
        const out = await extractOne(row, { engine, maxPages: cap });
        job.results.push({ id: row.id, name: row.name, ms: Date.now() - t0, ...out });
      } catch (err) {
        job.results.push({ id: row.id, name: row.name, ms: Date.now() - t0, status: "failed", error: String(err?.message || err).slice(0, 300) });
      }
      job.processed += 1;
      await saveJob(jobId, job).catch(() => {});
    }
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    try {
      const gap = await scanExtractionGaps();
      job.remaining = gap.total;
      job.capped = gap.capped;
    } catch { job.remaining = null; }
    await saveJob(jobId, job).catch(() => {});
  })().catch(async (err) => {
    job.status = "failed";
    job.error = String(err?.message || err).slice(0, 300);
    job.finishedAt = new Date().toISOString();
    await saveJob(jobId, job).catch(() => {});
  });

  return { jobId, total: rows.length, engine };
}

/** Read one job (the admin console polls this). */
export async function getExtractionBackfill(jobId) {
  const id = String(jobId || "");
  if (!/^[a-z0-9]{4,40}$/i.test(id)) return null;
  const db = await dbLazy();
  const { data } = await db.schema("edu").from("platform_settings")
    .select("value, updated_at").eq("key", SETTINGS_PREFIX + id).maybeSingle();
  const job = data?.value || null;
  if (!job) return null;
  const age = Date.now() - Date.parse(job.startedAt || 0);
  if (job.status !== "running" && age > JOB_TTL_MS) return null;
  return job;
}
