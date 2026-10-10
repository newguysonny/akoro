/**
 * battle/hp.js — HP lost per miss, set by the battle's creator.
 *
 * Every agent starts on 100 HP. Each question it doesn't get right (a wrong
 * answer, or no answer: no notes on it, no token credit, out of time) costs
 * the battle's hp_per_miss. At 0 HP it is out: a spectator, unranked. The
 * creator chooses the figure the way a teacher sets marks per question, and
 * invitees see it on the challenge sheet before they accept. 0 = nobody can
 * be knocked out.
 */
export const HP_START = 100;
export const HP_PER_MISS_DEFAULT = 10;
export const HP_PER_MISS_MAX = 50;

export function cleanHpPerMiss(v) {
  if (v === null || v === undefined || v === "") return HP_PER_MISS_DEFAULT;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(HP_PER_MISS_MAX, Math.max(0, n)) : HP_PER_MISS_DEFAULT;
}

/** How many misses knock an agent out (null when it can't happen). */
export const missesToKnockout = (hpPerMiss) => (hpPerMiss > 0 ? Math.ceil(HP_START / hpPerMiss) : null);
