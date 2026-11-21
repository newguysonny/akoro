// The vision lane's helpers must be imported, not assumed. A missing import
// shipped once: every submit died with `getExtractEngine is not defined`, the
// claim stayed running, and the reader showed a generic failure.
//
// Static and cheap: the symbols the submit path calls must appear in an import
// in this file (and the engine module must export them).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVICE = path.join(ROOT, "modules", "records", "service-extract.js");
const ENGINE = path.join(ROOT, "modules", "records", "extractEngine.js");
const MODEL = path.join(ROOT, "modules", "records", "extractModel.js");

const REQUIRED = [
  ["getExtractEngine", "extractEngine.js"],
  ["extractModelId", "extractEngine.js"],
  ["parsePagesWithModel", "extractModel.js"],
];

test("submitExtract imports every vision-lane helper it calls", () => {
  const src = readFileSync(SERVICE, "utf8");
  for (const [name, from] of REQUIRED) {
    if (!src.includes(`${name}(`)) continue;   // not called — nothing to import
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']\\./${from.replace(".", "\\.")}["']`).test(src);
    assert.ok(imported, `${name} is called in service-extract.js but not imported from ./${from}`);
  }
});

test("the engine and model modules export those helpers", () => {
  const engine = readFileSync(ENGINE, "utf8");
  const model = readFileSync(MODEL, "utf8");
  assert.match(engine, /export\s+async\s+function\s+getExtractEngine/);
  assert.match(engine, /export\s+const\s+extractModelId/);
  assert.match(model, /export\s+async\s+function\s+parsePagesWithModel/);
});
