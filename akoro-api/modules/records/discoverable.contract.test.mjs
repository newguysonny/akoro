/**
 * modules/records/discoverable.contract.test.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * The Premium sharing choice (Matt, 2026-11-26): uploads are public for
 * free users and private for Premium subscribers — and a Premium
 * subscriber may set ONE record public (records.discoverable = true).
 * The opt-in must hold on every surface that applies the Discover rule,
 * and it must never override `private` (a chat upload stays owner-only).
 *
 * Two layers, matching this repo's habits:
 *   · source-contract pins for the surfaces whose rule rides in SQL /
 *     PostgREST filter strings (feed, platform search, study material,
 *     the PATCH surface);
 *   · behavioural tests of access.js itself, with db.js stubbed in
 *     memory (mock.module) — the five cases the product rule names.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { mock } from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");
const [accessSrc, serviceSrc, storeSrc, searchSrc, studyStoreSrc, migration, manifest] = await Promise.all([
  read("./access.js"),
  read("./service-records.js"),
  read("./store-records.js"),
  read("./searchLib.js"),
  read("./study-material-store.js"),
  read("../../migrations/2026-record-discoverable.sql"),
  read("../../migrations/manifest.json"),
]);

/* ── The column + its registration ─────────────────────────────────────── */

test("the migration adds records.discoverable, idempotently, and registers in the manifest", () => {
  assert.match(migration, /ALTER TABLE edu\.records ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;/);
  assert.ok(JSON.parse(manifest).schema.includes("2026-record-discoverable.sql"), "in the manifest schema group");
});

test("the platform-search RPC honours the choice inside SQL", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.match_platform_chunks/);
  assert.match(migration, /NOT \(r\.user_id = ANY \(COALESCE\(p_premium_user_ids, '\{\}'\)\)\) OR r\.discoverable = true/);
});

/* ── The rule's surfaces ───────────────────────────────────────────────── */

test("access.js: both cross-learner paths honour the opt-in, private still wins", () => {
  // Ask by recordId.
  assert.match(accessSrc, /\(!\(await activePremiumUserIds\(\)\)\.includes\(rec\.user_id\) \|\| rec\.discoverable === true\)/);
  // Shared file by contentKey.
  assert.match(accessSrc, /premiumIds\.includes\(rec\.user_id\) && rec\.discoverable !== true/);
  // Both selects must carry the flag or the rule reads air.
  assert.match(accessSrc, /file_key, kind, private, discoverable/);
  assert.match(accessSrc, /file_key, private, discoverable/);
});

test("PATCH /api/records/:id takes the choice from the owner only, booleans only", () => {
  const patch = serviceSrc.slice(serviceSrc.indexOf("export async function patchRecord"));
  assert.ok(
    patch.indexOf('existing.user_id !== userId) return res403') < patch.indexOf("req.body?.discoverable"),
    "the owner check runs before the discoverable write",
  );
  assert.match(patch, /typeof req\.body\.discoverable !== "boolean"\) return res400\(res, "discoverable must be true or false\."\);/);
  assert.match(patch, /patch\.discoverable = req\.body\.discoverable;/);
});

test("the record shape carries the choice back to the owner", () => {
  assert.match(serviceSrc, /discoverable: r\.discoverable === true,/);
});

test("the Discover feed count uses the same or-filter as the list", () => {
  const count = storeSrc.slice(storeSrc.indexOf("export const countDiscover"), storeSrc.indexOf("export const getDiscoverRecord"));
  assert.match(count, /countQuery = countQuery\.or\(`user_id\.not\.in\.\(\$\{premiumIds\.join\(","\)\}\),discoverable\.eq\.true`\)/);
});

test("platform search re-verification honours the opt-in", () => {
  assert.match(searchSrc, /!premium\.has\(r\.user_id\) \|\| r\.discoverable === true/);
});

test("study-material platform surfaces honour the opt-in", () => {
  assert.match(studyStoreSrc, /x = x\.or\(`user_id\.not\.in\.\(\$\{premium\.join\(","\)\}\),discoverable\.eq\.true`\)/);
  assert.match(studyStoreSrc, /premium\.includes\(src\.user_id\) && src\.discoverable !== true/);
  assert.match(studyStoreSrc, /premium\.includes\(row\.user_id\) && row\.discoverable !== true/);
});

