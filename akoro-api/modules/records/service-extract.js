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
import { createPresignedDownload, readFileObject } from "./lib/storage.js";
import {
  recordsExtractionEnabled, parsePageRunAsync, getParseJob, settleParseJob, saveExtractionPage,
  getExtraction, claimContentJob, finishContentJob, updateContentJob, getContentJob,
  MAX_PAGES_PER_REQUEST, MAX_RECORD_PAGES, MAX_IMAGE_B64_CHARS,
} from "./extractLib.js";
import { indexByContentKey } from "./searchLib.js";
import { getExtractEngine, extractModelId } from "./extractEngine.js";
import { parsePagesWithModel } from "./extractModel.js";
import { runDeepseekOcr, ocrConfigured } from "./extractOcr.js";
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
  try { return await submitExtractInner(req, res); }
  catch (err) {
    console.error("[extract] submit failed:", err?.stack || err);
    return res.status(500).json({ success: false, error: `Extraction failed: ${err?.message || err}` });
  }
}

async function submitExtractInner(req, res) {
  if (!recordsExtractionEnabled()) {
    return res.status(501).json({ success: false, error: "Text extraction isn't configured on this deployment yet." });
  }
  const id = await resolveAiContent(req);
  if (id.error !== undefined || id.status) return res.status(id.status).json({ success: false, message: id.message });
  const { contentKey } = id;

  let engine;
  try { engine = await getExtractEngine(); }
  catch (err) {
    console.error("[extract] engine read failed:", err?.stack || err);
    return res.status(500).json({ success: false, error: `Could not read the extraction engine: ${err?.message || err}` });
  }

  if (engine === "ocr") {
    // Whole document, server-side: no page images from the client, and the
    // pages carry layout boxes (0-1000) so citations keep their geometry.
    if (!ocrConfigured()) return res.status(501).json({ success: false, error: "DeepSeek OCR is not configured (DEEPSEEK_API_KEY)." });
    const rec = req.body?.recordId
      ? (await store.getRecordWithFile(req.body.recordId)).data
      : (await store.getRecordByFileKey(contentKey)).data;
    if (!rec?.file_key) return res400(res, "This record has no stored file to recognise.");
    let claimed;
    try { claimed = await claimContentJob(contentKey, "parse", req.user.id); }
    catch (err) { return res.status(500).json({ success: false, error: `Could not claim the file: ${err?.message || err}` }); }
    if (!claimed) return res.status(409).json({ success: false, error: "This file is being extracted right now — the shared result will appear in a moment.", job: await getContentJob(contentKey, "parse") });

    const batch = { mode: "ocr", model: "deepseek-ocr", submittedAt: new Date().toISOString(), jobs: [{ pageNumber: 1, state: "pending" }] };
    await updateContentJob(contentKey, "parse", batch);
    void (async () => {
      try {
        const { body } = await readFileObject(rec.file_key);
        const out = await runDeepseekOcr({ buffer: body, filename: rec.name || "document.pdf" });
        await saveExtractionPages(contentKey, out.pages, out.model);
        void indexByContentKey({ contentKey, pages: out.pages });
        await finishContentJob(contentKey, "parse", "done", { mode: "ocr", model: out.model, pages: out.pages.length });
      } catch (err) {
        console.error("[extract/ocr] failed:", err?.stack || err);
        await finishContentJob(contentKey, "parse", "failed", { mode: "ocr", error: String(err?.message || err) });
      }
    })();
    return res.status(202).json({ success: true, data: { contentKey, pending: [1], failed: [], model: "deepseek-ocr" } });
  }

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
  let claimed;
  try { claimed = await claimContentJob(contentKey, "parse", req.user.id); }
  catch (err) {
    console.error("[extract] claim failed:", err?.stack || err);
    return res.status(500).json({ success: false, error: `Could not claim the file: ${err?.message || err}` });
  }
  if (!claimed) {
    return res.status(409).json({ success: false, error: "This file is being extracted right now — the shared result will appear in a moment.", job: await getContentJob(contentKey, "parse") });
  }

  // Direct-model lane: one vision call per page, same saved rows and claim as
  // the RunPod lane, so the reader's contract is unchanged. Bounded
  // concurrency; failures ride back per page.
  if (engine === "model") {
   try {
    // Asynchronous, like the RunPod lane: the request saves the batch and
    // returns, the pages parse in the background, and the reader polls status.
    // Parsing inline hit the edge timeout on 16-page batches (502) and left the
    // single-flight claim running, which then answered 409 to every retry.
    const model = extractModelId();
    const batch = {
      mode: "model", model, submittedAt: new Date().toISOString(),
      jobs: work.map((w) => ({ pageNumber: w.pageNumber, state: "pending", size: w.size || null })),
    };
    await updateContentJob(contentKey, "parse", batch);

    void (async () => {
      let saved = 0, failed = 0;
      try {
        // Extraction is platform cost (the RunPod lane never charged the learner), so
        // no coin wallet is debited and a learner with zero coins can still read.
        const results = await parsePagesWithModel({
          pages: work, userId: null, model,
          pagesPerCall: Number(process.env.RECORDS_EXTRACT_PAGES_PER_CALL || 1),
        });
        for (const r of results) {
          const entry = batch.jobs.find((j) => j.pageNumber === r.pageNumber);
          if (r.error) { entry.state = "failed"; entry.error = r.error; failed += 1; continue; }
          try {
            await saveExtractionPage({
              contentKey, pageNumber: r.pageNumber, blocks: [], markdown: r.markdown,
              model: r.model, size: r.size || null,
            });
            entry.state = "saved";
            saved += 1;
          } catch (err) {
            entry.state = "failed";
            entry.error = `could not save the page: ${err?.message || err}`;
            failed += 1;
          }
        }
      } catch (err) {
        console.error("[extract/model] batch failed:", err?.stack || err);
        for (const entry of batch.jobs) if (entry.state === "pending") { entry.state = "failed"; entry.error = String(err?.message || err); failed += 1; }
      } finally {
        await finishContentJob(contentKey, "parse", saved ? "done" : "failed", { ...batch, pages: saved, failed });
        if (saved) {
          const pages = batch.jobs.filter((j) => j.state === "saved").map((j) => ({ pageNumber: j.pageNumber }));
          void indexByContentKey({ contentKey, pages });
        }
      }
    })();

    return res.status(202).json({
      success: true,
      data: { contentKey, pending: work.map((w) => w.pageNumber), failed: [], model },
    });
   } catch (err) {
     console.error("[extract/model] submit failed:", err?.stack || err);
     try { await finishContentJob(contentKey, "parse", "failed", { mode: "model", error: String(err?.message || err) }); } catch {}
     return res.status(500).json({ success: false, error: `The vision lane could not start: ${err?.message || err}` });
   }
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
  // OCR lane: one server-side recognition; pending until the job record ends.
  if (job?.result?.mode === "ocr") {
    const running = job.status === "running";
    const failed = job.result?.error ? [{ pageNumber: 1, error: job.result.error }] : [];
    return okExtract(res, { contentKey, done: !running, pages: [], pending: running ? [1] : [], failed });
  }
  // Model lane: pages are saved by the background run; status only reports.
  if (job?.result?.mode === "model") {
    const mb = job.result;
    const pending = (mb.jobs || []).filter((j) => j.state === "pending").map((j) => j.pageNumber);
    const failures = (mb.jobs || []).filter((j) => j.state === "failed")
      .map(({ pageNumber, error }) => ({ pageNumber, error: error || "page failed" }));
    const done = pending.length === 0 && job.status !== "running";
    return okExtract(res, { contentKey, done, pages: [], pending, failed: failures });
  }
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
