import assert from "node:assert/strict";
import test from "node:test";

/**
 * An upload's steps in the chat (2026-10-19): a tool row and a short message
 * per step, written by code from what each step returned — never invented.
 */
import { appendSteps, describeFile, filedSteps, folderSteps, readResult, readSteps, receivedSteps, savedSteps, similarSteps, sortSteps, STEP_LIMIT } from "./stepsCore.js";

test("sorting: what each file is, then what happens next", () => {
  const [row, say] = sortSteps({ batchId: "b1", ms: 1400, files: [{ subject: "Biology", kind: "past_paper" }, { subject: "Biology", kind: "notes" }] });
  assert.equal(row.type, "tool");
  assert.equal(row.headline, "Sorting your files");
  assert.equal(row.result, "a Biology past paper · Biology notes");
  assert.equal(row.ms, 1400);
  assert.match(say.text, /2 files: \*\*a Biology past paper\*\* and \*\*Biology notes\*\*/);
  assert.equal(describeFile({ subject: null, kind: "notes" }), "notes (subject not clear yet)");
  assert.match(sortSteps({ batchId: "b2", files: [{ subject: "Chemistry", kind: "notes" }] })[1].text, /^It's \*\*Chemistry notes\*\*/);
});

test("folders: one they have, a new one, two to pick from, or the subject still unknown", () => {
  const [row, say] = folderSteps({ batchId: "b1", groups: [
    { subject: "Biology", kind: "notes", folderName: "Biology — Notes", created: false },
    { subject: "Biology", kind: "past_paper", folderName: "Biology — Past papers", created: true },
  ] });
  assert.equal(row.result, "Biology — Notes exists · new: Biology — Past papers");
  assert.match(say.text, /^You already have \*\*Biology — Notes\*\*, so the notes go there; I've made \*\*Biology — Past papers\*\* for the past papers\.$/);
  const ask = folderSteps({ batchId: "b2", groups: [{ subject: "Physics", kind: "notes", choices: [{}, {}] }, { kind: "other", names: ["scan.jpg"] }] });
  assert.match(ask[1].text, /pick one on the card/);
  assert.match(ask[1].text, /\*\*scan\.jpg\*\* from the name — I'll read it first/);
});

test("filed: Undo is said once per message; reading: what it found, the most tested first", () => {
  assert.equal(filedSteps({ ingestId: "i1", folderName: "Biology — Notes", first: true }).length, 2);
  assert.equal(filedSteps({ ingestId: "i2", folderName: "Biology — Notes", first: false }).length, 1);
  const steps = readSteps({ ingestId: "i1", items: [{ recordId: "r1", title: "WAEC Biology 2019", topics: [{ name: "Cells", weight: 6 }, { name: "Ecology", weight: 9 }, { name: "Nutrition", weight: 7 }, { name: "Genetics", weight: 2 }], questionCount: 50, ms: 18000 }],
    moved: { to: "Biology — Past papers", subject: "Biology" } });
  assert.equal(steps[0].result, "4 topics · 50 questions");
  assert.match(steps[1].text, /most tested: \*\*Ecology\*\*, \*\*Nutrition\*\* and \*\*Cells\*\*/);
  assert.equal(steps[2].headline, "Moving it to Biology — Past papers");
  assert.equal(readResult({ topics: [] }), "No clear topics");
});

test("similar: what was found, or that nothing matches", () => {
  const [row, say] = similarSteps({ ingestId: "i1", folderName: "Biology — Past papers", candidates: [{ kind: "course" }, { kind: "course" }, { kind: "blog" }] });
  assert.equal(row.result, "2 courses · 1 blog post");
  assert.match(say.text, /3 pieces on Akoro/);
  assert.match(similarSteps({ ingestId: "i2", candidates: [] })[1].text, /Nothing on Akoro matches/);
});

test("received + saved (Stage 4): nothing is sorted or filed until the read", () => {
  const [row, say] = receivedSteps({ batchId: "b1", count: 2 });
  assert.equal(row.headline, "Saving your files");
  assert.match(say.text, /read them first, then file them/, "the folder is not named — it isn't decided yet");
  assert.equal(receivedSteps({ batchId: "b1", count: 1 })[0].headline, "Saving your file");
  const saved = savedSteps({ ingestId: "i1", first: true });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].headline, "Saving to your Library");
  assert.match(saved[1].text, /file it where it belongs/);
  assert.equal(savedSteps({ ingestId: "i1", first: false }).length, 1, "the say is once per message");
});

test("steps merge by id and stay bounded", () => {
  const a = sortSteps({ batchId: "b1", files: [{ subject: "Biology", kind: "notes" }] });
  const again = appendSteps(appendSteps([], a), a);
  assert.equal(again.length, 2, "the same step twice is one step");
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, type: "tool" }));
  assert.equal(appendSteps([], many).length, STEP_LIMIT);
});

test("a failed read is shown as such (Read it again), and is gone once it's read", async () => {
  const { ingestToApi } = await import("./ingestCore.js");
  const base = { id: "i1", state: "ready", names: ["a.pdf"], filing: {} };
  assert.equal(ingestToApi({ ...base, steps: [{ id: "read:i1:failed", type: "tool" }] }).readFailed, true);
  assert.equal(ingestToApi({ ...base, structure: { topics: [] }, steps: [{ id: "read:i1:failed", type: "tool" }] }).readFailed, false, "read since");
  assert.equal(ingestToApi({ ...base, steps: [] }).readFailed, false);
});
