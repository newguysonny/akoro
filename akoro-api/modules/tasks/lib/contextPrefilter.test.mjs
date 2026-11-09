import assert from "node:assert/strict";
import test from "node:test";
import { preFilterFileTexts } from "./contextPrefilter.js";

test("drops empty files and dedups OCR that is identical up to whitespace", () => {
  const { fileTexts, stats } = preFilterFileTexts([
    { fileName: "a", text: "Water cycle: evaporation, condensation." },
    { fileName: "b", text: "  Water cycle: evaporation,\n  condensation.  " },   // same after normalise
    { fileName: "c", text: "   \n\t " },                                        // empty
    { fileName: "d", text: "Photosynthesis is different." },
  ]);
  assert.deepEqual(fileTexts.map((f) => f.fileName), ["a", "d"]);
  assert.equal(stats.deduped, 1);
  assert.equal(stats.filesKept, 2);
});

test("caps each file with a truncation marker", () => {
  const big = "x".repeat(1000);
  const { fileTexts, stats } = preFilterFileTexts([{ fileName: "big", text: big }], { perFileChars: 100, totalChars: 10_000 });
  assert.equal(stats.truncated, 1);
  assert.ok(fileTexts[0].text.startsWith("x".repeat(100)));
  assert.match(fileTexts[0].text, /truncated 900 chars/);
});

test("total budget bounds the set deterministically and drops the overflow", () => {
  const { fileTexts, stats } = preFilterFileTexts([
    { fileName: "a", text: "a".repeat(60) },
    { fileName: "b", text: "b".repeat(60) },   // fits only 40 after a
    { fileName: "c", text: "c".repeat(60) },   // no budget left
  ], { perFileChars: 100, totalChars: 100 });
  assert.deepEqual(fileTexts.map((f) => f.fileName), ["a", "b"]);
  assert.equal(stats.truncated, 1);
  assert.equal(stats.droppedTotal, 1);
  assert.ok(stats.charsOut < stats.charsIn);
});

test("small distinct inputs pass through unchanged (no-op on ordinary tasks)", () => {
  const input = [{ fileName: "a", text: "short note" }];
  const { fileTexts, stats } = preFilterFileTexts(input);
  assert.equal(fileTexts[0].text, "short note");
  assert.equal(stats.truncated, 0);
  assert.equal(stats.charsOut, stats.charsIn);
});
