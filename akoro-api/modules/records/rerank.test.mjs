// Second-stage ranking is the lever when recall is fine but the top passage
// is the wrong one. These tests pin the ordering behaviour, not exact weights:
// an answer paragraph must beat a long page that only mentions the words.
import assert from "node:assert/strict";
import test from "node:test";
import { queryTerms, rerankChunks } from "./rerank.js";

const chunk = (text, fused, extra = {}) => ({ text, fused, ...extra });

test("query terms drop stopwords and short words", () => {
  assert.deepEqual(queryTerms("What is the function of the chloroplast?").sort(),
    ["chloroplast", "function"]);
});

test("the paragraph that answers outranks a long page that merely mentions the words", () => {
  const answer = chunk("Chloroplast: thylakoid membranes carry the light reactions; the stroma fixes carbon.", 0.02);
  const noise = chunk(`${"Function and structure of cells. ".repeat(60)} A chloroplast is mentioned once.`, 0.03);
  const out = rerankChunks({ query: "chloroplast thylakoid function", chunks: [noise, answer], limit: 2 });
  assert.equal(out[0], out.find((c) => c.text === answer.text));
  assert.ok(out[0].rerankScore > out[1].rerankScore);
});

test("an exact phrase beats scattered terms", () => {
  const exact = chunk("The light dependent reactions happen in the thylakoid membrane.", 0.01);
  const scattered = chunk("Light is discussed. Dependent clauses appear. Reactions vary. Thylakoid mentioned.", 0.02);
  const out = rerankChunks({ query: "light dependent reactions", chunks: [scattered, exact], limit: 2 });
  assert.equal(out[0].text, exact.text);
});

test("a table question prefers a table passage", () => {
  const prose = chunk("ATP is produced by mitochondria in large amounts during respiration.", 0.04);
  const table = chunk("Table: ATP yield comparison\n| Process | ATP |\n| --- | --- |\n| Glycolysis | 2 |\n| Krebs | 2 |", 0.01);
  const out = rerankChunks({ query: "compare ATP yield table", chunks: [prose, table], limit: 2 });
  assert.equal(out[0].text, table.text);
});

test("without query terms the fused order is preserved", () => {
  const a = chunk("first", 0.9);
  const b = chunk("second", 0.1);
  const out = rerankChunks({ query: "the and of", chunks: [b, a], limit: 2 });
  assert.deepEqual(out.map((c) => c.text), ["first", "second"]);
});

test("limit and empty input are safe", () => {
  const out = rerankChunks({ query: "cells", chunks: [chunk("cells one", 1), chunk("cells two", 2), chunk("cells three", 3)], limit: 2 });
  assert.equal(out.length, 2);
  assert.deepEqual(rerankChunks({ query: "x", chunks: [], limit: 5 }), []);
  assert.deepEqual(rerankChunks({ query: "x", chunks: null, limit: 5 }), []);
});
