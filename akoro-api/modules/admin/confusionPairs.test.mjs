import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { mergePairs, REVIEW_STATUSES } = await import("./confusionPairsCore.js");

const pairs = [
  { subject: "Biology", concept: "Transpiration", confused_with: "Evaporation", times: 14, learners: 9, last_seen: "2026-11-06" },
  { subject: "Biology", concept: "Osmosis", confused_with: "Diffusion", times: 7, learners: 6, last_seen: "2026-11-05" },
];

test("pairs merge with their review: open until reviewed, most learners first, anonymous counts only", () => {
  const out = mergePairs(pairs, [{ subject: "Biology", concept: "Osmosis", confused_with: "Diffusion", status: "content_fixed", note: "Reworded Q3", reviewed_at: "2026-11-07" }]);
  assert.deepEqual(out.map((p) => [p.concept, p.status]), [["Transpiration", "open"], ["Osmosis", "content_fixed"]]);
  assert.equal(out[1].note, "Reworded Q3");
  assert.ok(out.every((p) => !("learner_id" in p) && !("learnerIds" in p)));
});

test("filters by review status and subject", () => {
  const reviews = [{ subject: "Biology", concept: "Osmosis", confused_with: "Diffusion", status: "ignored" }];
  assert.deepEqual(mergePairs(pairs, reviews, { status: "open" }).map((p) => p.concept), ["Transpiration"]);
  assert.equal(mergePairs(pairs, reviews, { subject: "chemistry" }).length, 0);
  assert.deepEqual(REVIEW_STATUSES, ["open", "content_fixed", "noted", "ignored"]);
});
