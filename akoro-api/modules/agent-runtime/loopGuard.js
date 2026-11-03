/**
 * agent-runtime/loopGuard.js — the loop guard (Grand Plan Phase 18, item 3).
 * Pure; no db, no clock.
 *
 * An agent that calls the same tool with the same arguments again in a row
 * gets the same answer and spends the learner's time (and coins) doing it.
 * The guard counts consecutive identical calls and, from a threshold on,
 * adds a reminder to that call's observation:
 *
 *   2nd identical call in a row  a short reminder: change approach or finish
 *   4th and later                a firmer one naming the tool, the count and
 *                                a capped preview of the arguments
 *
 * It never blocks a call (a repeat can be right: a status that is expected to
 * change); it only says so where the model reads. Used by the workflow loop
 * (loop.js) and the Agent Chat tool loop (adaptive-learning/chat.js).
 *
 *   canonicalArgs(args)          stable JSON: keys sorted, private "__" keys and undefined dropped
 *   createLoopGuard(opts)        → { note(tool, args) → null | { level, count, text } }
 */
export const LOOP_GUARD = Object.freeze({ reminderAt: 2, firmAt: 4, previewChars: 120 });

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key.startsWith("__") || value[key] === undefined) continue;
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return typeof value === "string" ? value.trim() : value;
};

/** PURE: one string per distinct argument set, whatever the key order or the model's spacing. */
export function canonicalArgs(args) {
  if (args == null) return "{}";
  try { return JSON.stringify(canonical(args)); } catch { return String(args); }
}

/** PURE: the reminder for the n-th identical call in a row, or null below the first threshold. */
export function repeatReminder(tool, args, count, { reminderAt = LOOP_GUARD.reminderAt, firmAt = LOOP_GUARD.firmAt, previewChars = LOOP_GUARD.previewChars } = {}) {
  if (!(count >= reminderAt)) return null;
  if (count < firmAt) {
    return { level: "reminder", count, text: "You just made this same call with the same arguments, so the answer will not change. Change your approach (another tool or different arguments) or finish with what you have." };
  }
  const shown = canonicalArgs(args);
  const preview = shown.length > previewChars ? `${shown.slice(0, previewChars - 1)}…` : shown;
  return {
    level: "firm", count,
    text: `Stop repeating: ${tool} has now been called ${count} times in a row with the same arguments (${preview}). Do not call it again with these arguments. Use a different tool or different arguments, or finish now and tell the learner plainly what you found and what is still open.`,
  };
}

/** A guard for one turn / one step: note(tool, args) after each call, in call order. */
export function createLoopGuard(opts = {}) {
  let lastKey = null;
  let count = 0;
  return {
    note(tool, args) {
      const key = `${tool}\u0000${canonicalArgs(args)}`;
      count = key === lastKey ? count + 1 : 1;
      lastKey = key;
      return repeatReminder(tool, args, count, opts);
    },
    get count() { return count; },
  };
}
