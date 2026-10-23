import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResult, toMarkdown, toLegacy } from "./template.js";

const tool = { key: "lesson-hooks", name: "Lesson Hooks", output: "doc" };

test("normalizeResult keeps a valid template and fills meta from the request", () => {
  const r = normalizeResult({ title: "T", entries: [{ title: "A", sections: [{ kind: "text", label: "Clarification", body: "x" }] }] },
    { tool, input: { subject: "Sci", class: "JSS1" } });
  assert.equal(r.version, 2);
  assert.deepEqual(r.meta, { subject: "Sci", class: "JSS1" });
  assert.equal(r.entries[0].sections[0].tone, "success");   // chosen from the label
});

test("normalizeResult drops empty sections and entries", () => {
  const r = normalizeResult({ entries: [{ title: "A", sections: [{ kind: "list", items: [] }] }, { title: "B", sections: [{ kind: "chips", items: ["a"] }] }] }, { tool, input: {} });
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].title, "B");
});

test("a pre-template doc, vocabulary, podcast and grades result all lift into entries", () => {
  const doc = normalizeResult({ title: "D", cards: [{ heading: "H", blocks: [{ label: "L", bullets: ["a"] }] }] }, { tool, input: {} });
  assert.equal(doc.entries[0].sections[0].kind, "list");
  const voc = normalizeResult({ cards: [{ term: "t", definition: "d", example: "e", tip: "" }] }, { tool: { key: "vocabulary", output: "cards" }, input: {} });
  assert.equal(voc.entries[0].layout, "compact");
  const pod = normalizeResult({ turns: [{ speaker: "A", text: "hi" }] }, { tool: { key: "podcast", output: "script" }, input: {} });
  assert.equal(pod.entries[0].sections[0].kind, "script");
  const gr = normalizeResult({ grades: [{ label: "E1", score: 5, outOf: 10, breakdown: [{ criterion: "c", score: 5, outOf: 10, comment: "" }] }] }, { tool: { key: "essay-grader", output: "grades" }, input: {} });
  assert.equal(gr.entries[0].tag, "5/10");
});

test("toLegacy round-trips what the older readers need", () => {
  const gr = normalizeResult({ grades: [{ label: "E1", score: 5, outOf: 10, breakdown: [{ criterion: "c", score: 5, outOf: 10, comment: "" }], feedback: "f" }] }, { tool: { key: "essay-grader", output: "grades" }, input: {} });
  const l = toLegacy(gr, "grades");
  assert.equal(l.grades[0].score, 5);
  assert.equal(l.grades[0].feedback, "f");
  assert.match(toMarkdown(gr), /E1/);
});

test("garbage in gives an empty, renderable result", () => {
  assert.equal(normalizeResult(null, { tool, input: {} }).entries.length, 0);
});
