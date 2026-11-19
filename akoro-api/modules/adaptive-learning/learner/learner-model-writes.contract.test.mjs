// Phase 10 exit (Grand Plan §7.8, D37): nothing outside the Education Engine
// writes the learner model directly. learner_concept_state and
// learner_concept_evidence change ONLY through the one recorder
// (learning-events.js → edu.record_learner_concept_evidence), whose policy
// lives in SQL in migrations/. This test greps the whole repository for:
//   • a client write: .from("learner_concept_state" | "learner_concept_evidence")
//     (or Python .table(...)) followed by .insert / .update / .upsert / .delete
//   • raw SQL: INSERT INTO / UPDATE / DELETE FROM / TRUNCATE on either table
//   • a call to any SQL function that writes either table (found by reading
//     the migrations, so a new writer function is covered automatically)
// and fails on any hit outside the small explicit allowlist below.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const API = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO = existsSync(join(API, "..", "akoro-api")) ? join(API, "..") : API;
const rel = (file) => relative(REPO, file).split(sep).join("/");
const API_PREFIX = REPO === API ? "" : "akoro-api/";

const TABLES = "learner_concept_(?:state|evidence)";
const SKIP_DIRS = new Set(["node_modules", ".git", "archive", "dist", "build", ".next", ".claude", "coverage", "__pycache__", ".venv", "venv"]);
const CODE = /\.(?:m?js|cjs|jsx|tsx?|py|sql)$/;

/**
 * Who may write, and how. Every entry names the writes it is allowed; any
 * other write in the same file is still a violation.
 */
const ALLOW = [
  // The Education Engine's SQL (the recorder's policy, retention refresh, backfills).
  { path: new RegExp(`^${API_PREFIX}migrations/`), all: true, why: "migrations: the Education Engine's SQL lives here" },
  // Tests and their fixtures.
  { path: /(?:\.test\.m?js|\.seam\.test\.mjs|\.contract\.test\.mjs)$/, all: true, why: "tests" },
  { path: /^akoro-python-agent\/tests\//, all: true, why: "python tests" },
  // The one recorder (and its retention refresh). The Python agent's
  // concept-state gateway goes through it too, passing the curriculum
  // guardian's validated claim (recordLearningEvent({ claim })).
  { path: `${API_PREFIX}modules/adaptive-learning/learner/learning-events.js`, rpc: ["record_learner_concept_evidence", "refresh_learner_concept_retention"], why: "the recorder (Phase 4a, D37)" },
  // Gate cleanup may remove what a scenario wrote (delete only).
  { path: new RegExp(`^${API_PREFIX}modules/verify/`), deleteOnly: true, why: "verify cleanup" },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (CODE.test(name) && st.size < 2_000_000) out.push(full);
  }
  return out;
}

/** SQL functions (from migrations) whose body writes either table. */
export function writerFunctions(sqlTexts) {
  const names = new Set();
  for (const sql of sqlTexts) {
    const parts = sql.split(/(?=\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b)/i);
    for (const part of parts) {
      const head = part.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/i);
      if (!head) continue;
      const body = part.split(/\n\s*CREATE\s+(?!OR\s+REPLACE\s+FUNCTION)/i)[0];
      if (new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:"?\\w+"?\\.)?"?${TABLES}\\b`, "i").test(body)) names.add(head[2]);
    }
  }
  return names;
}

/** Every direct write in one file's text → [{ kind, detail, line }]. */
export function findWrites(text, writers) {
  const hits = [];
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  // Client builder writes (supabase-js .from / supabase-py .table).
  const builder = new RegExp(`\\.(?:from|table)\\(\\s*["'\`](?:edu\\.)?${TABLES}["'\`]\\s*\\)`, "g");
  for (const m of text.matchAll(builder)) {
    const statement = text.slice(m.index, m.index + 600).split(/;\s*$|;\n|\n\s*\n/m)[0];
    const op = statement.match(/\.(insert|update|upsert|delete)\s*\(/);
    if (op) hits.push({ kind: op[1] === "delete" ? "delete" : "client_write", detail: `${m[0]}…${op[0]}`, line: lineOf(m.index) });
  }
  // Raw SQL.
  const raw = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:"?\\w+"?\\.)?"?${TABLES}\\b`, "gi");
  for (const m of text.matchAll(raw)) hits.push({ kind: /^DELETE/i.test(m[1]) ? "delete" : "raw_sql", detail: m[0], line: lineOf(m.index) });
  // Calls to SQL writer functions (rpc("…") or SELECT edu.fn(…)).
  for (const fn of writers) {
    const call = new RegExp(`(?:rpc\\(\\s*["'\`]${fn}["'\`]|\\b(?:edu\\.)?${fn}\\s*\\()`, "g");
    for (const m of text.matchAll(call)) hits.push({ kind: "rpc", fn, detail: m[0], line: lineOf(m.index) });
  }
  return hits;
}

