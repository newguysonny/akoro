// node --test modules/self-study/activityReview.test.mjs — an activity's review battle: when it runs, who it reviews.
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { cleanReview, reviewRuns, reviewInstruction, dueForReview, REVIEW_LIMITS } = await import("./activityReview.js");
const NOW = Date.parse("2026-10-24T10:00:00Z");

test("cleanReview: off, at the instructor's time, else the due date; questions clamped; a past or missing time refuses", () => {
  assert.equal(cleanReview({ on: false }, { now: NOW }), null);
  assert.equal(cleanReview(null, { now: NOW }), null);
  assert.deepEqual(cleanReview({ on: true, at: "2026-10-26T15:00:00Z", questions: 20 }, { now: NOW }), { on: true, at: "2026-10-26T15:00:00.000Z", questions: REVIEW_LIMITS.MAX_Q });
  assert.equal(cleanReview({ on: true }, { dueAt: "2026-10-28T16:00:00Z", now: NOW }).at, "2026-10-28T16:00:00.000Z");
  assert.equal(cleanReview({ on: true, questions: 2, at: "2026-10-26T15:00:00Z" }, { now: NOW }).questions, REVIEW_LIMITS.MIN_Q);
  assert.throws(() => cleanReview({ on: true }, { now: NOW }), /Set when the review battle runs/);
  assert.throws(() => cleanReview({ on: true, at: "2026-10-01T10:00:00Z" }, { now: NOW }), /has passed/);
});

test("reviewRuns: submitters at the review time, everyone left at the due date; one run when the due date isn't later", () => {
  assert.deepEqual(reviewRuns({ at: "2026-10-26T15:00:00Z", dueAt: "2026-10-28T16:00:00Z" }).map((r) => r.who), ["submitted", "all"]);
  assert.deepEqual(reviewRuns({ at: "2026-10-26T15:00:00Z", dueAt: "2026-10-25T16:00:00Z" }).map((r) => r.who), ["all"]);
  assert.deepEqual(reviewRuns({ at: "2026-10-26T15:00:00Z" }).map((r) => r.who), ["all"]);
});

test("dueForReview: once per learner; 'submitted' only those who handed in", () => {
  const targets = [
    { student_id: "a", status: "complete" }, { student_id: "b", status: "started" },
    { student_id: "c", status: "assigned", submission: { submittedAt: "x" } }, { student_id: "d", status: "complete", review_battle_id: "r1" },
  ];
  assert.deepEqual(dueForReview(targets, "submitted"), ["a", "c"]);
  assert.deepEqual(dueForReview(targets, "all"), ["a", "b", "c"]);
});

test("the instruction line, and the wiring: assign keeps it, the worker runs it", () => {
  assert.match(reviewInstruction("2026-10-26T15:00:00Z"), /^After you submit, teach your agent this topic: your review battle is on Mon,? 26 Oct, 4:00 pm\.$/);
  const drafts = readFileSync(new URL("./drafts.js", import.meta.url), "utf8");
  assert.match(drafts, /review = cleanReview\(reviewIn, \{ dueAt: payload\.due_at \?\? null \}\)/);
  assert.match(drafts, /await scheduleActivityReview\(result\.assignment, review\)/);
  const worker = readFileSync(new URL("../battle/worker.js", import.meta.url), "utf8");
  assert.match(worker, /case "activity-review":/);
});
