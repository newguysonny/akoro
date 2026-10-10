import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";

/**
 * Every edu table or view the API reads or writes must be created by a
 * migration. Nothing else catches a wrong table name: the contract tests
 * mock the database, so a write to a table that does not exist only fails
 * in production. That is how every audio/video transcription broke — the
 * code wrote edu.record_transcripts while the migration created
 * edu.content_transcripts.
 */
const root = new URL("..", import.meta.url).pathname;

// Deliberate fallbacks to tables from before the migrations folder, wrapped
// in try/catch with defaults. Listed with the reason; nothing new belongs here.
const LEGACY_FALLBACKS = new Map([
  ["agent_preferences", "student-state.js reads it only when edu.user_agent_preferences has no row"],
  ["agent_orchestration_configs", "courses/agents.js reads a TTS voice; defaults when absent"],
]);

async function walk(dir, pick, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, pick, out);
    else if (pick(entry.name)) out.push(path);
  }
  return out;
}

test("every edu table the API uses is created by a migration", async () => {
  const created = new Set();
  for (const file of await walk(join(root, "migrations"), (n) => n.endsWith(".sql"))) {
    const sql = await readFile(file, "utf8");
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:unlogged\s+)?(?:materialized\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?"?edu"?\."?([a-z_0-9]+)/gi)) {
      created.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?"?edu"?\."?[a-z_0-9]+"?\s+rename\s+to\s+"?([a-z_0-9]+)/gi)) {
      created.add(m[1].toLowerCase());
    }
  }
  assert.ok(created.size > 50, `expected the migration set, found ${created.size} tables`);

  const missing = [];
  const sources = await walk(root, (n) => /\.(m?js)$/.test(n) && !n.includes(".test."));
  for (const file of sources) {
    const code = await readFile(file, "utf8");
    for (const m of code.matchAll(/schema\(\s*["']edu["']\s*\)\s*\.from\(\s*["']([a-z_0-9]+)["']/g)) {
      const table = m[1];
      if (!created.has(table) && !LEGACY_FALLBACKS.has(table)) {
        missing.push(`edu.${table} (${relative(root, file)})`);
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], "tables used in code but created by no migration");
});

test("transcripts are written to the same table they are cleared from and read from", async () => {
  const lib = await readFile(join(root, "modules/records/avTranscribeLib.js"), "utf8");
  const tables = [...lib.matchAll(/schema\("edu"\)\s*\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 3, "delete, insert and read");
  assert.deepEqual([...new Set(tables)], ["content_transcripts"]);
});