function allowed(path, hit) {
  for (const rule of ALLOW) {
    const match = typeof rule.path === "string" ? rule.path === path : rule.path.test(path);
    if (!match) continue;
    if (rule.all) return true;
    if (rule.deleteOnly && hit.kind === "delete") return true;
    if (rule.rpc && hit.kind === "rpc" && rule.rpc.includes(hit.fn)) return true;
  }
  return false;
}

const files = walk(REPO);
const migrations = files.filter((f) => rel(f).startsWith(`${API_PREFIX}migrations/`) && f.endsWith(".sql"));
const WRITERS = writerFunctions(migrations.map((f) => readFileSync(f, "utf8")));

test("the migrations' writer functions are found (the scan is not blind)", () => {
  assert.ok(WRITERS.has("record_learner_concept_evidence"), [...WRITERS].join(","));
  assert.ok(WRITERS.has("refresh_learner_concept_retention"), [...WRITERS].join(","));
});

test("the scanner catches every shape of direct write", () => {
  const w = new Set(["record_learner_concept_evidence"]);
  const kinds = (src) => findWrites(src, w).map((h) => h.kind);
  assert.deepEqual(kinds(`await db.schema("edu").from("learner_concept_state").upsert({ mastery: 1 });`), ["client_write"]);
  assert.deepEqual(kinds(`db.schema("edu")\n  .from("learner_concept_evidence")\n  .select("id")\n  .insert(row)`), ["client_write"]);
  assert.deepEqual(kinds(`client.table("learner_concept_state").update({"mastery": 1}).execute()`), ["client_write"]);
  assert.deepEqual(kinds(`await sql\`UPDATE edu.learner_concept_state SET mastery = 1\``), ["raw_sql"]);
  assert.deepEqual(kinds(`INSERT INTO "edu"."learner_concept_evidence" (id) VALUES (1)`), ["raw_sql"]);
  assert.deepEqual(kinds(`await db.schema("edu").rpc("record_learner_concept_evidence", {})`), ["rpc"]);
  assert.deepEqual(kinds(`await db.from("learner_concept_state").delete().eq("learner_id", id)`), ["delete"]);
  // Reads are fine.
  assert.deepEqual(kinds(`await db.schema("edu").from("learner_concept_state").select("mastery").eq("learner_id", id);`), []);
  assert.deepEqual(kinds(`ctx.db.rows("edu.learner_concept_state", { learner_id: id })`), []);
});

test("Phase 10 exit: no direct writes to concept state outside the Education Engine", () => {
  const violations = [];
  for (const file of files) {
    const path = rel(file);
    const text = readFileSync(file, "utf8");
    if (!/learner_concept_|record_learner_concept|refresh_learner_concept/.test(text) && ![...WRITERS].some((fn) => text.includes(fn))) continue;
    for (const hit of findWrites(text, WRITERS)) {
      if (!allowed(path, hit)) violations.push(`${path}:${hit.line} ${hit.kind} ${hit.detail.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.deepEqual(violations, [], `direct learner-model writes outside the Education Engine — record through learning-events.js:\n${violations.join("\n")}`);
});

test("the allowlist is small, explicit and not stale", () => {
  assert.ok(ALLOW.length <= 6, "keep the allowlist small");
  for (const rule of ALLOW) {
    assert.ok(rule.why, "every allowlist entry says why");
    if (typeof rule.path === "string") assert.ok(existsSync(join(REPO, rule.path)), `allowlisted file is gone: ${rule.path}`);
  }
  // The recorder really is the one that writes.
  const recorder = readFileSync(join(API, "modules/adaptive-learning/learner/learning-events.js"), "utf8");
  assert.match(recorder, /rpc\("record_learner_concept_evidence"/);
});
