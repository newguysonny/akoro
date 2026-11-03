/**
 * Grand Plan Phase 18 item 7 — admin-editable prompt parts with "Default
 * updated". The defaults stay the akoro-agent/ files; an override replaces
 * one manifest file at load time, records the default it was based on, and
 * survives a deploy that changes that default (flagged default_updated with
 * both texts). Golden tests keep comparing the DEFAULTS: nothing is
 * overridden until the boot installs a store.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const O = await import("./overrides.js");
const CM = await import("./context-manager.js");
const { SETS } = await import("./manifest.mjs");
const { tutorSystemPrompt, protegeIdentity } = await import("./chat-doctrine.js");
const store = await import("./override-store.js");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const fileText = (rel) => read(`../../akoro-agent/${rel}`);
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fixedCache = (rows) => O.createOverrideCache({ fetchRows: async () => rows });

/* ── Pure rules ───────────────────────────────────────────────────────── */

test("the editable parts are exactly the files the manifest loads", () => {
  const parts = O.editableParts();
  const files = new Set(Object.values(SETS).flatMap((d) => d.files));
  assert.deepEqual(parts.map((p) => p.file).sort(), [...files].sort());
  assert.ok(parts.find((p) => p.file === "identity/SOUL.md").sets.includes("chat_student"));
  for (const bad of ["../app.js", "policies/NOT_A_FILE.md", "modules/agent-runtime/harness.js", ""]) assert.equal(O.isEditable(bad), false, bad);
});

test("an override keeps the placeholders, fits the budgets and is not empty", () => {
  const def = fileText("identity/PROTEGE.md");
  assert.deepEqual(O.tokensOf(def), ["agentName", "learnerName", "level", "personality", "sessions"]);
  assert.equal(O.validateOverride({ file: "identity/PROTEGE.md", text: def.replace("{{level}}", "3"), defaultText: def }).ok, false);
  assert.match(O.validateOverride({ file: "identity/PROTEGE.md", text: def.replace("{{level}}", "3"), defaultText: def }).problems[0], /\{\{level\}\}/);
  assert.match(O.validateOverride({ file: "identity/PROTEGE.md", text: `${def} {{school}}`, defaultText: def }).problems[0], /\{\{school\}\}/);
  assert.equal(O.validateOverride({ file: "identity/PROTEGE.md", text: "   ", defaultText: def }).ok, false);
  assert.equal(O.validateOverride({ file: "identity/PROTEGE.md", text: `${def}${"x".repeat(9000)}`, defaultText: def }).ok, false);
  assert.equal(O.validateOverride({ file: "../app.js", text: "x", defaultText: "x" }).ok, false);
  assert.equal(O.validateOverride({ file: "identity/PROTEGE.md", text: `Friendlier. ${def}`, defaultText: def }).ok, true);
  const over = O.validateOverride({ file: "channels/CHAT.md", text: "Hi {{agentName}}", defaultText: "{{agentName}}", setBytes: () => 30_000 });
  assert.match(over.problems[0], /budget/);
});

test("status: default, overridden, or default_updated when the default it was based on moved", () => {
  const def = "the shipped text";
  assert.equal(O.partStatus({ defaultText: def, override: null }), "default");
  assert.equal(O.partStatus({ defaultText: def, override: { text: "mine", base_hash: O.hashText(def) } }), "overridden");
  assert.equal(O.partStatus({ defaultText: "the NEW shipped text", override: { text: "mine", base_hash: O.hashText(def) } }), "default_updated");
});

test("the override cache: one read per TTL, a fresh read after a save, the last copy kept on a failed read", async () => {
  let t = 0;
  let reads = 0;
  let fail = false;
  let rows = [{ file: "a.md", text: "A1", base_hash: "h" }];
  const cache = O.createOverrideCache({ ttlMs: 1000, now: () => t, fetchRows: async () => { reads += 1; if (fail) throw new Error("db down"); return rows; } });
  assert.equal((await cache.get()).get("a.md").text, "A1");
  await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.equal(reads, 1, "within the TTL every model call uses the cached copy");
  rows = [{ file: "a.md", text: "A2", base_hash: "h" }];
  cache.invalidate();
  assert.equal((await cache.get()).get("a.md").text, "A2", "a save is seen at once");
  t = 5000; fail = true;
  const warn = console.warn; console.warn = () => {};
  try { assert.equal((await cache.get()).get("a.md").text, "A2", "a failed read keeps the last copy"); } finally { console.warn = warn; }
  assert.equal(reads, 3);
});

