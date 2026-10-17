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
  assert.match(recall, /__feature: payer === "platform" \? "agent_check_answer" : "battle_answer",\s*__userId: userId,/);
  assert.match(recall, /__feature: "battle_recall",[\s\S]{0,200}__payer: "platform",/);
  assert.match(worker, /coinsAvailable\(\{ userId: p\.user_id, billTo, min: 1 \}\)/);
  assert.match(worker, /e instanceof InsufficientCoins\) broke = true/);
});

test("an Agent Check (D45) was charged once by Study Prep: its answers are the platform's, nothing else is", () => {
  assert.match(worker, /const prepaid = battle\.battle_type === "check";/);
  assert.match(worker, /const wallet = prepaid \? \{ ok: true \} : await coinsAvailable/);
  assert.match(worker, /\.\.\.\(prepaid \? \{ payer: "platform" \} : \{\}\)/);
  assert.match(recall, /\.\.\.\(payer === "platform" \? \{ __payer: "platform" \} : \{\}\)/);
});

test("Sergeant judges for free: every judge call is the platform's, and a review has no judge", () => {
  assert.equal((judge.match(/\.\.\.PLATFORM, __feature: "battle_judge"/g) || []).length, 2);
  assert.match(judge, /const PLATFORM = \{ __payer: "platform" \};/);
  // Sergeant rules in every contest and in every Agent Check; never in a review.
  assert.match(worker, /const judgeRules = btype\?\.battle_type !== "review";/);
  assert.match(worker, /const judged = judgeRules \? await ruling\(q\)\.catch\(\(\) => null\) : null;/);
  assert.match(worker, /if \(!isReview\) \{\s*const v = await verdict\(/);
  // Marking stays the stored key — the judge explains, it doesn't decide.
  assert.doesNotMatch(judge, /is_correct:/);
});

test("to answer an agent needs HP, token credit and knowledge — otherwise no answer, never a guess", async () => {
  const player = await read("./agentPlayer.js");
  assert.doesNotMatch(worker, /guess\(options\.length\)/);
  assert.match(worker, /if \(\(p\.hp \?\? 100\) <= 0\) return;/);                         // spectator
  assert.match(worker, /if \(broke \|\| picked == null\) \{[\s\S]*?"no_answer"/);
  assert.match(player, /battle\.battle_type === "review" \|\| \(p\.hp \?\? 100\) > 0/);      // no HP, not scheduled to answer
});

test("no HP, no ranking; the battle runs every question while anyone can still answer", () => {
  assert.match(worker, /const ranked = participants\.filter\(alive\);/);
  assert.match(worker, /computeXpDistribution\(ranked, pool \?\? 0\)/);
  assert.match(worker, /final_rank: r == null \? null :/);
  assert.match(worker, /if \(questionOrder >= \(battleInfo\?\.total_questions \?\? 0\) \|\| stillIn === 0\) \{/);
  assert.doesNotMatch(worker, /lastStanding/);
});

test("the creator sets HP per miss; every miss costs exactly that, and invitees see it first", async () => {
  const { cleanHpPerMiss, missesToKnockout } = await import("./hp.js");
  assert.equal(cleanHpPerMiss(undefined), 10);
  assert.equal(cleanHpPerMiss(""), 10);
  assert.equal(cleanHpPerMiss(0), 0);            // no knockouts
  assert.equal(cleanHpPerMiss(80), 50);
  assert.equal(cleanHpPerMiss("abc"), 10);
  assert.equal(missesToKnockout(10), 10);
  assert.equal(missesToKnockout(15), 7);
  assert.equal(missesToKnockout(0), null);
  assert.match(worker, /hp: Math\.max\(0, \(p\.hp \?\? 100\) - hpPerMiss\)/);
  assert.doesNotMatch(worker, /- 8\)/);
  const routes = await read("./routes.js");
  assert.equal((routes.match(/hp_per_miss: cleanHpPerMiss\(req\.body\?\.hp_per_miss\),/g) || []).length, 6);   // every creation path
  assert.match(await read("./card.js"), /hpPerMiss:     b\.hp_per_miss \?\? HP_PER_MISS_DEFAULT,/);       // on every card / challenge
});

test("entry: enough coins for your agent's answers and the creator's minimum XP — reviews never gated on XP, and pay a free coin", async () => {
  const entry = await read("./entry.js");
  const { requirementsOf, coinsNeeded, coinsPerAnswer } = await import("./entry.js");
  assert.equal(coinsNeeded(10), 10 * coinsPerAnswer());
  assert.ok(coinsPerAnswer() >= 2);
  assert.equal(requirementsOf({ battle_type: "review", total_questions: 5, min_xp: 500 }).minXp, 0);
  assert.equal(requirementsOf({ battle_type: "classroom", total_questions: 5, min_xp: 500 }).minXp, 500);
  assert.match(entry, /throw Object\.assign\(new Error\(r\.message\), \{ status: 402, code: "ENTRY_REQUIREMENTS"/);
  const routes = await read("./routes.js");
  assert.equal((routes.match(/code: "ENTRY_REQUIREMENTS"/g) || []).length, 6);   // accept, join, 4 creator checks
  assert.match(routes, /router\.get\("\/battles\/:battleId\/entry"/);
  assert.match(worker, /if \(isReview && REVIEW_REWARD_COINS > 0\) \{[\s\S]*?grantCoins\(\{ userId: p\.user_id, coins: REVIEW_REWARD_COINS, feature: "review_participation"/);
});

test("start and end are claimed once; a question is revealed once and late answers don't count", async () => {
  assert.match(worker, /\.eq\("id", battleId\)\.in\("status", \["lobby", "scheduled"\]\)\.select\("id"\);\s*if \(!claimed\?\.length\) return;/);
  assert.match(worker, /\.eq\("id", battleId\)\.eq\("status", "live"\)\.select\("id"\);\s*if \(!ended\?\.length\) return;/);
  assert.match(worker, /update\(\{ revealed_at: now\(\) \}\)[\s\S]*?\.is\("revealed_at", null\)/);
  assert.match(worker, /if \(still\?\.revealed_at\) return;/);
  assert.match(worker, /wrong_answers: \(p\.wrong_answers \?\? 0\) \+ 1, current_streak: 0/);     // a miss breaks the streak
  const routes = await read("./routes.js");
  assert.doesNotMatch(routes, /update\(\{ status: isScheduled \? "scheduled" : "live" \}\)/);     // accepting never marks it live
  assert.doesNotMatch(await read("./networkBattle.js"), /update\(\{ status: "live" \}\)/);
});

test("reviews pay once at the end; knocked-out members stop counting for their team", () => {
  assert.match(worker, /const xpGained    = isReviewBattle \? 0 :/);
  assert.match(worker, /if \(\(p\.hp \?\? 100\) > 0\) teamTotals\[p\.team \|\| "A"\] \+= \(p\.score \|\| 0\);/);
});
