import assert from "node:assert/strict";
import test from "node:test";
import { assemblePlan } from "./plan-scaffold.js";

test("fixed shape: dedupe/trim subtopics; objectives keyed to exactly them", () => {
  const { subtopics, objectives } = assemblePlan(
    ["  Cells ", "Cells", "Genetics", "", "Ecosystems"],
    { Cells: ["Identify organelles", "Identify organelles", "Explain diffusion"], Genetics: ["Explain inheritance"] },
  );
  assert.deepEqual(subtopics, ["Cells", "Genetics", "Ecosystems"]);
  assert.deepEqual(Object.keys(objectives), subtopics);
  assert.deepEqual(objectives.Cells, ["Identify organelles", "Explain diffusion"]);
  assert.deepEqual(objectives.Ecosystems, ["Study and complete the activities on Ecosystems"], "missing → placeholder");
});

test("accepts index-aligned objectives arrays and caps the ladder", () => {
  const many = Array.from({ length: 20 }, (_, i) => `topic ${i}`);
  assert.equal(assemblePlan(many, []).subtopics.length, 12, "subtopics capped");
  const plan = assemblePlan(["A", "B"], [["a1"], ["b1"]]);
  assert.deepEqual(plan.objectives, { A: ["a1"], B: ["b1"] });
});
