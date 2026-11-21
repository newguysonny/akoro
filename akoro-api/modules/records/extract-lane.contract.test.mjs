// The extraction lanes' helpers must be imported, not assumed. Two bugs shipped
// from this file's absence:
//   - the vision lane called getExtractEngine/extractModelId/parsePagesWithModel
//     without importing them ("is not defined");
//   - the OCR lane called readFileObject the same way.
// Each call therefore left the claim running and surfaced as a generic failure.
//
// Static and cheap: every helper the submit path calls must appear in an import
// in this file; where the module is known, the import must come from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE = path.join(ROOT, "modules", "records", "service-extract.js");
const ENGINE = path.join(ROOT, "modules", "records", "extractEngine.js");
const MODEL = path.join(ROOT, "modules", "records", "extractModel.js");
const OCR = path.join(ROOT, "modules", "records", "extractOcr.js");

// [symbol, module file it must come from (or null: any import)]
const REQUIRED = [
  ["getExtractEngine", "extractEngine.js"],
  ["extractModelId", "extractEngine.js"],
  ["parsePagesWithModel", "extractModel.js"],
  ["runDeepseekOcr", "extractOcr.js"],
  ["ocrConfigured", "extractOcr.js"],
  ["readFileObject", null],
  ["saveExtractionPage", null],
  ["saveExtractionPages", null],
  ["indexByContentKey", null],
];

test("submitExtract imports every helper it calls", () => {
  const src = readFileSync(SERVICE, "utf8");
  const importsOf = (name) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`).exec(src)?.[1] || null;

  for (const [name, from] of REQUIRED) {
    if (!src.includes(`${name}(`)) continue;   // not called — nothing to import
    const modulePath = importsOf(name);
    assert.ok(modulePath, `${name} is called in service-extract.js but not imported`);
    if (from) assert.equal(modulePath, `./${from}`, `${name} must be imported from ./${from}`);
  }
});

test("the lane modules export those helpers", () => {
  assert.match(readFileSync(ENGINE, "utf8"), /export\s+async\s+function\s+getExtractEngine/);
  assert.match(readFileSync(ENGINE, "utf8"), /export\s+const\s+extractModelId/);
  assert.match(readFileSync(MODEL, "utf8"), /export\s+async\s+function\s+parsePagesWithModel/);
  assert.match(readFileSync(OCR, "utf8"), /export\s+async\s+function\s+runDeepseekOcr/);
  assert.match(readFileSync(OCR, "utf8"), /export\s+const\s+ocrConfigured/);
});
