// Phase 13 steps 4–8 (Grand Plan §7.16.8): the pure rules — quiet hours in the
// learner's zone, the weekly budget, ready kinds held to real things, goal
// work, ideas, and the instructor engine over their own activities.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { afterQuiet, inQuiet, quietOf, validTimeZone } from "./quietHours.js";
import { budgetFrom, weekStartFor, weeklyBudgetUsd } from "../../lib/budgetCore.js";
import { fixIts, progressLine, READY, shapeIdeas, shapeReady, spreadDue } from "./readyKinds.js";
import { instructorProposals, nextTopicAfter } from "./instructorCore.js";

test("quiet hours: their own window, in their own zone (Lagos 20:00–07:30 by default)", () => {
  const lagos = quietOf({});
  assert.deepEqual(lagos, { timeZone: "Africa/Lagos", start: "20:00", end: "07:30" });
  assert.equal(inQuiet(new Date("2026-10-19T19:30:00Z"), lagos), true, "20:30 Lagos");
  assert.equal(afterQuiet(new Date("2026-10-19T19:30:00Z"), lagos), "2026-10-20T06:30:00.000Z", "07:30 Lagos the next morning");
  assert.equal(inQuiet(new Date("2026-10-19T10:00:00Z"), lagos), false);
  const ny = quietOf({ time_zone: "America/New_York", quiet_start: "21:00", quiet_end: "07:00" });
  assert.equal(inQuiet(new Date("2026-10-19T02:00:00Z"), ny), true, "22:00 in New York");
  assert.equal(afterQuiet(new Date("2026-10-19T02:00:00Z"), ny), "2026-10-19T11:00:00.000Z");
  assert.equal(inQuiet(new Date("2026-10-19T13:30:00Z"), { timeZone: "Africa/Lagos", start: "13:00", end: "15:00" }), true, "a daytime window");
  assert.equal(quietOf({ time_zone: "Mars/Olympus", quiet_start: "25:00" }).timeZone, "Africa/Lagos", "a bad zone falls back");
  assert.equal(validTimeZone("Europe/London"), true);
});

test("budget: Monday in their zone; 80% warns, 100% stops", () => {
  const start = weekStartFor(new Date("2026-10-21T10:00:00Z"), "Africa/Lagos");
  assert.equal(start.toISOString(), "2026-10-18T23:00:00.000Z");
  assert.deepEqual(budgetFrom(0.085, 0.1, start), { spentUsd: 0.085, budgetUsd: 0.1, usedPct: 85, resetsAt: "2026-10-25T23:00:00.000Z", stop: false, warn: true });
  assert.equal(budgetFrom(0.1, 0.1, start).stop, true);
  assert.equal(weeklyBudgetUsd({}), 0.1);
  assert.equal(weeklyBudgetUsd({ AKORO_AUTONOMY_WEEKLY_BUDGET_USD: "0.5" }), 0.5);
});

const refs = {
  records: [{ id: "r1", name: "Cell transport notes", pages: 14, topics: ["Osmosis", "Diffusion"] }],
  goals: [{ id: "g1", title: "A in WAEC Biology", days_left: 47, days_since_update: 2 }, { id: "g2", title: "A in BECE English", days_left: 40, days_since_update: 9 }, { id: "g3", title: "Someday", days_left: null, days_since_update: 1 }],
  weak: [{ concept: "Osmosis", subject: "Biology", mastery: 30 }],
  notes: [{ kind: "open_thread", note: "wanted to revise titration curves", chatId: "c1" }, { kind: "study_preference", note: "likes diagrams" }],
};

test("ready kinds are held to what is really theirs; the preview comes from facts", () => {
  const quiz = shapeReady({ kind: "quiz_from_records", payload: { record: 1, topic: "Osmosis" } }, refs);
  assert.deepEqual(quiz.payload, { recordId: "r1", recordName: "Cell transport notes", tool: "quiz" });
  assert.deepEqual(quiz.preview, { kind: "quiz", record: "Cell transport notes", pages: 14, topics: ["Osmosis", "Diffusion"], focus: "Osmosis" });
  assert.equal(shapeReady({ kind: "quiz_from_records", payload: { record: 4 } }, refs), null, "a record they don't have");
  assert.equal(shapeReady({ kind: "teach_weak_topic", payload: { topic: "osmosis" } }, refs).payload.topic, "Osmosis");
  assert.equal(shapeReady({ kind: "teach_weak_topic", payload: { topic: "Photosynthesis" } }, refs), null, "not weak for them");
  assert.equal(shapeReady({ kind: "revision_battle", payload: { topic: "Osmosis" } }, refs).preview.questions, 5);
  assert.equal(shapeReady({ kind: "study_plan", payload: { goal: 1 } }, refs).payload.goalId, "g1", "47 days out: a countdown");
  assert.equal(shapeReady({ kind: "study_plan", payload: { goal: 3 } }, refs), null, "no date");
  const fu = shapeReady({ kind: "follow_up_question", from_note: 1, payload: { message: "Want 3 questions on titration curves?" } }, refs);
  assert.equal(fu.sourceChatId, "c1");
  assert.equal(shapeReady({ kind: "follow_up_question", from_note: 2, payload: { message: "Want some diagrams?" } }, refs), null, "only from something left open");
  assert.equal(shapeReady({ kind: "goal_nudge", payload: { goal: 2, title: "20 minutes on concord" } }, refs).payload.goalId, "g2", "9 days untouched");
  assert.equal(shapeReady({ kind: "goal_nudge", payload: { goal: 3, title: "x step" } }, refs), null, "touched yesterday, no date");
  for (const k of ["quiz_from_records", "revision_battle"]) assert.equal(READY[k].cost, "free");
});

