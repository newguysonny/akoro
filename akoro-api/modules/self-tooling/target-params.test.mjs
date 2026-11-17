/**
 * hardCodedTargets (pipeline.js) — a WRITE definition must not bake the
 * specific row it acts on into a filter literal (Matt, 2026-11-17: the
 * saved "Delete a chat" tool could only ever delete its original chat).
 * The row's identity belongs in a param. Pure-function tests: the flag,
 * the param it names, and the cases that must NOT flag.
 */
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { hardCodedTargets } = await import("./pipeline.js");

const GOAL = "delete my Civic Education — Rule of law chat conversation";
const recipeWrite = (where) => ({
  kind: "recipe",
  steps: [{ id: "a", view: "my_chats", where }],
  then: [{ op: "from", ref: "a" }, { op: "write", cap: "chats.delete" }],
});

test("flags a write recipe that hard-codes the goal's chat title", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "title", op: "eq", value: "Civic Education — Rule of law" }]), GOAL, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].param, "title");
  assert.equal(out[0].field, "title");
  assert.equal(out[0].value, "Civic Education — Rule of law");
  assert.match(out[0].message, /\$title/);
});

test("no flag when the filter binds the param instead of the literal", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "title", op: "eq", value: "$title" }]), GOAL, { title: { type: "string" } });
  assert.deepEqual(out, []);
});

test("no flag for a READ definition — hard-coding a title is a write-tool problem", () => {
  const read = { kind: "recipe", steps: [{ id: "a", view: "my_chats", where: [{ field: "title", op: "eq", value: "Civic Education — Rule of law" }] }], then: [{ op: "from", ref: "a" }] };
  assert.deepEqual(hardCodedTargets(read, GOAL, {}), []);
});

test("no flag for condition fields many rows share (status), even when the goal names the value", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "status", op: "eq", value: "completed" }]), "delete my completed tasks", {});
  assert.deepEqual(out, []);
});

test("no flag for a title literal the goal does not name (not this request's row)", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "title", op: "eq", value: "Some Other Chat Title" }]), GOAL, {});
  assert.deepEqual(out, []);
});

test("no flag for short literals (initials, codes) on identity fields", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "name", op: "eq", value: "Bio" }]), "delete my Bio notes", {});
  assert.deepEqual(out, []);
});

test("an existing param whose default is the literal is the param named", () => {
  const out = hardCodedTargets(recipeWrite([{ field: "title", op: "eq", value: "Civic Education — Rule of law" }]), GOAL,
    { chatTitle: { type: "string", default: "Civic Education — Rule of law" } });
  assert.equal(out.length, 1);
  assert.equal(out[0].param, "chatTitle");
});

test("a filter op later in the recipe (then[]) is scanned too", () => {
  const def = { kind: "recipe", steps: [{ id: "a", view: "my_chats" }],
    then: [{ op: "from", ref: "a" }, { op: "filter", where: [{ field: "title", op: "contains", value: "Civic Education — Rule of law" }] }, { op: "write", cap: "chats.delete" }] };
  assert.equal(hardCodedTargets(def, GOAL, {}).length, 1);
});

test("code with a write step: a goal-named title literal in the source is flagged", () => {
  const def = { kind: "code", steps: [{ id: "c", cap: "chats.delete" }],
    source: "function run(input, data, akoro) { return data.c.filter(function (r) { return r.title === 'Civic Education — Rule of law'; }); }" };
  const out = hardCodedTargets(def, GOAL, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].param, "title");
});

test("code without a write step is not flagged", () => {
  const def = { kind: "code", steps: [{ id: "c", view: "my_chats" }],
    source: "function run(input, data, akoro) { return data.c.filter(function (r) { return r.title === 'Civic Education — Rule of law'; }); }" };
  assert.deepEqual(hardCodedTargets(def, GOAL, {}), []);
});
