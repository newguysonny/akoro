/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a training run (its live
 * stream, logs, insights, status and export carry the uploaded material) is
 * its teacher's or an admin's. Any run id used to answer anyone signed in.
 * Phase 19 step 4 moved the routes to routes.js; the entry still exports them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");

test("ownRun refuses someone else's run as not found", () => {
  assert.match(src, /function ownRun\(req, res\) \{\s*const run = runs\.get\(req\.params\.runId\);\s*if \(!run \|\| \(run\.teacherId !== req\.user\.id && req\.user\.role !== "admin"\)\) \{\s*res\.status\(404\)/);
});

test("every /run/:runId route goes through ownRun", () => {
  for (const path of ["stream", "logs", "insights", "status", "export"]) {
    const at = src.indexOf(`router.get("/run/:runId/${path}"`);
    assert.ok(at >= 0, path);
    const head = src.slice(at, at + 200);
    assert.match(head, /const run = ownRun\(req, res\);\s*if \(!run\) return;/, path);
  }
  assert.equal((src.match(/runs\.get\(req\.params\.runId\)/g) || []).length, 1, "only ownRun reads a run by its id");
});
