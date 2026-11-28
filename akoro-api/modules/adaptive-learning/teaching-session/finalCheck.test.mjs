import assert from "node:assert/strict";
import test from "node:test";

import {
  createFinalCheck,
  finalCheckSnapshot,
  applyAssessmentItems,
  runFinalCheckConcepts,
  finalCheckResolution,
  beginFinalCheckReteach,
  finalCheckReteachReady,
  finishFinalCheck,
} from "./finalCheck.js";

const PARTS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const sessionWith = (fc) => ({ session: { finalCheck: fc, history: [] } });

// A stand-in for runTeachingAssessment: every concept correct except `gapOnes`.
const fakeAssess = (gapOnes = []) => async ({ concepts }) => ({
  items: concepts.map((concept) => ({
    concept,
    question: `Question on ${concept}?`,
    answer: `Answer on ${concept}`,
    fromNotes: true,
    outcome: gapOnes.includes(concept) ? "wrong" : "correct",
    note: gapOnes.includes(concept) ? `Missing the core of ${concept}` : "",
  })),
});

test("a full run batches every part and lands held/gap per part", async () => {
  const fc = createFinalCheck(PARTS);
  const orchestrator = sessionWith(fc);
  let batches = 0;
  let firstArgs = null;
  const assess = async (args) => { batches += 1; firstArgs ??= args; return fakeAssess(["F"])(args); };
  const progress = [];
  const { judged } = await runFinalCheckConcepts({
    orchestrator, concepts: PARTS, assess, onProgress: (snap) => progress.push(snap),
  });

  assert.equal(batches, 3); // 8 parts, the assessment's batch size is 3
  assert.equal(firstArgs.notesLimit, 80); // the verdict reads the whole session's teaching, not the recent window
  assert.equal(judged, 8);
  const snap = finalCheckSnapshot(orchestrator.session);
  assert.equal(snap.held, 7);
  assert.equal(snap.gaps, 1);
  assert.equal(snap.items.find((i) => i.concept === "F").status, "gap");
  assert.equal(finalCheckResolution(fc), "open"); // the gap has had no re-check yet
  assert.ok(progress.length >= 3); // the strip fills in as batches land
});

test("a guess never counts as held, even when the answer happens to be right", () => {
  const fc = createFinalCheck(["A"]);
  applyAssessmentItems(fc, [{ concept: "A", question: "q", answer: "a", outcome: "guessed_right", note: "" }]);
  assert.equal(fc.items[0].status, "gap");
});

test("a gap loops back: re-teach, one re-check, then the verdict settles", async () => {
  const fc = createFinalCheck(PARTS);
  const orchestrator = sessionWith(fc);
  await runFinalCheckConcepts({ orchestrator, concepts: PARTS, assess: fakeAssess(["C"]) });

  assert.equal(beginFinalCheckReteach(fc, 2), true);
  assert.equal(beginFinalCheckReteach(fc, 0), false); // a held part cannot be re-taught
  assert.equal(finalCheckReteachReady(fc)?.concept, "C");

  // The re-check still fails: the gap is settled, not looped forever.
  await runFinalCheckConcepts({ orchestrator, concepts: ["C"], assess: fakeAssess(["C"]) });
  assert.equal(fc.items[2].rechecks, 1);
  assert.equal(finalCheckResolution(fc), "settled");
  finishFinalCheck(fc, "settled");
  assert.equal(finalCheckSnapshot(orchestrator.session).status, "settled");
});

test("a re-check that lands turns the gap held and the check passes", async () => {
  const fc = createFinalCheck(["A", "B"]);
  const orchestrator = sessionWith(fc);
  await runFinalCheckConcepts({ orchestrator, concepts: ["A", "B"], assess: fakeAssess(["B"]) });
  assert.equal(finalCheckResolution(fc), "open");

  beginFinalCheckReteach(fc, 1);
  await runFinalCheckConcepts({ orchestrator, concepts: ["B"], assess: fakeAssess([]) });
  assert.equal(fc.items[1].status, "held");
  assert.equal(fc.items[1].rechecks, 1);
  assert.equal(finalCheckResolution(fc), "passed");
});

test("a failed batch judges nothing and restores the parts' prior status", async () => {
  const fc = createFinalCheck(["A", "B"]);
  const orchestrator = sessionWith(fc);
  const { judged } = await runFinalCheckConcepts({
    orchestrator,
    concepts: ["A", "B"],
    assess: async () => { throw new Error("model down"); },
  });
  assert.equal(judged, 0);
  assert.deepEqual(fc.items.map((i) => i.status), ["waiting", "waiting"]);
  assert.equal(finalCheckResolution(fc), "open");
});
