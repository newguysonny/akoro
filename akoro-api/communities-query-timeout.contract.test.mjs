import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * No communities query may outlive its request.
 *
 * Live catch: the community details page "kept loading with no data
 * arriving" while unauthenticated probes of the same routes answered
 * instantly — a wedged database call never rejects, so the HTTP request
 * stays pending forever and the learner stares at a skeleton. Every
 * communities read now races a deadline: past it the route answers 504
 * at once and the step that hung is named in the server logs.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const routes = await read("modules/communities/routes.js");

test("a step() helper races every query against a deadline", () => {
  assert.match(routes, /const QUERY_TIMEOUT_MS = 20000;/);
  assert.match(routes, /function step\(label, promise\) \{/);
  // The losing query's late failure is swallowed on purpose.
  assert.match(routes, /promise\.catch\(\(\) => \{\}\);   \/\/ it lost the race — a late failure is not news/);
  // The hang is NAMED in the logs — this is what turns the next occurrence
  // from "frontend bug?" into a one-line diagnosis.
  assert.match(routes, /console\.error\("\[communities\] query timed out", \{ step: label, ms: QUERY_TIMEOUT_MS \}\);/);
  assert.match(routes, /err\.deadlineExceeded = true;/);
});

test("every read behind the details page runs under a named step", () => {
  for (const label of ["findCommunity", "memberCounts", "userNames", "activitySubmissions", "myMembership", "activities", "mySubmissions"]) {
    assert.match(routes, new RegExp("step\\(\"" + label + "\", "), 'step("' + label + '", …)');
  }
});

test("a deadline-exceeded query answers 504, not an eternal pending request", () => {
  assert.match(routes, /if \(!err\?\.deadlineExceeded\) return next\(err\);/);
  assert.match(routes, /res\.status\(504\)\.json\(\{/);
  assert.match(routes, /code: "COMMUNITIES_QUERY_TIMEOUT",/);
  assert.match(routes, /step: err\.step,/);
});

test("db errors surface instead of masquerading as \"not found\" or a bare TypeError", () => {
  // findCommunity: a schema error must reach the 503 handler, not read as 404.
  assert.match(routes, /if \(error\) throw communityDbError\(error, "load this community"\);/);
  assert.match(routes, /if \(error\) throw communityDbError\(error, "load member counts"\);/);
  assert.match(routes, /if \(error\) throw communityDbError\(error, "load names"\);/);
  // withActivityExtras: the builder resolves (never rejects) with { data, error };
  // the error used to be ignored and `for (const s of subs)` then threw a
  // TypeError (a 500) instead of reaching the schema-pending 503.
  assert.match(routes, /if \(subs\?\.error\) throw communityDbError\(subs\.error, "load these activities"\);/);
  assert.match(routes, /for \(const s of subs\?\.data \|\| \[\]/);
});