test("goal work and fix-its: numbers only, never guessed", () => {
  assert.equal(progressLine({ tasksDone: 4, sessions: 2, bestBattle: { score: 8, total: 10 } }), "This week: 4 tasks done · 2 study sessions · best battle 8/10.");
  assert.equal(progressLine({}), null);
  assert.equal(fixIts({ tasks: { overdueList: [{ id: "t1", title: "a" }] } }).length, 0, "one overdue task isn't a pattern");
  const f = fixIts({ tasks: { overdueList: [{ id: "t1", title: "revise titration" }, { id: "t2", title: "past paper" }, { id: "t3", title: "x" }] } })[0];
  assert.deepEqual(f.payload, { fix: "overdue_tasks", taskIds: ["t1", "t2", "t3"] });
  const moved = spreadDue([{ id: "a", due_at: "2026-10-10T15:00:00Z" }, { id: "b" }, { id: "c" }], new Date("2026-10-19T08:00:00Z"));
  assert.deepEqual(moved.map((m) => m.due_at.slice(0, 10)), ["2026-10-20", "2026-10-20", "2026-10-21"], "two a day from tomorrow");
});

test("ideas: each tied to a real thing, never a repeat, within the room", () => {
  const raw = [
    { title: "Turn your Biology notes into a quiz", why: "Added Monday, not tested yet.", from: "record", ref: 1, brief: "Make me a quiz from my Cell transport notes", icon: "quiz" },
    { title: "Teach your agent osmosis", why: "Weakest topic at 30%.", from: "weak", ref: 1, brief: "I want to teach you osmosis", icon: "teach" },
    { title: "Something vague", why: "Because reasons here.", from: "record", ref: 9, brief: "Do a thing please", icon: "chat" },
    { title: "Teach your agent osmosis", why: "Again the same idea.", from: "weak", ref: 1, brief: "I want to teach you osmosis", icon: "teach" },
  ];
  const out = shapeIdeas(raw, refs, { room: 3 });
  assert.deepEqual(out.map((i) => i.context.label), ["Cell transport notes", "Osmosis"]);
  assert.equal(shapeIdeas(raw, refs, { room: 1 }).length, 1);
});

test("instructor engine: facts about their own activities only", () => {
  const now = new Date("2026-10-19T09:00:00Z");
  const acts = [
    { id: "a1", title: "Linear equations", subject: "Mathematics", topic: "Linear equations", classroom_id: "c1", due_at: "2026-10-20T09:00:00Z", created_at: "2026-10-15T09:00:00Z",
      targets: [{ student_id: "s1", status: "assigned" }, { student_id: "s2", status: "assigned" }, { student_id: "s3", status: "complete", grade: 40 }] },
    { id: "a2", title: "Fractions", subject: "Mathematics", topic: "Fractions", classroom_id: "c2", due_at: null, created_at: "2026-10-12T09:00:00Z",
      targets: [{ student_id: "s4", status: "complete", grade: 40 }, { student_id: "s5", status: "complete", grade: 50 }, { student_id: "s6", status: "complete", grade: 45 }] },
  ];
  const out = instructorProposals(acts, { now });
  assert.equal(out[0].kind, "chase_missing", "due tomorrow, most urgent");
  assert.deepEqual(out[0].payload.studentIds, ["s1", "s2"]);
  assert.match(out[0].rationale, /^2 of 3 haven't started "Linear equations" — it's due /);
  assert.ok(out.some((p) => p.kind === "revise_low_scores" && p.payload.assignmentId === "a2" && /45%/.test(p.rationale)));
  assert.ok(out.some((p) => p.kind === "next_activity" && p.payload.assignmentId === "a2"), "all done, nothing newer for that class");
  assert.ok(out.length <= 3);
  assert.equal(nextTopicAfter("Fractions", [{ topics: [{ title: "Fractions" }, { title: "Decimals" }] }]), "Decimals");
  assert.equal(nextTopicAfter("Unknown", []), "Practice: Unknown");
});

test("wired: consents gate the planner and delivery; approval reports in the thread; ideas and settings mounted", async () => {
  const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
  const [cycle, deliver, inbox, app, routes] = await Promise.all([read("./cycle.js"), read("./deliver.js"), read("../agent-proposals/inbox.js"), read("../../app.js"), read("./learnerRoutes.js")]);
  assert.match(cycle, /if \(!auto\?\.enabled \|\| auto\.proactive === false\) return \{ skipped: "not_enabled" \}/);
  assert.match(cycle, /if \(budget\?\.stop\) return \{ skipped: "budget_usd", budget \}/);
  assert.match(cycle, /payload\.scheduledAt = quiet \? afterQuiet\(at, quiet\) : outsideQuietHours\(at\)/);
  assert.match(deliver, /meta = \{ proposal: proposalMeta\(p\) \}/);
  assert.match(inbox, /const report = await reportInChat\(userId, claimed,/);
  assert.match(app, /app\.use\("\/api\/agent", standardLimit, agentLearnerModule\)/);
  assert.match(routes, /router\.get\("\/settings", authenticateToken,/, "auth per route (mounted beside other /api/agent modules)");
});
