import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// ─────────────────────────────────────────────────────────────────────────────
// Render boot crashed with "does not provide an export named 'invalid'" — a
// link error that node --check and every static-text contract test sailed
// past. This test resolves EVERY relative import in akoro-api and verifies the
// named bindings actually exist in the target module, so a renamed or missing
// export fails CI instead of a production boot.
// ─────────────────────────────────────────────────────────────────────────────

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

const exportCache = new Map(); // file → Set(names)
const IS_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Strip comments before scanning — file headers carry usage examples like
// `import x from "./modules/foo/index.js"` inside comment blocks. Quote-aware
// so "https://…" strings survive.
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
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    out += ch;
  }
  return out;
}

function collectExportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export { a, b as c } (…from "./x.js" — re-export names count too; if the
  // re-export source lost the binding, that source's own edges fail instead).
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const asName = seg.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asName ? asName[1] : seg.split(/\s+/)[0];
      if (IS_IDENTIFIER.test(name)) names.add(name);
    }
  }
  if (/export\s+default\b/.test(src)) names.add("default");
  return names;
}

async function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  exportCache.set(file, new Set()); // cycle guard
  const names = collectExportedNames(await readFile(file, "utf8"));
  exportCache.set(file, names);
  return names;
}

test("every relative named import resolves to a real export in akoro-api", async () => {
  const files = await walk(API_ROOT);
  const violations = [];
  const edges = []; // { from, spec, names, line }

  for (const file of files) {
    const src = stripComments(await readFile(file, "utf8"));
    for (const m of src.matchAll(/import\s+[^;]*?from\s*["']([^"']+)["']|export\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/g)) {
      const spec = m[1] || m[2];
      if (!spec || !spec.startsWith(".")) continue; // bare packages: node resolves
      const target = path.resolve(path.dirname(file), spec);
      let exists = false;
      try { exists = (await stat(target)).isFile(); } catch { /* fall through */ }
      if (!exists) { violations.push(`${path.relative(API_ROOT, file)} → missing module ${spec}`); continue; }

      // Named bindings from `import defaults, { a, b as c } from "…"`
      const names = [];
      if (m[0].startsWith("import")) {
        const bracePart = m[0].match(/\{([^}]*)\}/);
        if (bracePart) {
          for (const part of bracePart[1].split(",")) {
            const seg = part.trim();
            if (!seg) continue;
            const asName = seg.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
            const imported = asName ? seg.slice(0, asName.index).trim() : seg;
            if (IS_IDENTIFIER.test(imported)) names.push(imported);
          }
        }
      }
      edges.push({ from: file, target, names, line: src.slice(0, m.index).split("\n").length, spec });
    }
  }

  for (const edge of edges) {
    if (!edge.names.length) continue;
    const exported = await exportsOf(edge.target);
    for (const name of edge.names) {
      if (!exported.has(name)) {
        violations.push(
          `${path.relative(API_ROOT, edge.from)}:${edge.line} imports "${name}" from ${edge.spec} — not exported there`,
        );
      }
    }
  }
  assert.equal(violations.length, 0, `broken ESM links:\n  ${violations.join("\n  ")}`);
});
