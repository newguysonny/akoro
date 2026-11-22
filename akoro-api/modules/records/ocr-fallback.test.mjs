// The OCR provider is a black box: empty answers and pages of [unreadable]
// happen. These tests pin the quality gate and the model-lane fallback without
// touching the network — both lanes are injected.
import assert from "node:assert/strict";
import test from "node:test";
import { ocrQuality, runOcrWithFallback } from "./extractOcr.js";

const PDF = Buffer.from("%PDF-1.4 fake scan bytes");
const page = (n, markdown) => ({ pageNumber: n, blocks: [], markdown });
const good = { model: "deepseek-ocr", pages: [page(1, "The chloroplast carries out photosynthesis in the thylakoid membranes.")] };
const weak = { model: "deepseek-ocr", pages: [page(1, "abc")] };

const modelDeps = (calls) => ({
  render: async () => [{ pageNumber: 1, jpeg: Buffer.from("jpeg") }],
  parseModel: async () => { calls.models += 1; return [{ pageNumber: 1, markdown: "Model read the page.", model: "vision" }]; },
});

test("quality gate flags empty and sparse answers, not real text", () => {
  assert.equal(ocrQuality([]).weak, true);
  assert.equal(ocrQuality(weak.pages).weak, true);
  assert.equal(ocrQuality(good.pages).weak, false);
  assert.equal(ocrQuality([page(1, "[unreadable] [unreadable] [unreadable] [unreadable]")]).weak, true);
});

test("good OCR is returned unchanged and never calls the model", async () => {
  const calls = { models: 0 };
  const out = await runOcrWithFallback({ buffer: PDF, filename: "scan.pdf", deps: { ocr: async () => good, ...modelDeps(calls) } });
  assert.equal(out.lane, "ocr");
  assert.equal(calls.models, 0);
  assert.equal(out.pages[0].markdown, good.pages[0].markdown);
});

test("a failing OCR falls back to the vision model", async () => {
  const calls = { models: 0 };
  const out = await runOcrWithFallback({
    buffer: PDF, filename: "scan.pdf",
    deps: { ocr: async () => { throw new Error("DeepSeek OCR HTTP 402"); }, ...modelDeps(calls) },
  });
  assert.equal(out.lane, "model-fallback");
  assert.equal(calls.models, 1);
  assert.equal(out.pages[0].markdown, "Model read the page.");
  assert.match(out.ocrError, /402/);
});

test("a sparse OCR answer is replaced by the model", async () => {
  const calls = { models: 0 };
  const out = await runOcrWithFallback({ buffer: PDF, filename: "scan.pdf", deps: { ocr: async () => weak, ...modelDeps(calls) } });
  assert.equal(out.lane, "model-fallback");
  assert.equal(calls.models, 1);
  assert.equal(out.quality.weak, true);
});

test("if the fallback also fails, the OCR answer is kept", async () => {
  const out = await runOcrWithFallback({
    buffer: PDF, filename: "scan.pdf",
    deps: { ocr: async () => weak, render: async () => [], parseModel: async () => [] },
  });
  assert.equal(out.lane, "ocr");
  assert.equal(out.pages.length, 1);
});

test("RECORDS_OCR_FALLBACK=off keeps the OCR answer", async () => {
  const prev = process.env.RECORDS_OCR_FALLBACK;
  process.env.RECORDS_OCR_FALLBACK = "off";
  try {
    const calls = { models: 0 };
    const out = await runOcrWithFallback({ buffer: PDF, filename: "scan.pdf", deps: { ocr: async () => weak, ...modelDeps(calls) } });
    assert.equal(out.lane, "ocr");
    assert.equal(calls.models, 0);
  } finally {
    if (prev === undefined) delete process.env.RECORDS_OCR_FALLBACK; else process.env.RECORDS_OCR_FALLBACK = prev;
  }
});

test("an image is not sent through the PDF renderer", async () => {
  const calls = { models: 0 };
  const out = await runOcrWithFallback({
    buffer: Buffer.from("png bytes"), filename: "photo.png",
    deps: { ocr: async () => weak, ...modelDeps(calls) },
  });
  assert.equal(out.lane, "ocr");
  assert.equal(calls.models, 0);
});
