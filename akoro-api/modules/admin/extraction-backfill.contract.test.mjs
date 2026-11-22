// The admin extraction backfill is an ops tool: if the route, the job poller,
// or the "free text first" rule silently disappears, an outage goes unnoticed
// until records pile up unread. These are source contracts, not DB tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = path.join(HERE, "..", "..");
const read = (...p) => readFileSync(path.join(API, ...p), "utf8");

test("the admin console can dry-run and start/read an extraction backfill", () => {
  const routes = read("modules", "admin", "routes.js");
  assert.match(routes, /post\("\/records\/extractions\/backfill",\s*adminOnly/);
  assert.match(routes, /get\("\/records\/extractions\/backfill\/:jobId",\s*adminOnly/);
  const maintenance = read("modules", "admin", "maintenance.js");
  assert.match(maintenance, /export async function backfillExtractions/);
  assert.match(maintenance, /dryRun/);
});

test("the backfill reads text layers free before paying an engine lane", () => {
  const src = read("modules", "records", "extractionBackfill.js");
  const one = /async function extractOne[\s\S]*?\n\}/.exec(src)?.[0] || "";
  assert.ok(one.indexOf("extractStoredText") < one.indexOf('engine === "ocr"'), "free stored-text read must come first");
  for (const lane of ["ocr", "model", "runpod"]) assert.ok(one.includes(lane), `missing ${lane} lane`);
  assert.match(src, /claimContentJob/, "paid lanes must claim the file");
  assert.match(src, /indexByContentKey\(\{ contentKey, pages: out\.pages, bill: false \}\)/, "backfill indexing is unmetered");
});
