// Every relative import in production code must resolve. This caught a deploy
// crash: a file moved into modules/webhooks/ kept a `../lib/...` path, so
// Render found no module at boot. `tsc --noEmit` cannot see it (checkJs is
// off) and the narrow imports test does not cover it.
//
// Tests are skipped on purpose: their fixtures contain module-looking strings.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const isTest = (p) => /\.test\.m?js$/.test(p);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.m?js$/.test(p) && !isTest(p)) out.push(p);
  }
  return out;
}

// Statement-shaped only (start of line, after a semicolon, or dynamic import),
// so prose and fixtures are ignored.
const IMPORT = /(?:^|[;\n])\s*(?:import|export)\s+(?:[^;'"`]*?\bfrom\s+)?["']([^"']+)["']|(?:^|[;\n])\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm;

async function resolves(base) {
  for (const c of [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, path.join(base, "index.js"), path.join(base, "index.ts")]) {
    if (!/\.(m?js|ts)$/.test(c)) continue;
    try { await readFile(c); return true; } catch { /* next */ }
  }
  return false;
}

test("every relative import in production code resolves (a moved file keeps its depth)", async () => {
  const files = [...await walk(path.join(ROOT, "modules")), ...await walk(path.join(ROOT, "lib")), path.join(ROOT, "app.js")];
  const broken = [];
  let checked = 0;
  for (const file of files) {
    const src = await readFile(file, "utf8");
    IMPORT.lastIndex = 0;
    let m;
    while ((m = IMPORT.exec(src))) {
      const spec = m[1] || m[2];
      if (!spec.startsWith(".")) continue;
      checked++;
      if (!await resolves(path.resolve(path.dirname(file), spec))) {
        broken.push(`${path.relative(ROOT, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(broken, [], `${broken.length} broken relative import(s) of ${checked} checked:\n  ${broken.join("\n  ")}`);
});
