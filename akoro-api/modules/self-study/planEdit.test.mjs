import assert from "node:assert/strict";
import test from "node:test";
import { mergePlanItems, wantsPlanEdit } from "./planEdit.js";

const STORED = ["What photosynthesis is", "The word equation", "Chlorophyll and sunlight", "Where it happens in the leaf"];

test("adding keeps the stored plan — the agent never has to retype it", () => {
  assert.deepEqual(mergePlanItems(STORED, { add: ["The light reactions"] }), [...STORED, "The light reactions"]);
  assert.deepEqual(mergePlanItems(STORED, { add: ["the word equation", "  "] }), STORED, "duplicates and blanks are ignored");
});

test("removing matches by title or key words and keeps the rest", () => {
  assert.deepEqual(mergePlanItems(STORED, { remove: ["The word equation"] }), [STORED[0], STORED[2], STORED[3]]);
  assert.deepEqual(mergePlanItems(STORED, { remove: ["chlorophyll"] }), [STORED[0], STORED[1], STORED[3]]);
  assert.deepEqual(mergePlanItems(STORED, { remove: ["nothing like this"] }), STORED);
});

test("a full subtopics list is a deliberate rewrite; add/remove then apply on top of it", () => {
  assert.deepEqual(mergePlanItems(STORED, { subtopics: ["B", "A"] }), ["B", "A"]);
  assert.deepEqual(mergePlanItems(STORED, { subtopics: ["B", "A"], add: ["C"], remove: ["a"] }), ["B", "C"]);
  assert.deepEqual(mergePlanItems(undefined, { add: ["First"] }), ["First"], "no stored plan yet: the added entry starts one");
});

test("wantsPlanEdit sees every way of touching the plan", () => {
  assert.equal(wantsPlanEdit({ add_subtopics: ["x"] }), true);
  assert.equal(wantsPlanEdit({ remove_subtopics: ["x"] }), true);
  assert.equal(wantsPlanEdit({ subtopics: [] }), true);
  assert.equal(wantsPlanEdit({ objectives: { a: ["b"] } }), true);
  assert.equal(wantsPlanEdit({ add_subtopics: [] , title: "t" }), false);
});
