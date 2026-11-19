// A barrel is only useful if it exports what its callers import. Node throws at
// link time for a missing named import, but a dynamic import assigned to a
// variable silently yields undefined and blows up at the call — that is how
// `auth.signChallengeForGate` reached production from a verify scenario.
//
// This checks, statically: every named import from an index.js, every default
// import, and every `const m = await import(".../index.js"); m.x` use.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", "build", "coverage"]);
const isTest = (p) => /\.test\.m?js$/.test(p);

// Deliberate absences: the scenario asserts the symbol is gone, or probes it
// optionally before reporting BLOCKED.
const ALLOWED = {
  "modules/verify/scenarios/learnerModel.js": ["decideNextAction"], // asserts it is undefined
  "modules/verify/scenarios/handwritingRead.js": ["extractEnabled"], // optional probe (?.), absence means RunPod unset
};

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else if (/\.m?js$/.test(p)) out.push(p);
  }
  return out;
}

const NAMED = /(?:^|[;\n])\s*import\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const DEFAULT = /(?:^|[;\n])\s*import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
const DYN_ASSIGN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+import\(\s*["']([^"']+index\.js)["']\s*\)/g;

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const bits = part.trim().split(/\s+as\s+/);
      if (bits[0]) names.add(bits.length === 2 ? bits[1].trim() : bits[0].trim());
    }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  if (/export\s+default/.test(src)) names.add("default");
  if (/export\s*\*/.test(src)) names.add("*");
  return names;
}

test("every index.js exports every symbol its callers use", async () => {
  const files = (await walk(path.join(ROOT, "modules"))).filter((f) => !isTest(f));
  const barrels = new Map();
  for (const f of files.filter((x) => path.basename(x) === "index.js")) {
    barrels.set(f, exportsOf(await readFile(f, "utf8")));
  }

  const problems = [];
  for (const file of files) {
    const src = await readFile(file, "utf8");
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const allowed = new Set(ALLOWED[rel] || []);

    const targetOf = (spec) => {
      if (!spec.startsWith(".")) return null;
      const base = path.resolve(path.dirname(file), spec);
      const t = [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")].find((p) => p.endsWith(".js") || p.endsWith(".mjs"));
      return t && barrels.has(t) ? t : null;
    };
    const check = (spec, names) => {
      const target = targetOf(spec);
      if (!target) return;
      const have = barrels.get(target);
      if (have.has("*")) return;
      for (const n of names) {
        if (!have.has(n) && !allowed.has(n)) {
          problems.push(`${rel}: ${n} is not exported by ${path.relative(ROOT, target).split(path.sep).join("/")}`);
        }
      }
    };

    for (const m of src.matchAll(NAMED)) check(m[2], m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    for (const m of src.matchAll(DEFAULT)) check(m[2], ["default"]);
    for (const m of src.matchAll(DYN_ASSIGN)) {
      const target = targetOf(m[2]);
      if (!target) continue;
      const have = barrels.get(target);
      if (have.has("*")) continue;
      const re = new RegExp(`\\b${m[1]}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const use of src.matchAll(re)) {
        if (!have.has(use[1]) && !allowed.has(use[1])) {
          problems.push(`${rel}: ${m[1]}.${use[1]} is not exported by ${path.relative(ROOT, target).split(path.sep).join("/")}`);
        }
      }
    }
  }

  assert.deepEqual(problems, [], `${problems.length} barrel mismatch(es):\n  ${problems.join("\n  ")}`);
});
