// A split can move a handler into a file that forgot one import. For ordinary
// helpers that shows up as a ReferenceError at the first request — exactly how
// `err403` reached production from the instructor roster split and answered 500
// instead of 403.
//
// This checks the response helpers (err400/err403/err404/…, res200/res403/…),
// which are called bare and are easy to miss, are imported or declared in every
// file that uses them. It parses statically, so no module side effects run.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "build", "coverage"]);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.m?js$/.test(p) && !/\.test\.m?js$/.test(p)) out.push(p);
  }
  return out;
}

test("every response helper used in a file is imported or declared there", async () => {
  const files = [
    ...(await walk(path.join(ROOT, "modules"))),
    ...(await walk(path.join(ROOT, "lib"))),
  ];
  const missing = [];
  for (const file of files) {
    const src = await readFile(file, "utf8");
    const imported = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(",")) imported.add(part.trim().split(/\s+as\s+/)[0].trim());
    }
    const declared = new Set([...src.matchAll(/(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    // Bare calls only (not `.ok(` / `res.ok(`), and only the response-helper shape.
    for (const m of src.matchAll(/(?<![.\w$])((?:err|res)\d{3})\s*\(/g)) {
      if (!imported.has(m[1]) && !declared.has(m[1])) {
        missing.push(`${path.relative(ROOT, file)}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], `${missing.length} unimported response helper(s):\n  ${missing.join("\n  ")}`);
});
