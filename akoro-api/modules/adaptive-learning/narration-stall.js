// A step narration that arrives WITHOUT its tool call is not an answer.
// The narration rules teach one sentence per step, riding with the call;
// the model sometimes sends the sentence alone, and the chat loop's
// text-only branch would promote the promise to the reply and close the
// turn as a success (live, 2026-11-17: rebuild turns repeatedly ended on
// "I'll check the capability…" with zero tool calls). These pure helpers
// let the loop recognise that shape — and a plan the agent itself left
// unfinished — so it can continue the turn once instead.

// Gerunds that announce a step. The re- prefix matters: "Rebuilding
// first, then I'll run it…" stalled a live verification turn on
// 2026-11-17 because the list had "building" but not "rebuilding" —
// the lead is anchored at the string start, so the prefix hid it.
const GERUND = "(?:re-?)?(?:checking|running|looking|searching|getting|fetching|creating|building|deleting|removing|updating|drafting|retrying|working|pulling|gathering|finding|reading|loading|preparing|opening)";
const INTENT_LEAD = new RegExp(`^(i['’]ll|i will|let me|i['’]m (?:going to|${GERUND})|${GERUND}|now (?:i|let me)|one (?:moment|sec|second))\\b`, "i");

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

// A deferral clause ANYWHERE in the reply: the reply itself says the
// answer or the work isn't here yet ("I don't have a delete-chat tool
// in my set — let me check what Akoro actually supports before I
// answer", live, 2026-11-18, zero tool calls). looksLikeStepNarration
// only sees intent at the string start; this catches the trailing
// form. The loop applies it only when nothing has run — a reply that
// already did work and mentions checking something is reporting, not
// stalling. Questions stay excluded, as above.
const DEFERRAL_CLAUSE = /\b(let me (check|see|look|verify|confirm|find out)|before i (answer|respond|reply)|give me a (moment|second|sec)\b|one moment\b|hang on\b|just a (moment|second|sec)\b)/i;
const PROMISE_FIRST = /\bi['’]ll (check|look|verify|confirm|run|get|find|do|read|pull|fetch)[^.]{0,80}\b(first|before|then)\b/i;

export function containsDeferral(text) {
  const t = String(text || "").trim();
  if (!t || t.includes("?")) return false;
  if (/^let me know\b/i.test(t)) return false;
  return DEFERRAL_CLAUSE.test(t) || PROMISE_FIRST.test(t);
}

// The reply ADMITS the asked-for work wasn't done and pushes it to a
// later turn ("Nothing was rebuilt and nothing ran in this turn… Say
// the word and I'll actually do it", live, 2026-11-18, zero tool
// calls, in a session whose history had filled with verification
// back-and-forth). Length doesn't matter — an admission is an
// admission — and a trailing question doesn't rescue it. The loop
// applies it only when nothing has run: after real executions the
// same words are an honest outcome report, not a stall.
const NON_COMPLETION = /(\bnothing (was|has been|got) (rebuilt|run|ran|done|changed|deleted|created|built|saved|removed)\b|\bno (tool|action|change|run) (was|has been) (run|taken|made|executed)\b|\bi (haven['’]t|didn['’]t|did not|have not) (actually )?(run|ran|done|rebuilt|built|deleted|created|saved|removed|checked)\b|\bsay the word and i['’]ll\b|\bask me again and i['’]ll\b|\bi['’]ll actually do it\b|\blet me know if you want me to (actually|go ahead)\b)/i;

export function admitsNonCompletion(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return NON_COMPLETION.test(t);
}

/** True when the turn's own plan still has steps the agent has not done. */
export function planHasOpenSteps(ledger) {
  const plan = ledger?.plan;
  return Array.isArray(plan) && plan.some((st) => st && !["done", "completed"].includes(st.status));
}
