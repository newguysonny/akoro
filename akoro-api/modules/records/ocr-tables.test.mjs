// H6: layout content must survive as structure. Tables become GFM (or one
// verbatim [table] block when irregular); figures become a sentinel, never
// fake text.
import assert from "node:assert/strict";
import test from "node:test";
import { normaliseTables, parseOcrPage } from "./extractOcr.js";

test("an HTML table becomes a GFM table with a header row", () => {
  const html = '<table><tr><th>Process</th><th>ATP</th></tr><tr><td>Glycolysis</td><td>2</td></tr></table>';
  const out = normaliseTables(html);
  assert.equal(out, "| Process | ATP |\n| --- | --- |\n| Glycolysis | 2 |");
});

test("an irregular table is kept verbatim instead of guessed", () => {
  const out = normaliseTables("<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>");
  assert.match(out, /^\[table\]/);
  assert.match(out, /a \| b \| c/);
});

test("plain markdown is untouched", () => {
  const md = "# Title\nSome text with a | pipe but no table.";
  assert.equal(normaliseTables(md), md);
});

test("OCR pages normalise tables in the markdown, keep blocks for bboxes", () => {
  const raw = "<|ref|>table<|/ref|><|box|>[[10,10,200,200]]<|/box|><table><tr><th>Step</th><th>ATP</th></tr><tr><td>Krebs</td><td>2</td></tr></table>";
  const page = parseOcrPage(raw);
  assert.match(page.markdown, /\| Step \| ATP \|/);
  assert.equal(page.blocks.length, 1);
  assert.deepEqual(page.blocks[0].bbox_2d, [10, 10, 200, 200]);
});

test("a figure-only region becomes the sentinel, not an empty chunk", () => {
  const page = parseOcrPage("<|ref|>image<|/ref|><|box|>[[1,2,3,4]]<|/box|>");
  assert.equal(page.markdown, "*[figure]*");
});