/* ── The loader ───────────────────────────────────────────────────────── */

test("with no store installed (tests, golden fixtures) every load is the shipped default", async () => {
  O.uninstallOverrides();
  assert.equal(O.overridesInstalled(), false);
  assert.equal(await CM.loadDoctrine("channels/CHAT.md"), fileText("channels/CHAT.md").trim());
  assert.equal(await CM.loadRaw("identity/PROTEGE.md"), fileText("identity/PROTEGE.md"));
  for (const f of ["agentContext.golden.chat.test.mjs", "agentContext.golden.personas.test.mjs"]) {
    assert.doesNotMatch(read(`./${f}`), /installOverrides|installPromptOverrides|override-store/, `${f} compares the defaults`);
  }
});

test("the loader prefers an override; off switch and uninstall go back to the default", async () => {
  const before = await CM.contextVersion();
  const text = "You are {{agentName}}, an edited tutor persona.";
  O.installOverrides(fixedCache([{ file: "channels/CHAT.md", text, base_hash: O.hashText(fileText("channels/CHAT.md")) }]));
  try {
    assert.equal(await CM.loadDoctrine("channels/CHAT.md"), text);
    assert.match(await tutorSystemPrompt({ agentName: "Kemi" }), /^You are Kemi, an edited tutor persona\./, "the model's prompt uses it");
    assert.equal(await CM.loadDefaultRaw("channels/CHAT.md"), fileText("channels/CHAT.md"), "the default stays readable for the diff");
    assert.equal(await CM.contextVersion(), before, "the drift hash is over the shipped defaults");
    assert.equal((await CM.preflight()).ok, true);
    process.env.AGENT_PROMPT_OVERRIDES = "off";
    assert.equal(await CM.loadDoctrine("channels/CHAT.md"), fileText("channels/CHAT.md").trim(), "AGENT_PROMPT_OVERRIDES=off");
    delete process.env.AGENT_PROMPT_OVERRIDES;
  } finally { O.uninstallOverrides(); delete process.env.AGENT_PROMPT_OVERRIDES; }
  assert.equal(await CM.loadDoctrine("channels/CHAT.md"), fileText("channels/CHAT.md").trim());
});

test("a template override still renders through the persona engine (placeholders filled)", async () => {
  const def = fileText("identity/PROTEGE.md");
  O.installOverrides(fixedCache([{ file: "identity/PROTEGE.md", text: `EDITED. ${def}`, base_hash: O.hashText(def) }]));
  try {
    const out = await protegeIdentity({ agentName: "Kemi", learnerName: "Tolu", level: 2, sessions: 3 });
    assert.match(out, /^EDITED\. /);
    assert.doesNotMatch(out, /\{\{\w+\}\}/);
  } finally { O.uninstallOverrides(); }
});

test("an override survives a deploy that changes its default: still served, flagged with both texts", async () => {
  const oldDefault = "An older shipped CHAT.md for {{agentName}}.";
  const mine = "My edited CHAT.md for {{agentName}}.";
  const fake = installFakeDb(db, { "edu.agent_prompt_overrides": [{ file: "channels/CHAT.md", text: mine, base_hash: O.hashText(oldDefault), base_text: oldDefault, updated_at: "2026-10-01T00:00:00Z" }] });
  store.installPromptOverrides({ env: {} });
  try {
    assert.equal(await CM.loadDoctrine("channels/CHAT.md"), mine, "the deploy's new default doesn't replace the admin's text");
    const part = await store.readPart("channels/CHAT.md");
    assert.equal(part.status, "default_updated");
    assert.equal(part.based_on.text, oldDefault, "the default it was based on");
    assert.equal(part.default.text, fileText("channels/CHAT.md"), "the new default");
    assert.equal(part.override.text, mine);
    assert.equal((await store.listParts()).find((p) => p.file === "channels/CHAT.md").status, "default_updated");

    // Keep mine: the text stays, now based on the new default.
    const kept = await store.keepMine({ file: "channels/CHAT.md", actorId: ADMIN });
    assert.equal(kept.status, "overridden");
    assert.equal(kept.based_on, undefined);
    assert.equal(await CM.loadDoctrine("channels/CHAT.md"), mine);
    await assert.rejects(store.keepMine({ file: "channels/CHAT.md", actorId: ADMIN }), /has not changed/);

    // Use the new default (after another deploy moved it again).
    fake.rows("edu.agent_prompt_overrides")[0].base_hash = O.hashText(oldDefault);
    const taken = await store.useNewDefault({ file: "channels/CHAT.md", actorId: ADMIN });
    assert.equal(taken.status, "default");
    assert.equal(fake.rows("edu.agent_prompt_overrides").length, 0);
    assert.equal(await CM.loadDoctrine("channels/CHAT.md"), fileText("channels/CHAT.md").trim(), "seen at once (cache invalidated)");
    assert.deepEqual(fake.rows("edu.agent_prompt_override_history").map((h) => h.action), ["keep_mine", "use_new_default"]);
  } finally { O.uninstallOverrides(); fake.restore(); }
});

