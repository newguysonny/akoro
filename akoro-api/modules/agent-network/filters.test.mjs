import assert from "node:assert/strict";
import test from "node:test";
import { cleanFilters, presenceOf, canFind, canMessage, rankAgents, fairRange, battleTimeOf, ONLINE_WINDOW_MS } from "./filters.js";

test("filters: bounded, typed, unknown keys dropped", () => {
  const f = cleanFilters({ scope: "classmates", min_xp: "900", max_xp: 100, exam: "  JAMB ", sort: "nope", page: 999, hack: 1, available_only: "true" });
  assert.equal(f.scope, "classmates");
  assert.deepEqual([f.min_xp, f.max_xp], [100, 900]);     // swapped into order
  assert.equal(f.exam, "JAMB");
  assert.equal(f.sort, "relevance");
  assert.equal(f.page, 50);
  assert.equal(f.online_only, true, "available implies online");
  assert.equal("hack" in f, false);
  assert.equal(cleanFilters({ scope: "galaxy" }).scope, "everyone");
});

test("presence: online inside two missed heartbeats, then today / this week / away", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(presenceOf(new Date(now - ONLINE_WINDOW_MS + 1000).toISOString(), now), "online");
  assert.equal(presenceOf(new Date(now - 3 * 3600_000).toISOString(), now), "today");
  assert.equal(presenceOf(new Date(now - 3 * 86400_000).toISOString(), now), "this_week");
  assert.equal(presenceOf(null, now), "away");
});

test("privacy: everyone by default; school / classmates narrow it; hidden and blocks hide; learners only", () => {
  const me = { id: "me", school: "Kings College" };
  const t = (settings, extra = {}) => ({ id: "t", role: "student", school: "Queens College", settings, ...extra });
  assert.equal(canFind(me, t({})), true);
  assert.equal(canFind(me, t({ visibility: "hidden" })), false);
  assert.equal(canFind(me, t({ visibility: "school" })), false);
  assert.equal(canFind(me, t({ visibility: "school" }, { school: "kings college" })), true);
  assert.equal(canFind(me, t({ visibility: "classmates" })), false);
  assert.equal(canFind(me, t({ visibility: "classmates" }), { coursemate: true }), true);
  assert.equal(canFind(me, t({}), {}, new Set(["t"])), false);
  assert.equal(canFind(me, t({}, { role: "instructor" })), false);
  assert.equal(canFind(me, t({}, { deactivated: true })), false);
  assert.equal(canFind(me, { ...t({}), id: "me" }), false);
  assert.equal(canMessage(me, t({ accept_messages: "nobody" })), false);
  assert.equal(canMessage(me, t({ accept_messages: "classmates" }), { classmate: true }), true);
});

test("ranking: online first, then shared context and matches; fair match by XP", () => {
  const a = (id, presence, xp, shared = [], taught = []) => ({ userId: id, agentName: id, presence, xp, shared, matches: { taught, complements: [] } });
  const out = rankAgents([a("far", "online", 9000), a("off", "away", 1000, ["Classmate"]), a("mate", "online", 1100, ["Classmate"]), a("near", "online", 1050)], cleanFilters({}), { xp: 1000 });
  assert.deepEqual(out.map((x) => x.userId), ["mate", "near", "far", "off"]);
  assert.deepEqual(fairRange(1000), { min: 800, max: 1200 });
  assert.deepEqual(fairRange(100), { min: 0, max: 250 });
});

test("battle time bands (Lagos time)", () => {
  assert.equal(battleTimeOf("2026-10-07T18:00:00Z"), "evening");   // Wed 19:00 WAT
  assert.equal(battleTimeOf("2026-10-07T07:00:00Z"), "morning");
  assert.equal(battleTimeOf("2026-10-10T12:00:00Z"), "weekend");    // Saturday
});
