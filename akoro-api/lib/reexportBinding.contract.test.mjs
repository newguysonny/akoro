import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Re-export binding contract (added after the P1 agent-chat outage).
 *
 * The trap: `export { X } from "mod"` is a RE-EXPORT — it does not create a
 * local binding for X. Any other use of X in the same file is a
 * ReferenceError that only fires when that code RUNS. It sails past
 * `node --check` (syntax-only), past source-grep contract tests (the name
 * appears in the file!), and past boot smoke (the route needs auth + DB to
 * execute). It took the live /agent route down: every chat turn threw
 * "ReferenceError: assembleChatDoctrine is not defined".
 *
 * Detection is deliberately CONSERVATIVE — no tokenizing (a hand-rolled JS
 * tokenizer desyncs on this repo's 274-backtick chat.js and silently sees
 * nothing). If a re-exported name appears anywhere else in the file — even
 * in a comment or a string — the file must also carry a local import
 * binding for it. False positives are resolved by adding the import (which
 * is exactly the fix) or rewording the mention; false negatives are not
 * possible for this trap class.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RE_EXPORT = /export\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g;
const RE_IMPORT_BINDING = (name) => new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from|import\\s+${name}\\s+from|import\\s*\\*\\s*as\\s+${name}\\s+from`);

async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (/\.(js|mjs)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no re-exported name is used locally without a local import binding (ReferenceError trap)", async () => {
  const files = [
    ...(await collect(path.join(ROOT, "modules"))),
    ...(await collect(path.join(ROOT, "lib"))),
    path.join(ROOT, "app.js"),
  ];
  assert.ok(files.length > 100, `scanning a real tree (${files.length} files)`);

  const offenders = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const statements = [...raw.matchAll(RE_EXPORT)];
    if (!statements.length) continue;
    const withoutExports = statements.reduce((acc, m) => acc.split(m[0]).join(""), raw);
    for (const statement of statements) {
      for (const entryRaw of statement[1].split(",")) {
        const entry = entryRaw.trim();
        if (!entry) continue;
        const parsed = entry.match(/^(\w+)(?:\s+as\s+(\w+))?$/);
        if (!parsed) continue;
        const exportedName = parsed[2] || parsed[1]; // the name importers see; local use needs this bound
        if (new RegExp(`\\b${exportedName}\\b`).test(withoutExports) && !RE_IMPORT_BINDING(exportedName).test(raw)) {
          offenders.push(
            `${path.relative(ROOT, file)}: "${exportedName}" is re-exported (export { … } from) and appears elsewhere in the file, but has no local import binding — a re-export does NOT bind locally; this is the ReferenceError class that took the /agent route down. Import it locally and re-export the binding.`,
          );
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `re-export/local-use traps:\n${offenders.join("\n")}`);
});
