// Guards three reader regressions that all read as "nothing happens":
//   1. the tab strip was rendered without its handlers, so tapping a pill was
//      a no-op and the active pill never highlighted;
//   2. quiz/summary/flashcards outlived the 30 s API deadline (a real quiz
//      measured ~40 s), so the sheet said "request timed out" mid-generation;
//   3. a selection from the OCR layer pre-filled Focus with raw markdown.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(path.join(HERE, ...parts), "utf8");

test("the reader chrome hands every tab handler to PillsBar", () => {
  const src = read("SessionReaderChrome.jsx");
  const call = /<PillsBar[\s\S]*?\/>/.exec(src)?.[0] || "";
  for (const prop of ["activeTabId", "activeResultTab", "switchTabTo", "closeTab"]) {
    assert.match(call, new RegExp(`\\b${prop}=`), `PillsBar is missing ${prop}`);
  }
});

test("tool generation outlives the model's real latency", () => {
  const src = readFileSync(path.join(HERE, "..", "..", "..", "services", "recordsApi.js"), "utf8");
  const fn = /function generateRecordTool[\s\S]*?\n}/.exec(src)?.[0] || "";
  assert.match(fn, /timeout:\s*90_000/, "generateRecordTool needs a 90 s timeout");
});

test("focus prefill strips OCR markdown and layout tokens", async () => {
  const { cleanFocusText } = await import("./sessionReaderModel.js");
  assert.equal(cleanFocusText("# 5 The chloroplast## Part I · Foundations"), "5 The chloroplast Part I · Foundations");
  assert.equal(cleanFocusText("<|ref|>text<|/ref|> **ATP** is made `here`"), "text ATP is made here");
  assert.equal(cleanFocusText("  "), "");
  assert.ok(cleanFocusText("x".repeat(400)).length <= 160);
});

test("reader forms: prompt wording, typed card count and selected pages", () => {
  const model = readFileSync(new URL("./sessionReaderModel.js", import.meta.url), "utf8");
  const doc = readFileSync(new URL("./SessionReaderDocument.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(model, /Focus \(optional\)/, "renamed to Prompt (optional)");
  assert.match(model, /label: "Prompt \(optional\)"/);
  assert.match(model, /id: "count", label: "Number of cards", type: "number"/, "cards are typed, not a dropdown");
  assert.match(model, /options: \["This page", "Whole document", "Selected pages"\]/);
  assert.match(model, /pagesLabel/);
  assert.match(doc, /withScope && values\.scope === "Selected pages"/, "the page picker renders for the new scope");
  assert.match(doc, /Choose at least one page\./, "submitting with no pages is refused");
  assert.match(doc, /pageCount=\{pages\.length\} currentPage=\{currentPage\}/, "the picker knows the document length");
});
