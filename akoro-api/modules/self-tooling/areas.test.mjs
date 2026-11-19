/*
 * areas.test.mjs — the one taxonomy (2026-11-14): every Data View has a
 * curated area; a built tool's PRIMARY area derives from its main read (the
 * last view it reads); anything else it touches — earlier reads, a write's
 * area — is secondary metadata. Areas are never auto-created.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { VIEW_AREA, capabilityArea, deriveToolArea } from "./areas.js";
import { DATA_VIEWS, BUILTIN_DATA_VIEWS, describeView } from "./views.js";
import { AREAS } from "../agent-capabilities/index.js";

test("every built-in Data View has exactly one curated area, and every area used exists", () => {
  // Built-ins only: a database-registered view carries its own area in its
  // spec (or derives "other") — it has no line in the curated map by design.
  for (const name of Object.keys(BUILTIN_DATA_VIEWS)) assert.ok(VIEW_AREA[name], `view ${name} has no area`);
  for (const [view, area] of Object.entries(VIEW_AREA)) {
    assert.ok(BUILTIN_DATA_VIEWS[view], `${view} is not a built-in Data View`);
    assert.ok(AREAS[area], `${view}: unknown area ${area}`);
  }
  assert.equal(Object.keys(VIEW_AREA).length, 20);
});

test("a capability's area comes from the tool it wraps or the view it writes", () => {
  assert.equal(capabilityArea("learner.context"), "profile");       // wraps get_learner_context
  assert.equal(capabilityArea("tasks.delete"), "plans");            // writes my_tasks
  assert.equal(capabilityArea("chats.list_mine"), "chats");         // wraps list_chats
  assert.equal(capabilityArea("nope.nope"), null);
});

test("primary = the main read (last view read); the write's area is secondary", () => {
  // Read weak topics, write back into tasks (reschedule): primary stays with the read.
  const t = deriveToolArea({ views: ["my_weak_topics"], capabilities: ["tasks.reschedule"] });
  assert.equal(t.area, "progress");
  assert.deepEqual(t.secondary_areas, ["plans"]);
  // Single-view tools (and every domain tool) file under that view.
  assert.deepEqual(deriveToolArea({ views: ["my_xp"] }), { area: "progress", secondary_areas: [] });
  assert.deepEqual(deriveToolArea({ views: ["my_library"] }), { area: "files", secondary_areas: [] });
  // Multi-read: the last read is primary, earlier reads are secondary.
  const m = deriveToolArea({ views: ["my_tasks", "my_weak_topics"], capabilities: [] });
  assert.equal(m.area, "progress");
  assert.deepEqual(m.secondary_areas, ["plans"]);
  // Nothing readable → the write's area, else "other". Never invented.
  assert.equal(deriveToolArea({ views: [], capabilities: ["tasks.delete"] }).area, "plans");
  assert.equal(deriveToolArea({}).area, "other");
});

test("my_goals pins what 'completed' means (status 'achieved' — there is no 'completed' status)", () => {
  const d = DATA_VIEWS.my_goals.description;
  assert.match(d, /achieved/);
  assert.match(d, /no 'completed' status/);
  assert.match(describeView("my_goals", DATA_VIEWS.my_goals).description, /achieved/);
});
