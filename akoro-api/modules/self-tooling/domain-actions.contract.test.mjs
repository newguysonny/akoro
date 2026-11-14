/*
 * domain-actions.contract.test.mjs — per-action management for domain tools
 * (2026-11-14): the learner can switch ONE action of a domain tool off or on,
 * or delete it, from Settings → Agent → My tools (the domain opens into its
 * actions). Off actions are hidden from the model and refused at run time;
 * deleting the last action archives the tool; rebuilds respect the choices.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { toolDef, toolActions, visibleActions } from "./pipeline.js";

const pipeline = readFileSync(new URL("./pipeline.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../migrations/manifest.json", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../akoro-learner/src/pages/settings/myToolsSection.jsx", import.meta.url), "utf8");

const domainRow = (over = {}) => ({
  name: "my_sessions", label: "Study sessions", goal: "Study sessions: count, list, by_subject, search",
  scope: "learner", domain: "my_learning_sessions",
  actions: ["count", "list", "by_subject", "search"], disabled_actions: [],
  params_schema: { action: { type: "string", enum: ["count", "list", "by_subject", "search"] } }, ...over,
});

test("the off state has a home: migration adds disabled_actions and the manifest runs it", () => {
  assert.ok(manifest.includes("2026-self-tooling-disabled-actions.sql"), "manifest lists the migration");
  const sql = readFileSync(new URL("../../migrations/2026-self-tooling-disabled-actions.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS disabled_actions jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
});

test("pure helpers: toolActions reads the set, visibleActions removes the off ones", () => {
  assert.deepEqual(toolActions(domainRow()), ["count", "list", "by_subject", "search"]);
  assert.deepEqual(visibleActions(domainRow({ disabled_actions: ["search"] })), ["count", "list", "by_subject"]);
  assert.deepEqual(toolActions({ params_schema: {} }), []);
  assert.deepEqual(visibleActions({ actions: ["count"], disabled_actions: ["count"] }), []);
});

test("toolDef hides off actions from the model, and offers nothing when all are off", () => {
  const def = toolDef(domainRow({ disabled_actions: ["search", "list"] }));
  assert.deepEqual(def.function.parameters.properties.action.enum, ["count", "by_subject"]);
  assert.equal(toolDef(domainRow({ disabled_actions: ["count", "list", "by_subject", "search"] })), null);
  const plain = toolDef({ name: "x_tool", label: "X", goal: "g", scope: "learner", params_schema: {} });
  assert.ok(plain && plain.function.name === "x_tool", "non-action tools are unaffected");
});

test("the catalogue drops tools whose actions are all off", () => {
  assert.match(pipeline, /\.map\(toolDef\)\.filter\(Boolean\)/);
  assert.match(pipeline, /actions, disabled_actions/);
});

test("the runner refuses an off or deleted action even when asked by name", () => {
  assert.match(pipeline, /!visibleActions\(t\)\.includes\(input\.action\)/);
  assert.match(pipeline, /That action is turned off for this tool/);
});

test("updateMyTool: per-action patches, validated, and the last delete archives the tool", () => {
  assert.match(pipeline, /patch\?\.deleteAction/);
  assert.match(pipeline, /patch\?\.actionStatus/);
  assert.match(pipeline, /That action doesn't exist on this tool/);
  assert.match(pipeline, /if \(!nextActions\.length\) allowed\.status = "archived"/);
  assert.match(pipeline, /enum: nextActions/);
});

test("rebuilds respect the learner's choices: off stays off, the asked-for action comes back", () => {
  assert.match(pipeline, /const carriedOff = /);
  assert.match(pipeline, /a !== action && a !== extra/);
  assert.match(pipeline, /disabled_actions: carriedOff/);
  assert.match(pipeline, /Asking again for an action the learner switched off turns it back on/);
});

test("the API carries domain + action state both ways", () => {
  assert.match(pipeline, /domain, actions, disabled_actions/);
  assert.match(routes, /disabledActions: t\.disabled_actions/);
  assert.match(routes, /domain: t\.domain \|\| null/);
});

test("the learner UI: domains open into actions, each with a switch and a delete", () => {
  assert.match(ui, /Domain · \$\{t\.actions\.length\} action/);
  assert.match(ui, /actionStatus: off \? 'active' : 'disabled'/);
  assert.match(ui, /deleteAction: a/);
  assert.match(ui, /Delete domain/);
  assert.match(ui, /removes all \$\{t\.actions\.length\} of its actions/);
  assert.match(ui, /Group by \$\{f\}/, "actions are shown in plain words");
  assert.ok(existsSync(new URL("../../../akoro-learner/src/pages/settings/myToolsSection.jsx", import.meta.url)));
});
