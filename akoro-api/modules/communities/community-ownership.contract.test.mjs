/**
 * Phase 15 item 6 (ownership audit, 2026-11-01): a community's member list is
 * for its members, its analytics for its creator, and a private community's
 * activities for its members. All three used to answer any signed-in user.
 *
 * Phase 19 step 4: the handler bodies moved to service.js (flows) and the
 * membership query to store.js; the gates themselves are the pure predicates
 * in rules.js. These pins follow the code, not a file name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const serviceSrc = read("./service.js");
const discussionsSrc = read("./discussions.js");
const flowSrc = [serviceSrc, discussionsSrc].join("\n");
const storeSrc = read("./store.js");
const rulesSrc = read("./rules.js");

const HANDLERS = {
  "/:id/members": "listMembers",
  "/:id/analytics": "getAnalytics",
  "/:id/activities": "listActivities",
  "/:id/discussion/messages": "getDiscussionMessages",
  "/:id/items": "listItems",
};
const route = (path) => {
  const name = HANDLERS[path];
  const at = flowSrc.indexOf(`export async function ${name}(`);
  assert.ok(at >= 0, `${path} → ${name}() found`);
  return flowSrc.slice(at, flowSrc.indexOf("\n}\n", at));
};

test("isMember reads the caller's own membership row", () => {
  assert.match(storeSrc, /async function isMember\(communityId, userId\)[\s\S]*?\.eq\("community_id", communityId\)\.eq\("user_id", userId\)/);
});

test("members: members only", () => {
  const body = route("/:id/members");
  assert.match(body, /if \(!\(await isMember\(c\.id, req\.user\.id\)\)\) return denied\(/);
  assert.ok(body.indexOf("isMember") < body.indexOf("readMembers("), "checked before the list is read");
});

test("analytics: the creator only", () => {
  const body = route("/:id/analytics");
  assert.match(body, /if \(!isOwner\(c, req\.user\.id\)\) return denied\(/);
  assert.ok(body.indexOf("isOwner") < body.indexOf("listActivityNames("), "checked before submissions are read");
});

test("activities: a private community's are for its members", () => {
  const body = route("/:id/activities");
  assert.match(body, /if \(requiresMembership\(c\) && !\(await isMember\(c\.id, req\.user\.id\)\)\)/);
  assert.match(rulesSrc, /export const requiresMembership = \(community\) => !community\?\.is_public;/);
});

test("the discussion and shared items keep their membership checks", () => {
  assert.match(route("/:id/discussion/messages"),
    /discussionReadMembership\(c\.id, req\.user\.id\)[\s\S]*?if \(!mem\) return denied\(/);
  assert.match(route("/:id/items"),
    /readMembership\(c\.id, req\.user\.id\)[\s\S]*?if \(!mem\) return denied\(/);
  assert.match(storeSrc, /from\("community_members"\)[\s\S]*?\.eq\("user_id", userId\)/);
});
