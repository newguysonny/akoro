import test from "node:test";
import assert from "node:assert/strict";
import { DOMAINS, domainForGoal, actionForGoal } from "./domains.js";

test("domainForGoal routes documents first, then subject domains", () => {
  assert.equal(domainForGoal("How many documents are in my library?"), "library_documents");
  assert.equal(domainForGoal("Library count (correct total)"), "library_documents");
  assert.equal(domainForGoal("List my document titles"), "library_documents");
  assert.equal(domainForGoal("Count my study sessions"), "my_study_sessions");
  assert.equal(domainForGoal("WAEC chemistry accuracy"), "my_past_questions");
  assert.equal(domainForGoal("List my study notes"), "my_study_notes");
  // Not a curated domain → let the generic builder handle it.
  assert.equal(domainForGoal("Count my tasks"), null);
  assert.equal(domainForGoal("Set Chemistry tasks to high priority"), null);
});

test("actionForGoal infers the action", () => {
  assert.equal(actionForGoal("how many documents"), "count");
  assert.equal(actionForGoal("list my document titles"), "list");
  assert.equal(actionForGoal("documents by kind"), "by_kind");
  assert.equal(actionForGoal("search for chemistry notes"), "search");
  assert.equal(actionForGoal("sessions by subject"), "by_subject");
});

test("every domain definition is a valid, sandbox-safe code tool", () => {
  for (const [key, d] of Object.entries(DOMAINS)) {
    assert.equal(d.name, key);
    assert.ok(Array.isArray(d.actions) && d.actions.length >= 2, `${key} has actions`);
    assert.deepEqual(d.params.action.enum, d.actions, `${key} enum matches actions`);
    assert.equal(d.definition?.kind || "code", "code");
    // not used; the pipeline assembles { kind, steps, source }
    const src = d.source;
    assert.match(src, /^function run\(input, data, akoro\)/, `${key} exports run()`);
    assert.ok(!src.includes("${"), `${key} source must not use template literals`);
    assert.ok(!/\b(async|await|this|globalThis|eval|Function|require|import)\b/.test(src), `${key} uses no banned syntax`);
  }
});
