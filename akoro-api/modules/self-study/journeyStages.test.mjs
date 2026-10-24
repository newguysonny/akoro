import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStages } from "./journeyStages.js";

test("a journey keeps battle stages, with a clamped question count", () => {
  const s = normalizeStages([
    { kind: "self_study", topic: "Fractions" },
    { kind: "battle", topic: "Fractions", title: "Fraction showdown", questions: 50 },
    { kind: "battle", topic: "Decimals", questions: 2 },
    { kind: "battle", topic: "Ratios" },
    { kind: "nonsense", topic: "x" },
  ], "Mathematics");
  assert.deepEqual(s.map((x) => x.kind), ["self_study", "battle", "battle", "battle", "self_study"]);
  assert.deepEqual(s.filter((x) => x.kind === "battle").map((x) => x.questions), [20, 5, 5]);
  assert.equal(s[0].questions, undefined);
  assert.equal(s[1].subject, "Mathematics");
});
