// Feature boundaries (Grand Plan Phase 19 step 6).
//
// A feature folder owns its components/hooks/lib and exposes one index.js.
// Features never import each other: shared code lives in src/{components,
// contexts,hooks,lib,services,utils,client} or is passed in.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const FEATURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(p) && !/\.test\.mjs$/.test(p)) out.push(p);
  }
  return out;
}

// The one deliberate composition: the dashboard hosts Agent Chat in a tab,
// and its session modals come from the teaching feature (moved out of
// components/teaching in the same step).
// Cross-feature imports are allowed ONLY through the other feature's index.js
// and must be listed here.
const ALLOWED = { dashboard: ["agent-chat", "teaching"], teaching: ["agent-chat"], library: ["teaching"] };

test("every feature has an index.js; cross-feature imports go through the public index", async () => {
  const features = (await readdir(FEATURES, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(features.length >= 2, "features/ holds at least agent-chat and dashboard");

  const problems = [];
  for (const name of features) {
    try {
      await readFile(path.join(FEATURES, name, "index.js"));
    } catch {
      problems.push(`features/${name} has no index.js`);
    }
    for (const file of await walk(path.join(FEATURES, name))) {
      const src = await readFile(file, "utf8");
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1];
        if (!spec.startsWith(".")) continue;
        const target = path.resolve(path.dirname(file), spec);
        const owner = path.relative(FEATURES, target).split(path.sep)[0];
        if (!features.includes(owner) || owner === name) continue;
        const allowed = (ALLOWED[name] || []).includes(owner);
        const viaIndex = /\/index\.(jsx?|mjs)$/.test(target);
        if (!allowed || !viaIndex) {
          problems.push(`${path.relative(FEATURES, file)} imports features/${owner}${viaIndex ? "" : " (deep, not its index.js)"}`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], `${problems.length} boundary violation(s):\n  ${problems.join("\n  ")}`);
});
