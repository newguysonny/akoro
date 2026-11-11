/**
 * self-tooling/toolSimilarity.js — PURE: do two tool goals describe the same
 * intent? Guards against tool flooding — the agent kept building a fresh tool
 * for near-identical goals ("Delete my earliest chat", "…(by position)",
 * "Delete a chat titled X", "Library count", "Library count (correct total)").
 *
 * Conservative on purpose: a near-duplicate should be reused, but two genuinely
 * different goals (same verb, different object) must still build.
 */

const STOP = new Set([
  "the", "a", "an", "my", "me", "to", "in", "of", "for", "by", "with", "and", "or",
  "is", "it", "this", "that", "on", "at", "from", "all", "any", "please", "can",
  "you", "i", "do", "does", "into", "about", "give", "show", "get", "make", "so",
]);

/** PURE: meaningful lowercase tokens of a goal/label. */
export function goalTokens(text) {
  return new Set(
    String(text || "").toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

const isSubset = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));

/** PURE: are these the same tool intent? (subset of tokens, or high overlap) */
export function similarGoal(a, b) {
  const A = goalTokens(a);
  const B = goalTokens(b);
  if (!A.size || !B.size) return false;
  // "library count" ⊆ "library count (correct total)" → the same tool.
  if ((isSubset(A, B) || isSubset(B, A)) && Math.min(A.size, B.size) >= 2) return true;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const union = A.size + B.size - inter;
  return union > 0 && inter / union >= 0.7;
}

/** PURE: pick the existing tool a new goal duplicates, if any. */
export function findDuplicateTool(goal, tools = []) {
  const g = String(goal || "");
  if (!g.trim()) return null;
  return (tools || []).find((t) => similarGoal(t?.goal || t?.label || "", g)) || null;
}
