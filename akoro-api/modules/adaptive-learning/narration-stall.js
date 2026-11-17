// A step narration that arrives WITHOUT its tool call is not an answer.
// The narration rules teach one sentence per step, riding with the call;
// the model sometimes sends the sentence alone, and the chat loop's
// text-only branch would promote the promise to the reply and close the
// turn as a success (live, 2026-11-17: rebuild turns repeatedly ended on
// "I'll check the capability…" with zero tool calls). These pure helpers
// let the loop recognise that shape — and a plan the agent itself left
// unfinished — so it can continue the turn once instead.

const INTENT_LEAD = /^(i['’]ll|i will|let me|i['’]m (going to|checking|running|looking|searching|getting|fetching|creating|building|deleting|removing|updating|drafting|retrying|working|pulling|gathering)|checking|running|looking|searching|getting|fetching|creating|building|deleting|removing|updating|drafting|retrying|working|pulling|gathering|finding|reading|loading|preparing|opening|now (i|let me)|one (moment|sec|second))\b/i;

/** True when a text-only reply reads as a step announcement rather than
 * an answer: short, intent-led, and not a question back to the learner.
 * Deliberately conservative — a miss costs nothing (the reply is simply
 * accepted, as before), and a false hit costs one extra decision whose
 * repeated text-only reply is then accepted unconditionally. */
export function looksLikeStepNarration(text) {
  const t = String(text || "").trim();
  if (!t || t.includes("?")) return false;
  if (/^let me know\b/i.test(t)) return false;
  if (t.split(/\s+/).length > 48) return false;
  return INTENT_LEAD.test(t);
}

/** True when the turn's own plan still has steps the agent has not done. */
export function planHasOpenSteps(ledger) {
  const plan = ledger?.plan;
  return Array.isArray(plan) && plan.some((st) => st && !["done", "completed"].includes(st.status));
}
