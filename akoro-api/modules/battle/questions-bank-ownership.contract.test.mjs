/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a course's question bank —
 * answers included — is read and written by that course's teacher (or an
 * admin, or the school admin over the teacher), not by every instructor.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");

test("the bank guard asks canRunCourseBattles for the course's teacher", () => {
  assert.match(src, /const requireBankOwner = asyncHandler\(async \(req, res, next\) => \{\s*const \{ isInstructor \} = await canRunCourseBattles\(req\.user\.id, req\.user\.role, req\.params\.courseId\);\s*if \(!isInstructor\) return res403/);
});

test("every :courseId bank route runs the guard", () => {
  for (const [method, path] of [["get", "/courses/:courseId/questions-bank"], ["post", "/courses/:courseId/questions-bank"], ["post", "/courses/:courseId/questions-bank/generate"]]) {
    assert.ok(src.includes(`router.${method}("${path}", authenticateToken, requireRole(["instructor", "admin"]), requireBankOwner, asyncHandler(`), `${method} ${path}`);
  }
});

test("editing or retiring one question stays scoped to its author", () => {
  assert.match(src, /update\(updates\)\.eq\("id", req\.params\.questionId\)\.eq\("created_by", req\.user\.id\)/);
  assert.match(src, /update\(\{ is_active: false \}\)\.eq\("id", req\.params\.questionId\)\.eq\("created_by", req\.user\.id\)/);
});
