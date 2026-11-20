// node --test modules/self-study/activityReview.test.mjs — an activity's review battle: one class battle, sent as a challenge.
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readDraftSource } from "./draftSource.mjs";

const { cleanReview, reviewInstruction, reviewStatus, REVIEW_LIMITS } = await import("./activityReview.js");
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

test("the instruction line, and the wiring: assign keeps it and sends it now; one class battle at the review time", async () => {
  assert.match(reviewInstruction("2026-10-26T15:00:00Z"), /^After you submit, teach your agent this topic: your class review battle is on Mon,? 26 Oct, 4:00 pm\. Accept it in your Challenges before it starts\.$/);
  const drafts = await readDraftSource();
  assert.match(drafts, /review = cleanReview\(reviewIn, \{ dueAt: payload\.due_at \?\? null \}\)/);
  assert.match(drafts, /await scheduleActivityReview\(result\.assignment, review\)/);
  // Phase 19 step 4: the job logic moved out of battle/worker.js; the action
  // router is where "activity-review" is dispatched now.
  const workerJobs = readFileSync(new URL("../battle/worker-jobs.js", import.meta.url), "utf8");
  assert.match(workerJobs, /case "activity-review":.*runActivityReview\(job\.data\.assignmentId\)/);
  const src = readFileSync(new URL("./activityReview.js", import.meta.url), "utf8");
  assert.match(src, /delay: 0, jobId: `activity-review-\$\{assignment\.id\}`/);
  assert.match(src, /learnerIds, startsAt: at,/);
  const check = readFileSync(new URL("../battle/agentCheck.js", import.meta.url), "utf8");
  assert.match(check, /joined_at: group \? null : now\(\)/);
  assert.match(check, /expires_at: new Date\(startMs \?\? Date\.now\(\) \+ 3600_000\)/);
});

test("reviewStatus: sent until accepted, accepted until it starts; running; done; missed when declined or not accepted by the start", () => {
  assert.equal(reviewStatus(null, null), "waiting");
  assert.equal(reviewStatus({ status: "scheduled" }, null), "no_agent");
  assert.equal(reviewStatus({ status: "scheduled" }, { joined_at: null }), "sent");
  assert.equal(reviewStatus({ status: "scheduled" }, { joined_at: "x" }), "accepted");
  assert.equal(reviewStatus({ status: "scheduled" }, { declined_at: "x" }), "missed");
  assert.equal(reviewStatus({ status: "live" }, { joined_at: "x" }), "running");
  assert.equal(reviewStatus({ status: "live" }, null, { sent: true }), "missed");          // the start dropped the unanswered seat
  assert.equal(reviewStatus({ status: "completed" }, { joined_at: "x" }), "done");
  assert.equal(reviewStatus({ status: "completed" }, null, { sent: true }), "missed");
  assert.equal(reviewStatus({ status: "cancelled" }, { joined_at: null }), "missed");
});
