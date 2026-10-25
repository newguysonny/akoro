// A battle made from a draft asks the draft's questions: they come back through the same gate.
import "../../test-env.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { presetQuestions } from "./questionSource.js";

test("presetQuestions: a draft's saved questions keep their stem, options, answer and order", () => {
  const saved = [
    { stem: "Which organelle releases energy?", options: [{ label: "A", text: "Nucleus" }, { label: "B", text: "Mitochondrion" }, { label: "C", text: "Ribosome" }, { label: "D", text: "Vacuole" }], correctIndex: 1, topic: "Cells", explanation: "Respiration." },
    { stem: "What surrounds a plant cell?", options: [{ label: "A", text: "Cell wall" }, { label: "B", text: "Shell" }], correctIndex: 0, topic: null, exam: "NECO", year: 2019 },
  ];
  const out = presetQuestions(saved, "Cell structure");
  assert.equal(out.length, 2);
  assert.equal(out[0].stem, saved[0].stem);
  assert.equal(out[0].options[out[0].correctIndex].text, "Mitochondrion", "the answer stays on the same option");
  assert.equal(out[0].explanation, "Respiration.");
  assert.equal(out[1].topic, "Cell structure", "a question without a topic takes the battle's");
});

test("presetQuestions: a question whose answer doesn't resolve is dropped, not marked wrong", () => {
  assert.equal(presetQuestions([{ stem: "Broken?", options: [{ label: "A", text: "x" }, { label: "B", text: "y" }], correctIndex: 7 }]).length, 0);
  assert.equal(presetQuestions(null).length, 0);
});
