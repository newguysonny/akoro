// Watch-only mode for proactive work (Grand Plan Phase 18 item 1): off · observe · live per kind.
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allOff, defaultModeFor, EXISTING_KINDS, INSTRUCTOR_PROACTIVE_KINDS, LEARNER_PROACTIVE_KINDS, laterAccepted,
  MAX_OBSERVATIONS_PER_RUN, modeResolver, needsSchool, observationRows, observeOnly, resolveMode, splitByMode, validateModeChange,
} from "./kindModesCore.js";
import { instructorProposals } from "./instructorCore.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const S1 = "33333333-3333-4333-8333-333333333333";

test("every kind that exists today is live by default; a new kind is observe", () => {
  for (const k of ["task", "practice", "quiz_from_records", "teach_weak_topic", "revision_battle", "goal_nudge", "fix_it", "idea",
    "revise_low_scores", "chase_missing", "next_activity"]) assert.equal(defaultModeFor(k), "live", k);
  assert.equal(defaultModeFor("exam_countdown"), "observe");
  assert.equal(resolveMode("exam_countdown", null), "observe");
  // The migration seeds exactly the existing kinds as live.
  return read("../../migrations/2026-proactive-kind-modes.sql").then((sql) => {
    for (const k of EXISTING_KINDS) assert.match(sql, new RegExp(`\\('${k}', '(learner|instructor)', 'live'`), k);
    assert.match(sql, /ON CONFLICT \(kind\) DO NOTHING/, "an admin's later choice is kept");
  });
});

test("a scope: live for some learners or one school, observe for everyone else (and the reverse)", () => {
  const rows = [
    { kind: "goal_nudge", mode: "observe", scope_mode: "live", scope_user_ids: [U1], scope_school_ids: [S1] },
    { kind: "task", mode: "live", scope_mode: "observe", scope_user_ids: [U2], scope_school_ids: [] },
    { kind: "practice", mode: "off" },
  ];
  assert.equal(modeResolver(rows, { userId: U1 })("goal_nudge"), "live");
  assert.equal(modeResolver(rows, { userId: U2, schoolId: S1 })("goal_nudge"), "live", "the school's learners");
  assert.equal(modeResolver(rows, { userId: U2 })("goal_nudge"), "observe");
  assert.equal(modeResolver(rows, { userId: U2 })("task"), "observe", "one tester watched while live for everyone");
  assert.equal(modeResolver(rows, { userId: U1 })("task"), "live");
  assert.equal(modeResolver(rows, { userId: U1 })("practice"), "off");
  assert.equal(modeResolver(rows, { userId: U1 })("quiz_from_records"), "live", "no row: the default");
  assert.equal(needsSchool(rows), true);
  assert.equal(needsSchool(rows.slice(1)), false, "the school is read only when a scope names one");
});

test("split, observe-only and all-off", () => {
  const modeOf = modeResolver([{ kind: "task", mode: "observe" }, { kind: "practice", mode: "off" }]);
  const s = splitByMode([{ kind: "task", t: 1 }, { kind: "practice" }, { kind: "goal" }, { kind: "task", t: 2 }], modeOf);
  assert.deepEqual([s.live.length, s.observe.map((x) => x.t), s.off.length], [1, [1, 2], 1]);
  const watch = modeResolver(LEARNER_PROACTIVE_KINDS.map((kind) => ({ kind, mode: "observe" })));
  assert.equal(observeOnly(watch), true);
  assert.equal(observeOnly(modeOf), false);
  assert.equal(allOff(modeResolver(LEARNER_PROACTIVE_KINDS.map((kind) => ({ kind, mode: "off" })))), true);
  assert.equal(allOff(modeOf), false);
});

test("an admin's change is checked", () => {
  assert.equal(validateModeChange("task", { mode: "observe" }).ok, true);
  assert.equal(validateModeChange("task", { mode: "maybe" }).ok, false);
  assert.equal(validateModeChange("Task; drop", { mode: "live" }).ok, false);
  const scoped = validateModeChange("goal_nudge", { mode: "observe", scope: { mode: "live", schoolIds: [S1] }, note: "pilot school" });
  assert.deepEqual(scoped.change, { mode: "observe", scope_mode: "live", scope_user_ids: [], scope_school_ids: [S1], note: "pilot school" });
  assert.equal(validateModeChange("goal_nudge", { mode: "observe", scope: { mode: "live" } }).ok, false, "a scope names someone");
  assert.equal(validateModeChange("goal_nudge", { mode: "observe", scope: { mode: "live", schoolIds: [S1, U1] } }).ok, false, "one school");
  assert.equal(validateModeChange("goal_nudge", { mode: "observe", scope: { mode: "live", userIds: ["nope"] } }).ok, false);
  assert.equal(validateModeChange("goal_nudge", { mode: "live", scope: { mode: "live", userIds: [U1] } }).ok, false);
  assert.deepEqual(validateModeChange("task", { mode: "live", scope: null }).change.scope_user_ids, []);
});

