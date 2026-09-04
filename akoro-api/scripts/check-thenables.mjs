#!/usr/bin/env node
/**
 * check-thenables.mjs — catch `.catch()` chained onto a Supabase query builder.
 *
 * A Supabase builder is a THENABLE, not a Promise. It has .then(), so it awaits
 * like one and reads like one, but there is no .catch method on it. Chaining
 * one throws synchronously, before the query is ever sent, with a message that
 * spells out the whole chain:
 *
 *   supabase.schema(...).from(...).select(...).eq(...).eq(...).order(...)
 *     .catch is not a function
 *
 * It is a nasty defect because it looks like defensive code. The author wrote
 * `.catch(() => ({ data: null }))` specifically so a failed lookup could not
 * break the feature, and the line they added to prevent a crash is the crash.
 * It only fires when that path actually runs, so it survives review, survives
 * tests that do not reach it, and surfaces months later as a broken button.
 *
 * This has now been fixed three separate times in this codebase. Grep is a
 * cheaper guard than memory.
 *
 *   node scripts/check-thenables.mjs        # exits 1 if any are found
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

/**
 * Builder terminals — the last call before someone reaches for .catch.
 *
 * Deliberately a list of QUERY methods rather than "anything followed by
 * .catch": plenty of real promises are caught correctly, and a check that
 * shouts about those would be turned off within a week.
 */
const TERMINALS = [
  "select", "insert", "update", "upsert", "delete", "rpc",
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "or", "not",
  "order", "limit", "range", "single", "maybeSingle", "csv", "geojson",
  "contains", "containedBy", "overlaps", "match", "filter", "textSearch",
];

// `.order("confidence", { ascending: true })\n    .catch(...)` — the newline
// between them is why an eyeball scan misses these.
const PATTERN = new RegExp(
  String.raw`\.(?:${TERMINALS.join("|")})\s*\([^;]{0,400}?\)\s*(?:\r?\n\s*)?\.catch\s*\(`,
  "g",
);

/**
 * Strip comments before matching.
 *
 * Without this the checker flags the comments that DOCUMENT past occurrences of
 * this bug — including the one in self-study/routes.js explaining the fix. A
 * checker whose first report is a false positive is a checker somebody turns
 * off, and then the real ones go unnoticed too.
 *
 * Whole-line stripping rather than parsing: it costs nothing and cannot mangle
 * a URL inside a string literal, which naive `//` removal does.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*)/.test(l) ? "" : l))
    .join("\n");
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|mjs)$/.test(name)) yield full;
  }
}

const hits = [];
for (const file of walk(ROOT)) {
  const raw = readFileSync(file, "utf8");
  if (!raw.includes(".catch")) continue;
  const src = stripComments(raw);
  for (const m of src.matchAll(PATTERN)) {
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ file: relative(ROOT, file), line, snippet: m[0].replace(/\s+/g, " ").slice(0, 90) });
  }
}

if (!hits.length) {
  console.log("✓ no .catch() chained onto a Supabase builder");
  process.exit(0);
}

console.error(`\n✗ ${hits.length} builder .catch() found — these throw synchronously:\n`);
for (const h of hits) console.error(`  ${h.file}:${h.line}\n    ${h.snippet}…\n`);
console.error("A Supabase builder is a thenable with no .catch. Use try/catch around the await.\n");
process.exit(1);
