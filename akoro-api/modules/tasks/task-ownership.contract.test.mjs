/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a task's runs and outputs are
 * its creator's, like the task itself. They used to answer for any task id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const route = (path) => {
  const at = src.indexOf(`router.get("${path}"`);
  assert.ok(at >= 0, `${path} found`);
  return src.slice(at, src.indexOf("\n});", at));
};

test("runs and outputs load the task and refuse anyone but its creator", () => {
  for (const path of ["/:taskId/runs", "/:taskId/outputs"]) {
    const body = route(path);
    assert.match(body, /const task = await TaskDB\.findById\(req\.params\.taskId\);\s*if \(!task \|\| task\.creator_id !== req\.user\.id\) return res\.status\(404\)/, path);
    assert.match(body, /listByTask\(task\.id\)/, `${path} lists by the checked task`);
    assert.doesNotMatch(body, /listByTask\(req\.params\.taskId\)/, `${path} never lists by the raw id`);
  }
});

test("every other /:taskId route keeps its creator check", () => {
  const checks = src.match(/task\.creator_id !== req\.user\.id/g) || [];
  assert.ok(checks.length >= 8, `creator checks on get, patch, delete, trigger, runs, outputs, toggle, create-challenge (found ${checks.length})`);
});
