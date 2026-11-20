import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareToBaseline, scanStructure, SIZE_LIMIT } from "../scripts/structure-scan.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// Grand Plan Phase 19, step 1 — structural guardrails.
//
// Three rules, all ratcheted against modules/structure-baseline.json:
//   1. no new file over SIZE_LIMIT lines, and baselined files may only shrink
//   2. a module is entered through its index.js, never another module's internals
//   3. no cycles between modules, and every module carries a README.md
//
// Regenerate the baseline only after removing violations:
//   cd akoro-api && node scripts/structure-baseline.mjs
// ─────────────────────────────────────────────────────────────────────────────

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(API_ROOT, "modules", "structure-baseline.json");

test("structure: the API is no worse than the baseline (size, imports, cycles, READMEs)", async () => {
  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  const scan = await scanStructure(API_ROOT);
  const failures = compareToBaseline(scan, baseline);

  assert.deepEqual(
    failures,
    [],
    `${failures.length} structural regression(s):\n  ${failures.join("\n  ")}\n\n` +
      `Fix the code. The baseline may only shrink; never add an entry to make this pass.\n` +
      `Files over ${SIZE_LIMIT} lines are listed in modules/structure-baseline.json.`,
  );
});

test("structure: the baseline itself is minimal and well formed", async () => {
  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));
  for (const key of ["oversized", "crossModuleImports", "cyclicModules", "missingReadmes"]) {
    assert.ok(baseline[key] !== undefined, `baseline is missing "${key}"`);
  }
  for (const [file, lines] of Object.entries(baseline.oversized)) {
    assert.ok(lines > SIZE_LIMIT, `${file} is listed as oversized at ${lines} lines`);
  }
});

// Phase 19 step 2's exit criteria, locked positively: the baseline can no
// longer legitimise either list, even if someone regenerates it.
test("structure: no internal imports, no cycles, no oversized files, no module without a README", async () => {
  const scan = await scanStructure(API_ROOT);
  assert.deepEqual(scan.crossModuleImports, [], "a module is entered through its index.js, never another module's files");
  assert.deepEqual(scan.cyclicModules, [], "modules must not import each other in a cycle");
  assert.deepEqual(Object.keys(scan.oversized), [], `no file over ${SIZE_LIMIT} lines`);
  assert.deepEqual(scan.missingReadmes, [], "every module has a README.md");
});
