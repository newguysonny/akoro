// Admin maintenance actions that would otherwise need a shell on the host.
//
// The first is the document-preview backfill: render page 1 for every upload
// whose row has no preview yet (pdfjs + napi canvas, in modules/records).
// Batched on purpose — the page runs it again until `remaining` is 0, so the
// request never sits long enough for a proxy to cut it.
import {
  listRecordsMissingPreview, countRecordsMissingPreview, generatePreviewForRecord,
} from "../records/index.js";
import { getExtractEngine, setExtractEngine, extractModelId } from "../records/index.js";

const MAX_BATCH = 50;

export async function backfillPreviews(req, res) {
 try {
  const dryRun = !!req.body?.dryRun;
  const requested = Number(req.body?.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_BATCH, Math.floor(requested)) : MAX_BATCH;

  let rows;
  try {
    rows = await listRecordsMissingPreview(limit);
  } catch (err) {
    console.error("[admin/previews] could not list records:", err?.message || err);
    // Surfaced to the admin console: this is an ops tool, and a generic "could
    // not read" hides the actual PostgREST error from the person running it.
    return res.status(400).json({ success: false, message: `Could not read the records table: ${err?.message || err}` });
  }

  let written = 0;
  let failed = 0;
  const failures = [];
  for (const row of rows) {
    if (dryRun) continue;
    // A render is ~200 ms; a batch of 50 stays well inside a normal request.
    let reason = null;
    const key = await generatePreviewForRecord(row, (err) => { reason = err?.message || String(err); });
    if (key) written += 1;
    else { failed += 1; if (failures.length < 5) failures.push({ id: row.id, name: row.name, reason }); }
  }

  let remaining = 0;
  try { remaining = await countRecordsMissingPreview(); }
  catch (err) { console.error("[admin/previews] count failed:", err?.message || err); }

  return res.status(200).json({ success: true, data: { dryRun, scanned: rows.length, written, failed, remaining, failures } });
 } catch (err) {
   console.error("[admin/previews] backfill failed:", err?.stack || err);
   return res.status(500).json({ success: false, message: String(err?.message || err) });
 }
}

/* GET /api/admin/records/extract-engine — which parser runs, and on which model. */
export async function readExtractEngine(req, res) {
  try {
    const engine = await getExtractEngine();
    return res.status(200).json({ success: true, data: { engine, model: extractModelId() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}

/* PUT /api/admin/records/extract-engine { engine: runpod|model } */
export async function writeExtractEngine(req, res) {
  try {
    const engine = await setExtractEngine(req.body?.engine, req.user?.id || null);
    return res.status(200).json({ success: true, data: { engine, model: extractModelId() } });
  } catch (err) {
    return res.status(400).json({ success: false, message: String(err?.message || err) });
  }
}
