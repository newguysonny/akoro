/*
 * tool-suggestions.contract.test.mjs — the repeated-computation sweep
 * (2026-11-14): 'answered' one-off traces are clustered per learner daily;
 * 3+ repeats in 14 days become a tool suggestion (kind "conversation", so a
 * tap opens a chat with the suggestion's prompt and the agent saves the
 * stashed computation there). Already-saved tools and anything suggested in
 * the last 30 days are skipped — a suggestion must never nag.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clusterAnswered, suggestionPrompt, suggestionRationale, REPEAT_THRESHOLD } from "./toolSuggestions.js";

const sweep = readFileSync(new URL("./toolSuggestions.js", import.meta.url), "utf8");
const queue = readFileSync(new URL("./resumeQueue.js", import.meta.url), "utf8");

const ev = (id, goal, name, day) => ({ id, goal, created_at: `2026-11-${day}T10:00:00Z`, detail: { name, label: "Weekly XP by subject" } });

test("clustering: rephrases of one computation cluster; different ones don't; threshold applies", () => {
  const events = [
    ev("1", "weekly xp by subject over the last 4 weeks", "weekly_xp", "14"),
    ev("2", "xp per subject broken down week by week", "weekly_xp", "11"),
    ev("3", "which subject earned most xp each week", "weekly_xp", "07"),
    ev("4", "count my library documents", "library_count", "13"),
    ev("5", "how many documents in my library", "library_count", "12"),
  ];
  const clusters = clusterAnswered(events);
  assert.equal(clusters.length, 1, "only the XP computation repeats 3 times");
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].seed.id, "1", "the seed is the newest event");
  assert.equal(REPEAT_THRESHOLD, 3);
});

test("clustering: the same tool name clusters even when the goal wording drifts", () => {
  const events = [
    ev("1", "weekly xp by subject", "weekly_xp", "14"),
    ev("2", "total xp earned recently per subject area", "weekly_xp", "10"),
    ev("3", "xp summary for the month", "weekly_xp", "05"),
  ];
  assert.equal(clusterAnswered(events).length, 1);
});

test("the suggestion: title is the prompt the tap sends; the rationale carries the count", () => {
  assert.equal(suggestionPrompt("Weekly XP by subject"), `Please save my "Weekly XP by subject" tool so I can reuse it.`);
  assert.match(suggestionRationale(4), /4 times in the last two weeks/);
});

test("the sweep reads only recent answered traces and writes conversation suggestions, proactively", () => {
  assert.match(sweep, /\.eq\("outcome", "answered"\)/);
  assert.match(sweep, /REPEAT_WINDOW_DAYS = 14/);
  assert.match(sweep, /kind: "conversation", title, rationale: suggestionRationale\(c\.count\), source: "proactive"/);
  assert.match(sweep, /agent:suggestion/);
});

test("the sweep never nags: saved tools and recently-suggested computations are skipped", () => {
  assert.match(sweep, /eq\("name", name\)\.in\("status", \["active", "disabled"\]\)/);
  assert.match(sweep, /SUGGESTION_COOLDOWN_DAYS = 30/);
  assert.match(sweep, /MAX_SUGGESTIONS_PER_SWEEP = 2/);
});

test("the sweep runs daily beside the archive tick", () => {
  assert.match(queue, /sweepRepeatedComputations/);
  assert.match(queue, /registerTick\("self-tool-suggestions", toolIdeas\)/);
  assert.match(queue, /cron\.schedule\("25 4 \* \* \*"/);
});
