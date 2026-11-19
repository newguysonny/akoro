/*
 * tool-selection.contract.test.mjs — runtime area selection (2026-11-14):
 * a turn sends the always-on core + the active areas' tools, built-in and
 * learner-built together. No active area → the full list. Areas stick per
 * conversation; get_agent_capabilities { area } loads an area mid-turn;
 * AKORO_TOOL_AREA_SELECTION=false turns selection off entirely.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CORE_TOOL_NAMES, areasForMessage, filterDefsByAreas, toolArea } from "./toolSelection.js";

const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
const runtimeState = readFileSync(new URL("./chat/runtime-state.js", import.meta.url), "utf8");
const pipeline = readFileSync(new URL("../self-tooling/pipeline.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../migrations/manifest.json", import.meta.url), "utf8");

const def = (name) => ({ type: "function", function: { name } });

test("the core is always on: identity, discovery and building", () => {
  for (const n of ["get_learner_context", "get_agent_capabilities", "schema_lookup", "create_tool", "save_computation", "submit_tool_request"]) {
    assert.ok(CORE_TOOL_NAMES.includes(n), `${n} must be core`);
  }
});

test("areasForMessage points at the areas a message is about", () => {
  assert.ok(areasForMessage("What are my weak topics in Biology?").has("progress"));
  assert.ok(areasForMessage("Remind me at 5pm to revise").has("plans"));
  assert.ok(areasForMessage("Challenge Musa to a battle").has("network"));
  assert.equal(areasForMessage("Hello").size, 0, "a vague opener activates nothing → full list");
});

test("filtering keeps core + active areas, built-in and learner-built alike", () => {
  const defs = [def("get_learner_context"), def("check_progress"), def("create_task"), def("my_xp_tool")];
  const areaOf = (n) => (n === "my_xp_tool" ? "progress" : toolArea(n));
  const kept = filterDefsByAreas(defs, new Set(["progress"]), areaOf).map((d) => d.function.name);
  assert.deepEqual(kept.sort(), ["check_progress", "get_learner_context", "my_xp_tool"]);
  assert.equal(filterDefsByAreas(defs, new Set(), areaOf).length, 4, "no active areas → untouched");
});

test("chat wiring: sticky areas, the forced tool's area, the loader, the merge, the kill switch", () => {
  assert.match(runtimeState, /const conversationAreas = new Map\(\)/);
  assert.match(chat, /if \(forcedTool\) active\.add\(toolArea\(forcedTool\)\)/);
  assert.match(chat, /requiredTool: forcedTool/);
  assert.match(chat, /tools: turnTools/);
  assert.match(chat, /__addTools/);
  assert.match(chat, /stickyAreasFor\(conversationId\)\.add\(wantArea\)/);
  assert.match(chat, /AKORO_TOOL_AREA_SELECTION|areaSelectionEnabled\(\)/);
});

test("self-tooling stores the derivation: register, domains, saved computations; defs carry areas", () => {
  assert.ok(manifest.includes("2026-agent-tools-areas.sql"));
  assert.equal(pipeline.match(/Object\.assign\(def, deriveToolArea\(def\)\)/g).length, 2, "builder + save paths stamp the def");
  assert.match(pipeline, /area: deriveToolArea\(\{ views: \[spec\.view\] \}\)\.area/);
  assert.match(pipeline, /export async function learnerToolDefsWithAreas/);
  assert.match(pipeline, /allowed\.tags = /);
});

test("instructor identity is core too (get_my_profile)", () => {
  assert.ok(CORE_TOOL_NAMES.includes("get_my_profile"), "get_my_profile must be core for instructor turns");
});

test("areasForMessage hears instructor phrasings as activities", () => {
  assert.ok(areasForMessage("Show me my drafts").has("activities"));
  assert.ok(areasForMessage("Set a weekly routine for JSS2").has("activities"));
  assert.ok(areasForMessage("Who is on the roster for my class?").has("activities"));
  assert.ok(areasForMessage("Show the outcomes for the photosynthesis assignment").has("activities"));
  assert.ok(areasForMessage("How many submissions came in?").has("activities"));
});

test("areasForMessage hears class and student phrasings as activities (instructor battery, 2026-11-16)", () => {
  assert.ok(areasForMessage("How many classes do I have?").has("activities"));
  assert.ok(areasForMessage("How many students are in my classes in total?").has("activities"));
  assert.ok(areasForMessage("Show me the class list").has("activities"));
});