test("edit, history and reset through the store; bad edits refused; the assembled prompt", async () => {
  const fake = installFakeDb(db, {});
  store.installPromptOverrides({ env: {} });
  try {
    const def = fileText("identity/PROTEGE.md");
    const edited = await store.editPart({ file: "identity/PROTEGE.md", text: `Warmer. ${def}`, note: "warmer opener", actorId: ADMIN });
    assert.equal(edited.status, "overridden");
    const row = fake.rows("edu.agent_prompt_overrides")[0];
    assert.equal(row.base_hash, O.hashText(def));
    assert.equal(row.base_text, def, "records the default it was based on");
    assert.equal(row.updated_by, ADMIN);
    assert.match(await CM.loadRaw("identity/PROTEGE.md"), /^Warmer\. /, "the next model call sees it");

    await assert.rejects(store.editPart({ file: "identity/PROTEGE.md", text: "No placeholders at all", actorId: ADMIN }), (e) => e.status === 422 && /placeholders/.test(e.message));
    await assert.rejects(store.editPart({ file: "../modules/agent-runtime/harness.js", text: "x", actorId: ADMIN }), (e) => e.status === 404);

    const asm = await store.assembledPrompt({ set: "chat_protege" });
    assert.equal(asm.files.find((f) => f.file === "identity/PROTEGE.md").overridden, true);
    assert.match(asm.text, /Warmer\. /);
    assert.doesNotMatch((await store.assembledPrompt({ set: "chat_protege", source: "default" })).text, /Warmer\. /);
    assert.match((await store.assembledPrompt({ set: "planning" })).text, /^# AGENT\.md\n/);
    await assert.rejects(store.assembledPrompt({ set: "nope" }), (e) => e.status === 404);

    const reset = await store.resetPart({ file: "identity/PROTEGE.md", actorId: ADMIN });
    assert.equal(reset.status, "default");
    assert.equal(await CM.loadRaw("identity/PROTEGE.md"), def);
    assert.deepEqual((await store.partHistory("identity/PROTEGE.md")).map((h) => h.action).sort(), ["edit", "reset"]);
    // Saving the default's own text is a reset, not an override.
    await store.editPart({ file: "identity/PROTEGE.md", text: def, actorId: ADMIN });
    assert.equal(fake.rows("edu.agent_prompt_overrides").length, 0);
  } finally { O.uninstallOverrides(); fake.restore(); }
});

test("admin routes are admin-only; the boot installs the store after the defaults' preflight", () => {
  const src = read("../admin/agent-prompts.js");
  const routes = [...src.matchAll(/router\.(get|post|put|delete)\("([^"]+)", (\w+)/g)];
  assert.equal(routes.length, 9);
  for (const [, , path, guard] of routes) assert.equal(guard, "adminOnly", path);
  assert.match(src, /requireRole\(\["admin"\]\)/);
  assert.match(read("../admin/index.js"), /router\.use\("\/", agentPromptsRouter\);/);
  const app = read("../../app.js");
  assert.ok(app.indexOf("installPromptOverrides()") > app.indexOf("await preflight()"), "installed after the preflight of the defaults");
  // Nothing code-enforced is a prompt part: the harness, policies and verdicts are code.
  for (const f of O.editableParts().map((p) => p.file)) assert.match(f, /\.md$/);
});

test("the migration is idempotent and registered in the schema list", () => {
  const sql = read("../../migrations/2026-agent-prompt-overrides.sql");
  for (const stmt of sql.match(/^(CREATE|ALTER)[^;]+;/gm) || []) assert.match(stmt, /IF NOT EXISTS|ENABLE ROW LEVEL SECURITY/, stmt);
  assert.match(sql, /base_hash\s+text NOT NULL/);
  assert.match(sql, /base_text\s+text NOT NULL/);
  assert.match(sql, /REVOKE ALL ON edu\.agent_prompt_overrides FROM anon, authenticated/);
  assert.ok(JSON.parse(read("../../migrations/manifest.json")).schema.includes("2026-agent-prompt-overrides.sql"));
});
