// The config-driven merged domains (rollout beyond library + chats, Matt's
// order 2026-11-15). The factory's def/delta/coverage shapes, the per-domain
// configs as they land, and the generic wiring in pipeline.js + chat.js.
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MERGED_DOMAINS, MERGED_DOMAIN_LIST } from "./mergedDomains.js";
import { presentMergedToolRow } from "./pipeline.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("tasks config: merged set, order and sides", () => {
  const c = MERGED_DOMAINS.my_tasks;
  assert.equal(c.view, "my_tasks");
  assert.equal(c.area, "plans");
  assert.deepEqual(c.mergedActions, ["count", "by_status", "search", "list"]);
  assert.deepEqual(c.actionOrder, ["count", "list", "by_status", "search"]);
  const def = c.def();
  assert.equal(def.function.name, "my_tasks");
  assert.deepEqual(def.function.parameters.properties.action.enum, ["count", "list", "by_status", "search"]);
  assert.match(def.function.description, /taskId/);
});

test("delta extends the enum; coverage is exact; delta computation drops off actions", () => {
  const c = MERGED_DOMAINS.my_tasks;
  assert.deepEqual(c.def({ delta: ["by_priority"] }).function.parameters.properties.action.enum,
    ["count", "list", "by_status", "search", "by_priority"]);
  assert.equal(c.buildIsCovered(["count", "list"]), true);
  assert.equal(c.buildIsCovered(["count", "by_priority"]), false);
  assert.equal(c.buildIsCovered([]), false);
  assert.deepEqual(c.deltaActions({ actions: ["count", "list", "by_priority"], disabled_actions: [] }), ["by_priority"]);
  assert.deepEqual(c.deltaActions({ actions: ["count", "list", "by_priority"], disabledActions: ["by_priority"] }), []);
});

test("every merged domain has its own kill switch, default on", () => {
  for (const c of MERGED_DOMAIN_LIST) {
    const before = process.env[c.envVar];
    delete process.env[c.envVar];
    assert.equal(c.enabled(), true, c.name);
    process.env[c.envVar] = "false";
    assert.equal(c.enabled(), false, c.name);
    if (before === undefined) delete process.env[c.envVar]; else process.env[c.envVar] = before;
  }
});

test("My tools presentation covers the generic domains", () => {
  assert.equal(presentMergedToolRow({ domain: "my_tasks", actions: ["count", "list", "search"], disabled_actions: [] }), null);
  const shown = presentMergedToolRow({ domain: "my_tasks", actions: ["count", "list", "by_priority"], disabled_actions: [] });
  assert.deepEqual(shown.actions, ["by_priority"]);
});

test("wiring: pipeline guard loop, generic runners, registry", () => {
  const src = read("./pipeline.js");
  assert.match(src, /MERGED_DOMAIN_LIST\.find\(\(c\) => c\.view === spec\.view && c\.enabled\(\)\)/);
  assert.match(src, /export async function getMergedToolState/);
  assert.match(src, /export async function runMergedViewAction/);
  assert.match(src, /MERGED_DOMAIN_LIST\.map\(\(c\) => \(\{ domain: c\.view, mergedActions: c\.mergedActions, enabled: c\.enabled \}\)\)/);
});

test("wiring: chat.js assembles and dispatches merged domains generically", () => {
  const src = read("../adaptive-learning/chat.js");
  assert.match(src, /async function applyMergedDomain/);
  assert.match(src, /async function dispatchMerged/);
  assert.match(src, /case "my_tasks": \{/);
  assert.match(src, /case "list_tasks":\s*\n\s*return listTasksTool\(studentId\);/);
  assert.match(src, /applyMergedDomain\(allTools, req\.user\.id, MERGED_DOMAINS\.my_tasks, \["list_tasks"\], selfToolOn\)/);
});
