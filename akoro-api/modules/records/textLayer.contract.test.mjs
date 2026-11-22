import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksScanned, realCharsPerPage, TEXT_LAYER_RULES } from "./textLayer.js";

// The two WAEC Chemistry Paper 2 files (production, 2026-10-21): 15 pages, each
// holding only the same 83-character watermark line, taken for a text PDF.
const WATERMARK = "Downloaded from www.example-past-questions.ng — free WAEC past questions and answers";

test("a scan whose only text is the same watermark on every page is a scan", () => {
  assert.equal(WATERMARK.length > 20, true, "it beat the old 20-characters-a-page rule");
  assert.equal(looksScanned(Array(15).fill(WATERMARK)), true);
});

test("a real text PDF with a running header is text", () => {
  const body = (i) => `Question ${i}. Explain, with equations, how ionic bonds form between metals and non-metals and why ionic compounds have high melting points. (10 marks)`;
  const pages = Array.from({ length: 6 }, (_, i) => `WAEC Chemistry Paper 2\n${body(i + 1)}`);
  assert.equal(looksScanned(pages), false);
  assert.ok(realCharsPerPage(pages).every((n) => n > 100), "the header is not counted, the questions are");
  assert.equal(TEXT_LAYER_RULES.MIN_REAL_CHARS_PER_PAGE, 20, "the old rule's floor, now without the repeated text");
});

test("a short document can't be judged by repetition: one or two pages count as they are", () => {
  assert.equal(looksScanned(["x".repeat(200), "x".repeat(200)]), false);
  assert.equal(looksScanned(["Page 1"]), true);
  assert.equal(looksScanned([]), true);
});

test("a scan with a few real lines is still a scan", () => {
  const pages = Array(10).fill(WATERMARK).map((w, i) => (i === 0 ? `${w}\nCHEMISTRY 2 Essay` : w));
  assert.equal(looksScanned(pages), true);
});

test("the learner app uses the same rule, word for word", () => {
  const api = readFileSync(new URL("./textLayer.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../../akoro-learner/src/lib/textLayer.js", import.meta.url), "utf8");
  const body = (src) => src.slice(src.indexOf("export const TEXT_LAYER_RULES")).replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/'/g, '"').replace(/\s+/g, " ");
  assert.equal(body(app), body(api));
});

test("the server's text read and the app's skip both use it", () => {
  const stored = readFileSync(new URL("./storedText.js", import.meta.url), "utf8");
  assert.match(stored, /const scanned = looksScanned\(texts\);/);
  const ext = readFileSync(new URL("../../../akoro-learner/src/components/library/extractPages.js", import.meta.url), "utf8");
  assert.match(ext, /if \(!looksScanned\(texts\)\) return \{ status: 'skipped' \};/);
  assert.match(ext, /p\.model !== 'pdf-text'/, "a scan's saved watermark pages are parsed again");
});
