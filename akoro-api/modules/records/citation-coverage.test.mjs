// H4: coverage is what lets the UI say "some points aren't cited" instead of
// presenting an unsourced answer as sourced. Pure, so it needs no model.
import assert from "node:assert/strict";
import test from "node:test";
import { citationCoverage } from "./askLib.js";

const cite = (n) => ({ n, pageNumber: 1 });

test("every claim cited → coverage 1", () => {
  const answer = "The chloroplast carries out photosynthesis [1]. Thylakoids hold the light reactions [2].";
  const out = citationCoverage(answer, [cite(1), cite(2)], 2);
  assert.equal(out.claims, 2);
  assert.equal(out.cited, 2);
  assert.equal(out.coverage, 1);
  assert.deepEqual(out.unknown, []);
});

test("an uncited claim lowers coverage and unknown markers are reported", () => {
  const answer = "Thylakoids hold the light reactions [1]. The stroma fixes carbon without a source. A stray marker appears [9].";
  const out = citationCoverage(answer, [cite(1)], 3);
  assert.equal(out.claims, 3);
  assert.equal(out.cited, 2);
  assert.ok(out.coverage < 1 && out.coverage > 0.6);
  assert.deepEqual(out.unknown, [9]);
});

test("headings, tables and list labels are not claims; list items are", () => {
  const answer = [
    "### Overview",
    "| Step | ATP |",
    "| --- | --- |",
    "- **Light reactions:** happen in the thylakoid membrane [1]",
    "- The Calvin cycle fixes carbon dioxide into sugar [2]",
  ].join("\n");
  const out = citationCoverage(answer, [cite(1), cite(2)], 2);
  assert.equal(out.claims, 2);
  assert.equal(out.cited, 2);
  assert.equal(out.coverage, 1);
});

test("short fragments are ignored", () => {
  const out = citationCoverage("Yes. Correct. The thylakoid membrane holds photosystems [1].", [cite(1)], 1);
  assert.equal(out.claims, 1);
  assert.equal(out.coverage, 1);
});

test("no claims with passages supplied scores 0; without passages it is not penalised", () => {
  assert.equal(citationCoverage("### Only a heading", [], 2).coverage, 0);
  assert.equal(citationCoverage("### Only a heading", [], 0).coverage, 1);
});
