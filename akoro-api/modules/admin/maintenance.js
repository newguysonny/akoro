// Admin maintenance actions that would otherwise need a shell on the host.
//
// The first is the document-preview backfill: render page 1 for every upload
// whose row has no preview yet (pdfjs + napi canvas, in modules/records).
// Batched on purpose — the page runs it again until `remaining` is 0, so the
// request never sits long enough for a proxy to cut it.
import {
  listRecordsMissingPreview, countRecordsMissingPreview, generatePreviewForRecord,
} from "../records/index.js";

const MAX_BATCH = 50;

export async function backfillPreviews(req, res) {
  const dryRun = !!req.body?.dryRun;
  const requested = Number(req.body?.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_BATCH, Math.floor(requested)) : MAX_BATCH;

  let rows;
  try {
    rows = await listRecordsMissingPreview(limit);
  } catch (err) {
    console.error("[admin/previews] could not list records:", err?.message || err);
    return res.status(400).json({ success: false, message: "Could not read the records table." });
  }

  let written = 0;
  let failed = 0;
  for (const row of rows) {
    if (dryRun) continue;
    // A render is ~200 ms; a batch of 50 stays well inside a normal request.
    const key = await generatePreviewForRecord(row);
    if (key) written += 1; else failed += 1;
  }

  const remaining = await countRecordsMissingPreview();
  return res.status(200).json({ success: true, data: { dryRun, scanned: rows.length, written, failed, remaining } });
}
