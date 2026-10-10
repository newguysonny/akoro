// Who pays for what in a battle: the creator for the questions, each learner
// for their own agent's answers, the app for Sergeant's judging.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
const [judge, source, recall, worker, ai] = await Promise.all([
  read("./judge.js"), read("./questionSource.js"), read("./agentRecall.js"), read("./worker.js"), read("../../lib/aiModel.js"),
]);

test("__payer: 'platform' bills nobody, whoever's request the call runs in", () => {
  assert.equal((ai.match(/const platform = params\.__payer === "platform";/g) || []).length, 3);   // chat, responses, embeddings
  assert.equal((ai.match(/const userId  = platform \? null :/g) || []).length, 3);
  assert.equal((ai.match(/delete clean\.__payer;/g) || []).length, 3);
});

test("questions: the creator pays once (checked up front), a platform battle is free to everyone", () => {
  assert.match(source, /__payer: "platform",/);                       // the metered client must not charge the request's user too
  assert.match(source, /if \(userId && feature !== "eval"\) \{[\s\S]*?coinsAvailable/);
  assert.match(source, /if \(feature !== "eval" && userId\) \{[\s\S]*?chargeForAI\(\{\s*userId/);
});

test("answers: each learner pays for their own agent; the shared question vector is the app's", () => {
  assert.match(recall, /__feature: "battle_answer",\s*__userId: userId,/);
  assert.match(recall, /__feature: "battle_recall",[\s\S]{0,200}__payer: "platform",/);
  assert.match(worker, /coinsAvailable\(\{ userId: p\.user_id, billTo, min: 1 \}\)/);
  assert.match(worker, /e instanceof InsufficientCoins\) broke = true/);
});

test("Sergeant judges for free: every judge call is the platform's, and a review has no judge", () => {
  assert.equal((judge.match(/\.\.\.PLATFORM, __feature: "battle_judge"/g) || []).length, 2);
  assert.match(judge, /const PLATFORM = \{ __payer: "platform" \};/);
  assert.match(worker, /const judged = isReviewBattle \? null : await ruling\(q\)/);
  assert.match(worker, /if \(!isReview\) \{\s*const v = await verdict\(/);
  // Marking stays the stored key — the judge explains, it doesn't decide.
  assert.doesNotMatch(judge, /is_correct:/);
});

test("a battle plays every question: no early end when one agent is left with HP", () => {
  assert.doesNotMatch(worker, /lastStanding|aliveCount/);
  assert.match(worker, /if \(questionOrder >= \(battleInfo\?\.total_questions \?\? 0\)\) \{\s*await battleQueue\.add\("end-battle"/);
});
