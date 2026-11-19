/**
 * modules/records/service-extract.js — AI text extraction (hanji-parse-4b
 * on RunPod): scanned PDFs and images, the async batch lane, its status
 * poll, and the free stored-text read path.
 *
 * The reader rasterizes pages client-side and posts them here in ≤16-page
 * batches; each page runs one async RunPod job on the parse worker, and
 * results land in edu.content_parses — keyed by the STORAGE FILE KEY. A
 * learner's own upload has a user-scoped key (privacy inherits); a SHARED
 * file (discovery) has one key, so it is parsed ONCE and every later opener
 * reads the same rows for free.
 *
 * Identity: { recordId } (your record) or { contentKey } (a shared file's
 * storage key — verified with the exact access rule the discovery feed
 * uses). A single-flight claim (edu.content_jobs) keeps concurrent
 * first-opens from double-spending: the loser gets 409 + the job row and
 * polls instead.
 */
import { createPresignedDownload } from "./lib/storage.js";
import {
  recordsExtractionEnabled, parsePageRunAsync, getParseJob, settleParseJob, saveExtractionPage,
  getExtraction, claimContentJob, finishContentJob, updateContentJob, getContentJob,
  MAX_PAGES_PER_REQUEST, MAX_RECORD_PAGES, MAX_IMAGE_B64_CHARS,
} from "./extractLib.js";
import { indexByContentKey } from "./searchLib.js";
import { resolveContentAccess } from "./access.js";
import { storedTextKindOf, extractStoredText } from "./storedText.js";
import { pageSizeOf } from "./rules.js";
import { res400, okExtract } from "./http.js";
import * as store from "./store-records.js";
import { parseRefusalCode, parseRefusalMessage } from "./parseRefusal.js";

/* recordId | contentKey → { contentKey, name } | { status, message }. */
export async function resolveAiContent(req) {
  return resolveContentAccess({ userId: req.user.id, recordId: req.body?.recordId, contentKey: req.body?.contentKey });
}

/*
 * POST /extract — SUBMIT a batch (≤16 rendered pages) and return at once.
 * Each page becomes one async RunPod job; the job ids ride the single-flight
 * claim's result, and GET /extract/status collects them. A GPU page used to
 * ride this request via /runsync — up to 8 × 150 s — past Cloudflare's
 * ~100 s cut, which killed long batches with an HTML error page.
 */
export async function submitExtract(req, res) {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "Text extraction isn't configured on this deployment yet." });
  }
  const id = await resolveAiContent(req);
  if (id.error !== undefined || id.status) return res.status(id.status).json({ success: false, message: id.message });
  const { contentKey } = id;

  const pages = Array.isArray(req.body?.pages) ? req.body.pages : [];
  if (!pages.length) return res400(res, "Send at least one rendered page.");
  if (pages.length > MAX_PAGES_PER_REQUEST) return res400(res, `Send at most ${MAX_PAGES_PER_REQUEST} pages per request.`);

  // Validate EVERY page before claiming: a 400 after the claim used to leave
  // the file locked as "running" for 10 minutes (everyone else got 409).
  const work = [];
  for (const p of pages) {
    const pageNumber = Number(p?.pageNumber);
    const imageBase64 = typeof p?.imageBase64 === "string" ? p.imageBase64 : "";
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_RECORD_PAGES) {
      return res400(res, `Page numbers must be 1-${MAX_RECORD_PAGES}.`);
    }
    if (!imageBase64) return res400(res, `Page ${pageNumber} has no image.`);
    if (imageBase64.length > MAX_IMAGE_B64_CHARS) {
      return res400(res, `Page ${pageNumber}'s image is too large — re-render it smaller.`);
    }
    work.push({ pageNumber, b64: imageBase64.replace(/^data:[^,]*,/, ""), size: pageSizeOf(p) });   // tolerate data: URIs
  }

  // Single flight: only one batch runs per file; latecomers poll.
  const claimed = await claimContentJob(contentKey, "parse", req.user.id);
  if (!claimed) {
    return res.status(409).json({ success: false, error: "This file is being extracted right now — the shared result will appear in a moment.", job: await getContentJob(contentKey, "parse") });
  }

  const submittedAt = new Date().toISOString();
  const jobs = [];
  let submitError = null;
  // Submit in concurrent waves: each /run call is quick, but sixteen of
  // them in series added seconds before the first page even queued. A
  // refusal still stops the run — later waves are never submitted.
  const SUBMIT_WAVE = 8;
  for (let i = 0; i < work.length && !submitError; i += SUBMIT_WAVE) {
    const wave = work.slice(i, i + SUBMIT_WAVE);
    const results = await Promise.allSettled(wave.map(({ b64 }) => parsePageRunAsync({ imageBase64: b64 })));
    results.forEach((r, j) => {
      const { pageNumber, size } = wave[j];
      if (r.status === "fulfilled") {
        jobs.push({ pageNumber, jobId: r.value.jobId, state: "pending", ...(size ? { size } : {}) });
      } else if (!submitError) {
        submitError = { pageNumber, error: String(r.reason?.message || r.reason).slice(0, 200) };
      }
    });
  }
  if (!jobs.length) {
    await finishContentJob(contentKey, "parse", "failed", { error: submitError?.error || "Submit failed" });
    // 424, not 502: behind Cloudflare a 502 from the API is replaced by its own
    // error page WITHOUT CORS headers, so the learner only ever saw "Failed to
    // fetch" (and the app retried it as a dropped connection). 2026-11-06.
    return res.status(424).json({ success: false, code: parseRefusalCode(submitError?.error), error: parseRefusalMessage(submitError?.error) });
  }
  await updateContentJob(contentKey, "parse", { mode: "async", submittedAt, jobs });
  res.status(202).json({
    success: true,
    data: {
      contentKey,
      pending: jobs.map((j) => j.pageNumber),
      ...(submitError ? { failed: [submitError] } : {}),
    },
  });
}