/* ── Behaviour: access.js against an in-memory db ──────────────────────── */

const FREE = "11111111-1111-4111-8111-111111111111";
const PREMIUM = "22222222-2222-4222-8222-222222222222";
const ASKER = "99999999-9999-4999-8999-999999999999";
const ASK_ID = "33333333-3333-4333-8333-333333333333";
const state = { records: [] };

function chainFor(table) {
  const filters = [];
  const rows = () => (table === "records" ? state.records
    : table === "tiers" ? [{ id: "tier-premium", platform: "learner", access: "paid", name: "Premium" }]
    : table === "subscriptions" ? [{ learner_user_id: PREMIUM, tier_id: "tier-premium", status: "active" }]
    : [])
    .filter((row) => filters.every(([col, val]) => (Array.isArray(val) ? val.includes(row[col]) : row[col] === val)));
  const chain = {
    select: () => chain,
    eq: (col, val) => { filters.push([col, val]); return chain; },
    is: (col, val) => { filters.push([col, val]); return chain; },
    in: (col, vals) => { filters.push([col, vals]); return chain; },
    order: () => chain,
    limit: () => chain,
    then: (resolve) => resolve({ data: rows() }),
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
  };
  return chain;
}
const dbStub = { schema: () => ({ from: chainFor }), from: chainFor };
// Module mocking needs --experimental-test-module-mocks on this Node;
// without it the behavioural cases skip (the contract pins above still
// run under a bare `node --test`).
const canMock = typeof mock.module === "function";
let resolveAskTargetFor, resolveContentAccess;
if (canMock) {
  mock.module("../../db.js", {
    exports: { default: dbStub, readDb: dbStub, contentDb: dbStub.schema("edu"), checkDb: async () => true },
  });
  ({ resolveAskTargetFor, resolveContentAccess } = await import("./access.js"));
}
const btest = canMock ? test : test.skip;

const rec = (over) => ({
  id: ASK_ID, user_id: FREE, name: "Bio notes", kind: "paste",
  file_key: null, private: false, deleted_at: null, ...over,
});
const askById = (userId) => resolveAskTargetFor({ userId, recordId: ASK_ID });

btest("behaviour: a free owner's record is askable by another learner", async () => {
  state.records = [rec({})];
  const target = await askById(ASKER);
  assert.equal(target.recordId, ASK_ID);
});

btest("behaviour: a Premium owner's record is NOT askable", async () => {
  state.records = [rec({ user_id: PREMIUM })];
  const target = await askById(FREE);
  assert.equal(target.status, 404);
});

btest("behaviour: a Premium owner's record set public IS askable", async () => {
  state.records = [rec({ user_id: PREMIUM, discoverable: true })];
  const target = await askById(FREE);
  assert.equal(target.recordId, ASK_ID);
});

btest("behaviour: a private record is never askable, even set public", async () => {
  state.records = [rec({ user_id: PREMIUM, private: true, discoverable: true })];
  const target = await askById(FREE);
  assert.equal(target.status, 404);
});

btest("behaviour: the owner always reaches their own record", async () => {
  state.records = [rec({ user_id: PREMIUM })];
  const target = await askById(PREMIUM);
  assert.equal(target.recordId, ASK_ID);
});

const upload = (over) => rec({ kind: "upload", file_key: "records/premium/file.pdf", mime: "application/pdf", ...over });
const readByKey = (userId) => resolveContentAccess({ userId, contentKey: "records/premium/file.pdf" });

btest("behaviour: shared-file reads follow the same rule", async () => {
  state.records = [upload({ user_id: PREMIUM })];
  assert.equal((await readByKey(FREE)).status, 404, "Premium, not set public → hidden");
  state.records = [upload({ user_id: PREMIUM, discoverable: true })];
  assert.equal((await readByKey(FREE)).contentKey, "records/premium/file.pdf", "set public → readable");
  state.records = [upload({ user_id: FREE, private: true, discoverable: true })];
  assert.equal((await readByKey(PREMIUM)).status, 404, "private wins over the choice");
});
