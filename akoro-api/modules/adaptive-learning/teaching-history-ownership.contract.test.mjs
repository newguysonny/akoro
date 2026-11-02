/** Ownership audit (Phase 15 item 6): a teaching transcript is only its learner's own. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("GET /sessions/:sessionId/history refuses another learner's session", () => {
  const src = readFileSync(new URL("./teachingSession.js", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('router.get("/sessions/:sessionId/history"'));
  assert.match(route.slice(0, 600), /if \(!session \|\| session\.student_id !== req\.user\.id\) return res\.status\(404\)/);
});