test("observe records: kind, learner, preview, reason, cycle id — capped per run", () => {
  const rows = observationRows([{ kind: "teach_weak_topic", title: "Teach your agent osmosis", rationale: "Mastery 30% on osmosis", preview: { kind: "teach" }, payload: { topic: "Osmosis" } }],
    { userId: U1, runId: "run-1" });
  assert.deepEqual(rows[0], { kind: "teach_weak_topic", audience: "learner", user_id: U1, run_id: "run-1", title: "Teach your agent osmosis",
    reason: "Mastery 30% on osmosis", preview: { kind: "teach" }, payload: { topic: "Osmosis" } });
  const idea = observationRows([{ kind: "idea", title: "Quiz", why: "Added Monday", brief: "Make me a quiz", context: { kind: "record" } }], { userId: U1 })[0];
  assert.deepEqual([idea.reason, idea.preview, idea.payload], ["Added Monday", { brief: "Make me a quiz" }, { context: { kind: "record" } }]);
  assert.equal(observationRows(Array.from({ length: 30 }, () => ({ kind: "task", title: "x" })), { userId: U1 }).length, MAX_OBSERVATIONS_PER_RUN);
});

test("real outcomes beside them: a similar live proposal later accepted", () => {
  const obs = [{ user_id: U1, kind: "teach_weak_topic", title: "Teach osmosis", payload: { topic: "Osmosis" }, created_at: "2026-11-01T10:00:00Z" },
    { user_id: U2, kind: "teach_weak_topic", title: "Teach osmosis", payload: { topic: "Osmosis" }, created_at: "2026-11-01T10:00:00Z" }];
  const props = [
    { user_id: U1, kind: "teach_weak_topic", title: "Teach your agent osmosis", payload: { topic: "osmosis" }, status: "executed", created_at: "2026-11-02T10:00:00Z" },
    { user_id: U2, kind: "teach_weak_topic", title: "Teach osmosis", payload: {}, status: "dismissed", created_at: "2026-11-02T10:00:00Z" },
    { user_id: U2, kind: "teach_weak_topic", title: "Teach osmosis", payload: {}, status: "executed", created_at: "2026-10-01T10:00:00Z" },
  ];
  const out = laterAccepted(obs, props);
  assert.deepEqual(out.map((o) => [o.similarLater, o.acceptedLater]), [[1, true], [1, false]], "only later ones count");
});

test("instructor kinds: the per-run cap can be lifted so observe kinds don't take live places", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const acts = [1, 2, 3, 4].map((i) => ({ id: `a${i}`, title: `Act ${i}`, created_at: "2026-10-28T10:00:00Z", due_at: "2026-11-03T08:00:00Z",
    targets: [{ student_id: "s1", status: "assigned" }, { student_id: "s2", status: "assigned" }] }));
  assert.equal(instructorProposals(acts, { now }).length, 3, "unchanged default: 3");
  assert.equal(instructorProposals(acts, { now, limit: 30 }).length, 4);
  assert.deepEqual(INSTRUCTOR_PROACTIVE_KINDS, ["revise_low_scores", "chase_missing", "next_activity"]);
});

test("wiring: the cycle records observe kinds, never shows or charges them; delivery holds a kind taken out of live", async () => {
  const [cycle, deliver, instr, admin, adminIndex, manifest] = await Promise.all([
    read("./cycle.js"), read("./deliver.js"), read("./instructorCycle.js"), read("../admin/proactiveKinds.js"), read("../admin/index.js"), read("../../migrations/manifest.json"),
  ]);
  assert.match(cycle, /const modeOf = await modesFor\(userId\)\.catch\(\(\) => null\) \|\| defaultModeFor;/, "unreadable modes → the defaults (existing kinds live)");
  assert.match(cycle, /if \(!watchOnlyLearner\) reportAgentActivity\(userId, "Reviewing your goals…"\);/, "a watch-only learner sees nothing");
  assert.match(cycle, /\.\.\.\(watchOnly \? \{ __feature: OBSERVE_FEATURE \} : \{\}\)/, "not the learner's budget");
  assert.match(cycle, /if \(mode === "live" && shaped\.length >= MAX_PROPOSALS_PER_CYCLE\) continue;/, "observe never takes a live place");
  assert.match(cycle, /const shaped = byMode\.live;/);
  assert.match(cycle, /await recordObservations\(watched, \{ userId, runId \}\)/);
  assert.match(cycle, /if \(line && !watchOnly\)/);
  assert.match(cycle, /\.eq\("observe_only", false\)/, "watch-only runs don't count against run caps");
  assert.match(deliver, /const p = \(waiting \|\| \[\]\)\.find\(\(x\) => !modeOf \|\| modeOf\(x\.kind\) === "live"\);/);
  assert.match(instr, /recordObservations\(watched, \{ userId: instructorId, runId: run\?\.id \?\? null, audience: "instructor" \}\)/);
  assert.match(admin, /router\.patch\("\/proactive-kinds\/:kind", adminOnly/);
  assert.match(admin, /const adminOnly = \[authenticateToken, requireRole\(\["admin"\]\)\];/);
  assert.match(adminIndex, /router\.use\("\/", proactiveKindsRouter\);/);
  assert.ok(JSON.parse(manifest).schema.includes("2026-proactive-kind-modes.sql"));
});
