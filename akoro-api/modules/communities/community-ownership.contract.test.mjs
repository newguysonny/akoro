/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a community's member list is
 * for its members, its analytics for its creator, and a private community's
 * activities for its members. All three used to answer any signed-in user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const route = (path) => {
  const at = src.indexOf(`router.get("${path}"`);
  assert.ok(at >= 0, `${path} found`);
  return src.slice(at, src.indexOf("\n}));", at));
};

test("isMember reads the caller's own membership row", () => {
  assert.match(src, /async function isMember\(communityId, userId\)[\s\S]*?\.eq\("community_id", communityId\)\.eq\("user_id", userId\)/);
});

test("members: members only", () => {
  const body = route("/:id/members");
  assert.match(body, /if \(!\(await isMember\(c\.id, req\.user\.id\)\)\) return denied\(/);
  assert.ok(body.indexOf("isMember") < body.indexOf("\"user_id, role, joined_at\""), "checked before the list is read");
});

test("analytics: the creator only", () => {
  const body = route("/:id/analytics");
  assert.match(body, /if \(c\.owner_id !== req\.user\.id\) return denied\(/);
  assert.ok(body.indexOf("owner_id !== req.user.id") < body.indexOf("community_activity_submissions"), "checked before submissions are read");
});

test("activities: a private community's are for its members", () => {
  assert.match(route("/:id/activities"), /if \(!c\.is_public && !\(await isMember\(c\.id, req\.user\.id\)\)\) return denied\(/);
});

test("the discussion and shared items keep their membership checks", () => {
  for (const path of ["/:id/discussion/messages", "/:id/items"]) {
    assert.match(route(path), /community_members[\s\S]*?\.eq\("user_id", req\.user\.id\)[\s\S]*?if \(!mem\) return denied\(/, path);
  }
});
