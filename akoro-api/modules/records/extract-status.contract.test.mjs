// A fresh claim has result = null until the lane finishes. Status must say
// "running", not done:true — otherwise the Add sheet closes and the reader
// offers a second extraction while OCR is still reading.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "service-extract.js"), "utf8");

test("a running claim without a lane result reports progress", () => {
  const fn = /export async function extractStatus[\s\S]*?\n\}/.exec(src)?.[0] || "";
  assert.match(fn, /job\?\.status === "running" && !job\.result\?\.mode/);
  assert.match(fn, /done: false/);
  assert.ok(fn.indexOf('status === "running"') < fn.indexOf('job?.result?.mode === "ocr"'),
    "the generic running check comes before the OCR/model branches");
});
