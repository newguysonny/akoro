// Structural guardrails for the API (Grand Plan Phase 19, step 1).
//
// One scanner, two consumers:
//   scripts/structure-baseline.mjs  writes the allowlist (structure-baseline.json)
//   modules/structure.contract.test.mjs  fails on anything new or grown
//
// The baseline may only shrink: a stale entry is a failure, so the ratchet
// cannot quietly drift back after a cleanup.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const SIZE_LIMIT = 600;

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage"]);
const isTest = (p) => /\.test\.m?js$/.test(p);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (/\.m?js$/.test(p)) out.push(p);
  }
  return out;
}

// Strip comments so import examples in headers do not count as real edges.
// Quote-aware so strings such as "https://…" survive untouched.
function stripComments(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      out += ch;
      if (ch === "\\") { out += src[++i] ?? ""; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; out += ch; continue; }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

const STATIC_IMPORT = /\b(?:import|export)\s+(?:[^;"'`]*?\sfrom\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiers(src) {
  const clean = stripComments(src);
  const found = [];
  for (const re of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) found.push(m[1]);
  }
  return found;
}

async function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, path.join(base, "index.js")]) {
    if (!/\.m?js$/.test(candidate)) continue;
    try {
      await readFile(candidate);
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

export async function scanStructure(root) {
  root = path.resolve(root);
  const modulesDir = path.join(root, "modules");
  const all = await walk(root);

  const moduleNames = (await readdir(modulesDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);
  const moduleSet = new Set(moduleNames);
  const moduleOf = (abs) => {
    const rel = path.relative(modulesDir, abs);
    if (rel.startsWith("..")) return null;
    const first = rel.split(path.sep)[0];
    return moduleSet.has(first) ? first : null;
  };

  const oversized = {};
  const crossModuleImports = new Set();
  const edges = new Map(); // module → Set(module)

  for (const file of all) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const src = await readFile(file, "utf8");
    const lines = src.split("\n").length;
    if (lines > SIZE_LIMIT) oversized[rel] = lines;

    const fromModule = moduleOf(file);
    if (!fromModule || isTest(file)) continue;
    for (const spec of specifiers(src)) {
      const target = await resolveSpecifier(file, spec);
      if (!target) continue;
      const toModule = moduleOf(target);
      if (!toModule || toModule === fromModule) continue;
      const entry = path.join(modulesDir, toModule, "index.js");
      if (target !== entry) {
        const targetRel = path.relative(root, target).split(path.sep).join("/");
        crossModuleImports.add(`${rel} -> ${targetRel}`);
      }
      if (!edges.has(fromModule)) edges.set(fromModule, new Set());
      edges.get(fromModule).add(toModule);
    }
  }

  // Module-level cycles: strongly connected components with more than one
  // member, plus any module importing itself.
  const cycles = [];
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  let counter = 0;

  function strongConnect(v) {
    index.set(v, counter);
    low.set(v, counter++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) || []) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do { w = stack.pop(); onStack.delete(w); component.push(w); } while (w !== v);
      if (component.length > 1) cycles.push(component.sort().join("|"));
    }
  }
  for (const name of moduleNames) if (!index.has(name)) strongConnect(name);

  const missingReadmes = [];
  for (const name of moduleNames) {
    try {
      await readFile(path.join(modulesDir, name, "README.md"));
    } catch {
      missingReadmes.push(name);
    }
  }

  return {
    files: all.length,
    oversized: Object.fromEntries(Object.entries(oversized).sort(([a], [b]) => a.localeCompare(b))),
    crossModuleImports: [...crossModuleImports].sort(),
    cycles: [...new Set(cycles)].sort(),
    cyclicModules: [...new Set(cycles.flatMap((c) => c.split("|")))].sort(),
    missingReadmes: missingReadmes.sort(),
    moduleNames,
  };
}

// The ratchet rules, shared by the generator's report and the contract test.
// Returns human-readable failures; empty means the structure is no worse than
// the baseline.
export function compareToBaseline(scan, baseline) {
  const failures = [];

  for (const [file, lines] of Object.entries(scan.oversized)) {
    const allowed = baseline.oversized?.[file];
    if (allowed === undefined) failures.push(`new file over ${SIZE_LIMIT} lines: ${file} (${lines})`);
    else if (lines > allowed) failures.push(`${file} grew: ${allowed} → ${lines} lines`);
  }
  for (const file of Object.keys(baseline.oversized || {})) {
    if (scan.oversized[file] === undefined) failures.push(`baseline entry no longer oversized — remove it: ${file}`);
  }

  const knownImports = new Set(baseline.crossModuleImports || []);
  const currentImports = new Set(scan.crossModuleImports);
  for (const edge of currentImports) if (!knownImports.has(edge)) failures.push(`imports another module's internals: ${edge}`);
  for (const edge of knownImports) if (!currentImports.has(edge)) failures.push(`baseline import fixed — remove it: ${edge}`);

  // Cycle membership per module, not per component: when a big cycle is split
  // into smaller ones the modules that stopped cycling are simply stale
  // baseline entries, never a "new cycle".
  const knownCyclic = new Set(baseline.cyclicModules || []);
  const currentCyclic = new Set(scan.cyclicModules);
  for (const name of currentCyclic) if (!knownCyclic.has(name)) failures.push(`module is in an import cycle: modules/${name}`);
  for (const name of knownCyclic) if (!currentCyclic.has(name)) failures.push(`no longer in a cycle — remove from baseline: modules/${name}`);

  const knownMissing = new Set(baseline.missingReadmes || []);
  const currentMissing = new Set(scan.missingReadmes);
  for (const name of currentMissing) if (!knownMissing.has(name)) failures.push(`module without README.md: modules/${name}`);
  for (const name of knownMissing) if (!currentMissing.has(name)) failures.push(`README added — remove from baseline: modules/${name}`);

  return failures;
}
