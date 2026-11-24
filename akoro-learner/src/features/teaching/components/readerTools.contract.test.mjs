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

test("generation tools can attach library context (searchable files/folders)", () => {
  const picker = readFileSync(new URL("./ContextPicker.jsx", import.meta.url), "utf8");
  const doc = readFileSync(new URL("./SessionReaderDocument.jsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../hooks/useSessionReader.js", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../services/recordsApi.js", import.meta.url), "utf8");
  assert.match(picker, /searchRecords\(q, 12\)/);
  assert.match(picker, /listFolders\(\)/);
  assert.match(picker, /Search files and folders to attach/);
  assert.match(picker, /MAX_ITEMS = 6/);
  assert.match(doc, /<ContextPicker/, "the form offers attachments");
  assert.match(hook, /contextRecordIds/, "record attachments ride to the server");
  assert.match(hook, /contextFolderIds/, "folder attachments ride to the server");
  assert.match(api, /contextRecordIds/);
  assert.match(api, /contextFolderIds/);
});

test("the Prompt box advertises what it can drive", () => {
  const doc = readFileSync(new URL("./SessionReaderDocument.jsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../hooks/useSessionReader.js", import.meta.url), "utf8");
  assert.match(doc, /name pages, a count, difficulty or exam style/);
  assert.match(hook, /appliedIntent/, "the tab reflects what the server applied");
});

test("the context results list closes on an outside click or Escape", () => {
  const picker = readFileSync(new URL("./ContextPicker.jsx", import.meta.url), "utf8");
  assert.match(picker, /pointerdown/);
  assert.match(picker, /contains\(e\.target\)/);
  assert.match(picker, /Escape/);
  assert.match(picker, /ref=\{boxRef\}/);
  assert.match(picker, /removeEventListener\("pointerdown"/);
});

test("every latest Ask answer offers continue suggestions", () => {
  const src = readFileSync(new URL("./ReaderAsk.jsx", import.meta.url), "utf8");
  assert.match(src, /followUpSuggestions/);
  assert.match(src, /lastAnswerIndex/);
  assert.match(src, /idx === lastAnswerIndex/);
  assert.match(src, /onClick=\{\(\) => send\(label\)\}/);
});

test("field explanations live behind a ?, and Ask has a real loading state", () => {
  const doc = readFileSync(new URL("./SessionReaderDocument.jsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("./ContextPicker.jsx", import.meta.url), "utf8");
  const help = readFileSync(new URL("./HelpTip.jsx", import.meta.url), "utf8");
  const ask = readFileSync(new URL("./ReaderAsk.jsx", import.meta.url), "utf8");
  assert.match(help, /aria-label=\{label\}/);
  assert.match(help, /pointerdown/);
  assert.match(doc, /<HelpTip text=\{FIELD_HELP\[f\.id\]\}\/>/);
  assert.doesNotMatch(doc, /The prompt can set pages, count, difficulty and exam style/);
  assert.match(picker, /<HelpTip text="Attach past questions/);
  assert.doesNotMatch(picker, /Citations stay on this document\.<\/p>/);
  assert.match(ask, /role="status" aria-live="polite"/);
  assert.match(ask, /animate-pulse/);
  assert.match(ask, /<Spinner size=\{13\}/);
});