/*
 * GET /extract/status?recordId=|contentKey= — collect the batch POST
 * /extract submitted. Each poll checks the still-pending jobs on RunPod,
 * saves the pages that finished, and releases the claim once every page
 * is settled (so the reader can send the next batch). Any authorised
 * opener may poll — a shared file's latecomer finishes the batch for all.
 */
export async function extractStatus(req, res) {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "Text extraction isn't configured on this deployment yet." });
  }
  const probe = { ...req, body: { recordId: req.query.recordId, contentKey: req.query.contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  const { contentKey } = id;

  const job = await getContentJob(contentKey, "parse");
  const batch = job?.result?.mode === "async" && Array.isArray(job.result.jobs) ? job.result : null;
  if (!batch) {
    return okExtract(res, { contentKey, running: job?.status === "running", done: job?.status !== "running", pages: [], failed: [], pending: [] });
  }

  // Poll every pending job concurrently — in series, one status round
  // cost up to sixteen sequential RunPod calls before anything saved.
  const polledByJob = new Map();
  await Promise.all(batch.jobs.filter((e) => e.state === "pending").map(async (entry) => {
    try { polledByJob.set(entry.jobId, await getParseJob({ jobId: entry.jobId })); }
    catch { /* a status hiccup — try again on the next poll */ }
  }));

  const saved = [];
  let changed = false;
  for (const entry of batch.jobs) {
    if (entry.state !== "pending") continue;
    const polled = polledByJob.get(entry.jobId);
    if (!polled) continue;
    const settled = settleParseJob(polled, { submittedAt: batch.submittedAt });
    if (settled.state === "pending") continue;
    changed = true;
    if (settled.state === "saved") {
      await saveExtractionPage({ contentKey, pageNumber: entry.pageNumber, blocks: settled.blocks, markdown: settled.markdown, model: settled.model, size: entry.size || null });
      entry.state = settled.blank ? "blank" : "saved";
      saved.push({ pageNumber: entry.pageNumber, markdown: settled.markdown, model: settled.model, blocks: settled.blocks, blank: settled.blank });
    } else {
      entry.state = "failed";
      entry.error = settled.error;
      if (settled.rawPreview) entry.rawPreview = settled.rawPreview;
    }
  }

  const pending = batch.jobs.filter((j) => j.state === "pending").map((j) => j.pageNumber);
  const failed  = batch.jobs.filter((j) => j.state === "failed").map(({ pageNumber, error, rawPreview }) => ({ pageNumber, error, ...(rawPreview ? { rawPreview } : {}) }));
  const done = pending.length === 0;
  if (done) {
    const ok = batch.jobs.filter((j) => j.state === "saved" || j.state === "blank").length;
    await finishContentJob(contentKey, "parse", ok ? "done" : "failed", { ...batch, pages: ok });
  } else if (changed) {
    await updateContentJob(contentKey, "parse", batch);
  }
  // Search index for the pages this poll saved — never blocks the reply.
  if (saved.length) void indexByContentKey({ contentKey, pages: saved });
  okExtract(res, { contentKey, done, pages: saved, pending, failed });
}

/*
 * POST /extract/text { recordId | contentKey } — read a file's text into
 * pages on the server: a PDF's text layer, a text file, Word / PowerPoint
 * (/extract/office is the same route, kept for the app's first callers).
 * Normally done at upload or by the backfill; this is the retry and the
 * reader's "not read yet" path. Needs no GPU: it runs inline and answers
 * with the extraction, 202 while another run holds the file's claim, or
 * 422 { scanned } for a scan (that's the tap-to-extract offer's job).
 * Reading a shared file's text fills the shared cache from the STORED
 * bytes, never from anything the caller sends.
 */
export async function extractText(req, res) {
  const id = await resolveAiContent(req);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  if (!storedTextKindOf(id.mime, id.name)) return res400(res, "Only PDFs, text files and Word / PowerPoint files are read this way.");
  const existing = await getExtraction(id.contentKey);
  if (existing.pages.length) return okExtract(res, { ...existing, done: true });
  const fileUrl = await createPresignedDownload(id.contentKey, { downloadName: id.name });
  const out = await extractStoredText({ userId: req.user.id, contentKey: id.contentKey, name: id.name, mime: id.mime, fileUrl });
  if (out.status === "running") return res.status(202).json({ success: true, data: { running: true, done: false, pages: [] } });
  if (out.status === "scanned") return res.status(422).json({ success: false, scanned: true, message: "This PDF is a scan — use Extract text in the reader to read it." });
  if (out.status === "failed") return res.status(422).json({ success: false, message: out.error || "Could not read this file." });
  okExtract(res, { ...(await getExtraction(id.contentKey)), done: true });
}

export async function getRecordExtraction(req, res) {
  const recordId = String(req.params.recordId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res400(res, "A recordId is required.");
  const { data: rec, error } = await store.getRecordFileForOwner(recordId, req.user.id);
  if (error) throw error;
  if (!rec) return res.status(404).json({ success: false, message: "Record not found." });
  okExtract(res, rec.file_key ? await getExtraction(rec.file_key) : { pages: [], markdown: "" });
}

export async function getContentExtraction(req, res) {
  const contentKey = String(req.params.key || "");
  if (!contentKey) return res400(res, "A content key is required.");
  const probe = { ...req, body: { contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  okExtract(res, await getExtraction(id.contentKey));
}
