// Grand Plan §7.13 (D34, D36): peer agent help from breakthroughs — opt-in
// stories (non-sensitive, visible, one per learner, up to 3) and anonymous
// pattern totals only from 5 learners up. No learner ids ever come back.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { breakthroughsFrom, PATTERN_MIN_LEARNERS, MAX_STORIES } = await import("../../../lib/peerConsult.js");

const row = (learner, extra = {}) => ({
  learner_id: learner, struggle_type: "interference", concept_id: "c1", class_level: "JSS1",
  struggle_summary: "Mixed up evaporation and transpiration", attempts_before: 2,
  what_worked_strategy: "teach_back", what_worked: "Drew a leaf with its stomata and taught it back",
  score_before: 0.4, score_after: 1, resolved_at: "2026-10-01T00:00:00Z", sensitive: false, hidden: false, ...extra,
});
const agents = (ids, optedIn = true) => new Map(ids.map((id) => [id, { name: `${id}'s Agent`, emoji: "owl", optedIn }]));

test("stories come only from opted-in learners' visible, non-sensitive breakthroughs — one per learner, up to 3, no ids", () => {
  const rows = [row("A"), row("A", { score_after: 0.9 }), row("B", { score_before: 0.2 }), row("C"), row("D"), row("E", { hidden: true }), row("F", { what_worked: null }), row("asker")];
  const { stories } = breakthroughsFrom(rows, { askerId: "asker", agents: new Map([...agents(["A", "B", "C", "E", "F", "asker"])].concat([["D", { name: "D", optedIn: false }]])) });
  assert.equal(stories.length, MAX_STORIES);
  assert.equal(stories[0].agent, "B's Agent", "the biggest score jump first");
  assert.equal(new Set(stories.map((s) => s.agent)).size, stories.length, "one per learner");
  assert.ok(!stories.some((s) => /D|E's|F's|asker/.test(s.agent)));
  assert.ok(stories.every((s) => !("learner_id" in s) && !("learnerId" in s)));
  assert.deepEqual(Object.keys(stories[0]).sort(), ["agent", "attemptsBefore", "daysToOvercome", "emoji", "scoreAfter", "scoreBefore", "strategy", "struggle", "whatWorked"]);
});

test("the pattern is totals only and only from 5 learners up; every record counts, opted in or not", () => {
  const four = ["A", "B", "C", "D"].map((id) => row(id));
  assert.equal(breakthroughsFrom(four, { agents: agents(["A", "B", "C", "D"]) }).pattern, null);
  const five = [...four, row("E", { what_worked_strategy: "worked_example", hidden: true })];
  const { pattern } = breakthroughsFrom(five, { agents: new Map() });
  assert.equal(PATTERN_MIN_LEARNERS, 5);
  assert.deepEqual(pattern, { learners: 5, mostEffective: "teach_back", share: 0.8 });
});

test("a sensitive type never produces stories; expired records don't count", () => {
  const rows = ["A", "B", "C", "D", "E"].map((id) => row(id, { struggle_type: "test_anxiety", sensitive: true, struggle_summary: null, what_worked: null }));
  const out = breakthroughsFrom(rows, { agents: agents(["A", "B", "C", "D", "E"]), sensitiveType: true });
  assert.deepEqual(out.stories, []);
  assert.equal(out.pattern.learners, 5);
  const gone = breakthroughsFrom([row("A", { expires_at: "2020-01-01T00:00:00Z" })], { agents: agents(["A"]) });
  assert.deepEqual(gone.stories, []);
});

test("help others is ON by default: a learner who never chose helps; a recorded choice stands", async () => {
  const { helpsOthers } = await import("../../../lib/peerConsult.js");
  assert.equal(helpsOthers({}), true, "never chose → on");
  assert.equal(helpsOthers({ help_others_opt_in: false }), true, "the column default alone is not a choice");
  assert.equal(helpsOthers({ help_others_opt_in: false, help_others_chosen_at: "2026-11-07T10:00:00Z" }), false, "turned off → off");
  assert.equal(helpsOthers({ help_others_opt_in: true, help_others_chosen_at: "2026-11-07T10:00:00Z" }), true);
  assert.equal(helpsOthers({}, { young: true }), false, "a primary / JSS learner who never chose starts off");
  assert.equal(helpsOthers({ help_others_opt_in: true, help_others_chosen_at: "2026-11-07T10:00:00Z" }, { young: true }), true, "…and can turn it on");
});
