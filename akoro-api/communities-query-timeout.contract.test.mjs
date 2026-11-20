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
 *
 * Phase 19 step 4 split the module: router/middleware in routes.js, flows in
 * service.js, Supabase in store.js. These pins read the whole module so the
 * wiring stays honest wherever a given line lives.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [routes, service, rules, store] = await Promise.all([
  read("modules/communities/routes.js"),
  read("modules/communities/service.js"),
  read("modules/communities/rules.js"),
  read("modules/communities/store.js"),
]);
const moduleSrc = [routes, service, rules, store].join("\n");

test("a step() helper races every query against a deadline", async () => {
  // step() now lives in lib/queryDeadline.js — extracted after the timer
  // callback was caught crashing on supabase's bare-thenable builders
  // (`promise.catch is not a function` thrown BEFORE the reject, wedging
  // the request forever: the deadline itself was the communities hang).
  // The behavioural proof is in modules/communities/queryDeadline.test.mjs;
  // these pins keep the wiring honest.
  const lib = await read("lib/queryDeadline.js");
  assert.match(store, /import \{ step \}\s+from "\.\.\/\.\.\/lib\/queryDeadline\.js";/);
  assert.match(routes, /import \{ DEFAULT_QUERY_TIMEOUT_MS \}\s+from "\.\.\/\.\.\/lib\/queryDeadline\.js";/);
  assert.match(lib, /export function step\(label, promise, ms = DEFAULT_QUERY_TIMEOUT_MS\)/);
  assert.match(lib, /export const DEFAULT_QUERY_TIMEOUT_MS = 20_000;/);
  // The guard: attaching the losing promise's failure handler can never
  // throw inside the timer callback — a bare thenable has no .catch.
  assert.match(lib, /promise\?\.catch\?\.\(\(\) => \{\}\);/);
  // The hang is NAMED in the logs — this is what turns the next occurrence
  // from "frontend bug?" into a one-line diagnosis.
  assert.match(lib, /query timed out", \{ step: label, ms \}\);/);
  assert.match(lib, /err\.deadlineExceeded = true;/);
  // And the poisoned pattern must not return to the module family.
  assert.doesNotMatch(moduleSrc, /promise\.catch\(/);
});

test("every read behind the details page runs under a named step", () => {
  for (const label of ["findCommunity", "memberCounts", "userNames", "activitySubmissions", "myMembership", "activities", "mySubmissions"]) {
    assert.match(moduleSrc, new RegExp("step\\(\"" + label + "\", "), 'step("' + label + '", …)');
  }
});

test("/health proves the deadline code is deployed (build identity)", async () => {
  const app = await read("app.js");
  // The constant is exported from the module and surfaced by /health, so a
  // stale or rolled-back deploy is detectable without server access.
  assert.match(routes, /export const COMMUNITIES_QUERY_TIMEOUT_MS = DEFAULT_QUERY_TIMEOUT_MS;/);
  assert.match(app, /import communitiesModule, \{ COMMUNITIES_QUERY_TIMEOUT_MS \} from \"\.\/modules\/communities\/routes\.js\";/);
  assert.match(app, /git: process\.env\.RENDER_GIT_COMMIT \|\| null,/);
  assert.match(app, /modules: \{ communities: \{ queryDeadlineMs: COMMUNITIES_QUERY_TIMEOUT_MS \} \},/);
});

test("a deadline-exceeded query answers 504, not an eternal pending request", () => {
  assert.match(routes, /if \(!err\?\.deadlineExceeded\) return next\(err\);/);
  assert.match(routes, /res\.status\(504\)\.json\(\{/);
  assert.match(routes, /code: "COMMUNITIES_QUERY_TIMEOUT",/);
  assert.match(routes, /step: err\.step,/);
});

test("db errors surface instead of masquerading as \"not found\" or a bare TypeError", () => {
  // findCommunity: a schema error must reach the 503 handler, not read as 404.
  assert.match(moduleSrc, /if \(error\) throw communityDbError\(error, "load this community"\);/);
  assert.match(moduleSrc, /if \(error\) throw communityDbError\(error, "load member counts"\);/);
  assert.match(moduleSrc, /if \(error\) throw communityDbError\(error, "load names"\);/);
  // withActivityExtras: the builder resolves (never rejects) with { data, error };
  // the error used to be ignored and iterating it then threw a TypeError (a 500)
  // instead of reaching the schema-pending 503.
  assert.match(moduleSrc, /if \(subs\?\.error\) throw communityDbError\(subs\.error, "load these activities"\);/);
  assert.match(moduleSrc, /for \(const s of subs\?\.data \|\| \[\]/);
});
