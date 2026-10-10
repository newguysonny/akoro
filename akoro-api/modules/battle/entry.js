/**
 * battle/entry.js — what a learner needs to take a seat in a battle.
 *
 *   coins   enough token credit to pay for their own agent's answers in this
 *           battle (about questions × the cost of one answer). Their agent
 *           can't answer without it, so it isn't let in short.
 *   XP      the battle's min_xp, set by its creator (0 = open to all).
 *
 * A REVIEW set by a teacher is a check of knowledge, not a contest: no XP
 * gate, and each learner gets a free coin at the end for taking part
 * (worker endBattle). It still needs the coins for the answers.
 *
 * Checked when accepting a challenge, joining an open battle, accepting a
 * challenge request, taking a daily-battle seat, and when a learner creates
 * a battle they play in. The challenge sheet shows it before Accept.
 */
import db from "../../db.js";
import { coinsAvailable, schoolBillTo } from "../../lib/coins.js";
import { coinsForUsage } from "../../lib/aiPricing.js";

const ANSWER_MODEL = process.env.BATTLE_ANSWER_MODEL || "gpt-4o-mini";
// One answer: the notes search (≈1 coin) and the answer from them (a ~1.5k-token prompt).
export const coinsPerAnswer = () => coinsForUsage(ANSWER_MODEL, 1500, 60) + 1;
export const coinsNeeded = (totalQuestions) => Math.max(1, Math.round(Number(totalQuestions) || 10)) * coinsPerAnswer();
export const REVIEW_REWARD_COINS = Math.max(0, Math.round(Number(process.env.REVIEW_REWARD_COINS ?? 1) || 0));

/** The requirements as the card shows them. */
export function requirementsOf(b) {
  const isReview = b?.battle_type === "review";
  return {
    coins: coinsNeeded(b?.total_questions),
    minXp: isReview ? 0 : Math.max(0, Number(b?.min_xp) || 0),
    review: isReview,
  };
}

/**
 * → { ok, coins: { need, have }, xp: { need, have }, message }
 * `message` says what is short, in words a learner can act on.
 */
export async function entryCheck(userId, battle) {
  const req = requirementsOf(battle);
  const billTo = await schoolBillTo(userId).catch(() => null);
  const [wallet, { data: agent }] = await Promise.all([
    coinsAvailable({ userId, billTo, min: req.coins }).catch(() => ({ ok: false, total: 0 })),
    db.from("user_agents").select("total_xp").eq("user_id", userId).maybeSingle(),
  ]);
  const haveCoins = Number(wallet.total) || 0;
  const haveXp = Number(agent?.total_xp) || 0;
  const short = [];
  if (haveCoins < req.coins) short.push(`about ${req.coins} coins for your agent's answers (you have ${haveCoins}) — top up first`);
  if (req.minXp && haveXp < req.minXp) short.push(`${req.minXp} XP to enter (you have ${haveXp})`);
  return {
    ok: !short.length,
    coins: { need: req.coins, have: haveCoins },
    xp: { need: req.minXp, have: haveXp },
    review: req.review,
    message: short.length ? `Not enough to join: this battle needs ${short.join(", and ")}.` : null,
  };
}

/** Throw a 402 the routes pass straight to the learner. */
export async function assertEntry(userId, battle) {
  const r = await entryCheck(userId, battle);
  if (!r.ok) throw Object.assign(new Error(r.message), { status: 402, code: "ENTRY_REQUIREMENTS", requirements: r });
  return r;
}
