#!/usr/bin/env node
/**
 * Compare the two extraction engines on one PDF.
 *
 *   node scripts/compare-extract-engines.mjs --file path/to.pdf [--pages 1-5] [--model claude-haiku]
 *
 * Renders the pages server-side (same rasteriser as previews), then runs:
 *   · the vision-model lane (lib/aiModel → RECORDS_EXTRACT_MODEL)
 *   · the RunPod lane (RUNPOD_API_KEY + RUNPOD_PARSE_ENDPOINT_ID)
 * and reports timing plus how similar the two markdowns are: page count,
 * characters, word overlap (Jaccard), GFM table rows and [unreadable] markers.
 * Needs the providers' env keys; it is the evidence used before switching the
 * platform default (admin → Settings → Document extraction).
 */
import { readFileSync } from "node:fs";
import { renderPdfPages } from "../modules/records/preview.js";
import { parsePagesWithModel } from "../modules/records/extractModel.js";
import { parsePageOnRunpod } from "../modules/records/extractLib.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.startsWith("--file="))?.split("=")[1]
  || (args.includes("--file") ? args[args.indexOf("--file") + 1] : null);
const model = args.find((a) => a.startsWith("--model="))?.split("=")[1] || process.env.RECORDS_EXTRACT_MODEL || "claude-haiku";
const range = args.find((a) => a.startsWith("--pages="))?.split("=")[1] || "1-5";
const [from, to] = range.split("-").map((n) => Number(n) || 1);

if (!file) { console.error("usage: --file path/to.pdf [--pages 1-5] [--model claude-haiku]"); process.exit(1); }

const tokens = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const jaccard = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size && !B.size) return 1;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / (A.size + B.size - shared);
};
const tableRows = (md) => String(md).split("\n").filter((l) => l.trim().startsWith("|")).length;
const unreadable = (md) => (String(md).match(/\[unreadable\]/gi) || []).length;

const pages = await renderPdfPages(readFileSync(file), { from, to, width: 1200 });
console.log(`rendered ${pages.length} page(s) from ${file}`);

const tModel = Date.now();
const modeled = await parsePagesWithModel({
  pages: pages.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString("base64") })),
  userId: null, model,
});
const modelMs = Date.now() - tModel;

const tRun = Date.now();
const runpod = [];
for (const p of pages) {
  try {
    const r = await parsePageOnRunpod({ imageBase64: p.jpeg.toString("base64") });
    runpod.push({ pageNumber: p.pageNumber, markdown: r.markdown });
  } catch (err) {
    runpod.push({ pageNumber: p.pageNumber, error: err?.message || String(err) });
  }
}
const runpodMs = Date.now() - tRun;

let modelChars = 0, runpodChars = 0;
const rows = [];
for (const page of pages) {
  const a = modeled.find((m) => m.pageNumber === page.pageNumber) || {};
  const b = runpod.find((m) => m.pageNumber === page.pageNumber) || {};
  modelChars += (a.markdown || "").length;
  runpodChars += (b.markdown || "").length;
  rows.push({
    page: page.pageNumber,
    overlap: a.markdown && b.markdown ? jaccard(a.markdown, b.markdown).toFixed(2) : "—",
    modelChars: (a.markdown || "").length,
    runpodChars: (b.markdown || "").length,
    modelTables: tableRows(a.markdown || ""),
    runpodTables: tableRows(b.markdown || ""),
    unreadableModel: unreadable(a.markdown || ""),
    "...": (a.error || b.error) ? (a.error || b.error) : "",
  });
}

console.table(rows);
console.log(`model lane: ${modelMs} ms, ${modelChars} chars, model=${model}`);
console.log(`runpod lane: ${runpodMs} ms, ${runpodChars} chars`);
const overlaps = rows.map((r) => Number(r.overlap)).filter((n) => Number.isFinite(n));
if (overlaps.length) console.log(`mean word overlap: ${(overlaps.reduce((a, b) => a + b, 0) / overlaps.length).toFixed(2)}`);
