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
  assert.equal(presentMergedToolRow({ name: "my_tasks", domain: "my_tasks", actions: ["count", "list", "search"], disabled_actions: [] }), null);
  const shown = presentMergedToolRow({ name: "my_tasks", domain: "my_tasks", actions: ["count", "list", "by_priority"], disabled_actions: [] });
  assert.deepEqual(shown.actions, ["by_priority"]);
});

test("goals config: merged set, def and My-tools presentation", () => {
  const c = MERGED_DOMAINS.my_goals;
  assert.equal(c.view, "my_goals");
  assert.deepEqual(c.def().function.parameters.properties.action.enum, ["count", "list", "by_status", "search"]);
  assert.equal(c.buildIsCovered(["list", "by_status"]), true);
  assert.equal(c.buildIsCovered(["by_category"]), false);
  assert.equal(presentMergedToolRow({ name: "my_goals", domain: "my_goals", actions: ["count", "list", "search"], disabled_actions: [] }), null);
});

test("study notes config: search is the platform action, the rest are view reads", () => {
  const c = MERGED_DOMAINS.my_study_notes;
  assert.equal(c.view, "my_study_notes");
  assert.deepEqual(c.baseActions, ["count", "list", "by_subject"]);
  assert.deepEqual(c.platformActions, ["search"]);
  assert.equal(c.buildIsCovered(["count", "search"]), true);
  assert.equal(c.buildIsCovered(["by_confidence"]), false);
});

test("sessions config: overview is a distinct platform action over the session view", () => {
  const c = MERGED_DOMAINS.my_study_sessions;
  assert.equal(c.view, "my_learning_sessions");
  assert.deepEqual(c.platformActions, ["overview"]);
  assert.deepEqual(c.def().function.parameters.properties.action.enum, ["count", "list", "by_subject", "search", "overview"]);
  assert.equal(c.buildIsCovered(["count", "overview"]), true);
  // the domain tool's name differs from its view — presentation keys on both
  assert.equal(presentMergedToolRow({ name: "my_study_sessions", domain: "my_learning_sessions", actions: ["count", "list"], disabled_actions: [] }), null);
  const computed = { name: "sessions_by_month", domain: "my_learning_sessions", actions: [], disabled_actions: [] };
  assert.equal(presentMergedToolRow(computed), computed);
});

test("notes/library defs disambiguate each other (battery finding 2026-11-15)", () => {
  const notes = MERGED_DOMAINS.my_study_notes.def();
  assert.match(notes.function.description, /NOT Library documents/);
  assert.match(notes.function.description, /they mean THIS tool/);
});

test("past questions config: accuracy is the platform action", () => {
  const c = MERGED_DOMAINS.my_past_questions;
  assert.equal(c.view, "my_past_questions");
  assert.deepEqual(c.platformActions, ["accuracy"]);
  assert.deepEqual(c.def().function.parameters.properties.action.enum, ["count", "list", "by_subject", "accuracy", "search"]);
  assert.equal(c.buildIsCovered(["accuracy", "count"]), true);
  assert.equal(c.buildIsCovered(["by_exam"]), false);
});

test("wiring: pipeline guard loop, generic runners, registry", () => {
  const src = read("./pipeline.js");
  assert.match(src, /MERGED_DOMAIN_LIST\.find\(\(c\) => c\.view === spec\.view && c\.enabled\(\)\)/);
  assert.match(src, /export async function getMergedToolState/);
  assert.match(src, /export async function runMergedViewAction/);
  assert.match(src, /MERGED_DOMAIN_LIST\.map\(\(c\) => \(\{ domain: c\.view, name: c\.name, mergedActions: c\.mergedActions, enabled: c\.enabled \}\)\)/);
});

test("wiring: chat.js assembles and dispatches merged domains generically", () => {
  const src = read("../adaptive-learning/chat.js");
  assert.match(src, /async function applyMergedDomain/);
  assert.match(src, /async function dispatchMerged/);
  assert.match(src, /case "my_tasks": \{/);
  assert.match(src, /case "list_tasks":\s*\n\s*return listTasksTool\(studentId\);/);
  assert.match(src, /applyMergedDomain\(allTools, req\.user\.id, MERGED_DOMAINS\.my_tasks, \["list_tasks"\], selfToolOn\)/);
  // the learning-history force must be remapped to the merged sessions tool
  assert.match(src, /forcedTool = "my_study_sessions";/);
});
