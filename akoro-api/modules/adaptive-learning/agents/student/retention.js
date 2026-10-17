/**
 * agents/student/retention.js — the protégé's forgetting curve (Grand Plan
 * D44), pure. A learner can forget one concept without forgetting the whole
 * topic, so each concept (an agent_knowledge row: topic + subtopic) decays on
 * its own, slowly, and a topic's health is derived from its concepts.
 *
 *   current = learned × e^(−daysSinceReview ÷ stabilityDays)
 *
 * Recomputed from the last review every time (never from yesterday's decayed
 * value), so it can't compound. Stability grows with every good review —
 * well-taught concepts fade more slowly each time.
 */
export const RETENTION = Object.freeze({
  initialStabilityDays: 45,   // learned 0.85 → medium in ~1 week, high in ~3 weeks, critical in ~6 weeks (each good review doubles these)
  minStabilityDays: 7,
  maxStabilityDays: 365,
  floor: 0.05,
  ceiling: 0.98,
  // A review moves the concept back up and changes how slowly it fades next.
  review: Object.freeze({
    correct:   Object.freeze({ gain: 0.20, stability: 2.0 }),
    partial:   Object.freeze({ gain: 0.10, stability: 1.3 }),
    incorrect: Object.freeze({ gain: 0.02, stability: 0.6 }),
  }),
  // Teaching it again in an ordinary lesson.
  reteach: Object.freeze({ gain: 0.05, stability: 1.5 }),
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** What a concept stands at now. `learned` is its confidence at the last review. */
export function retainedConfidence({ learned, daysSince, stabilityDays = RETENTION.initialStabilityDays }) {
  const L = clamp(num(learned, 0.5), RETENTION.floor, RETENTION.ceiling);
  const t = Math.max(0, num(daysSince, 0));
  const S = clamp(num(stabilityDays, RETENTION.initialStabilityDays), RETENTION.minStabilityDays, RETENTION.maxStabilityDays);
  return clamp(L * Math.exp(-t / S), RETENTION.floor, RETENTION.ceiling);
}

/** After a review with `outcome` correct | partial | incorrect. → { learned, stabilityDays } */
export function afterReview({ current, stabilityDays, outcome }) {
  const rule = RETENTION.review[outcome] || RETENTION.review.incorrect;
  return {
    learned: clamp(num(current, 0.5) + rule.gain, RETENTION.floor, RETENTION.ceiling),
    stabilityDays: clamp(num(stabilityDays, RETENTION.initialStabilityDays) * rule.stability, RETENTION.minStabilityDays, RETENTION.maxStabilityDays),
  };
}

/** Taught again in an ordinary lesson. → { learned, stabilityDays } */
export function afterReteach({ current, stabilityDays }) {
  return {
    learned: clamp(num(current, 0.5) + RETENTION.reteach.gain, RETENTION.floor, RETENTION.ceiling),
    stabilityDays: clamp(num(stabilityDays, RETENTION.initialStabilityDays) * RETENTION.reteach.stability, RETENTION.minStabilityDays, RETENTION.maxStabilityDays),
  };
}

/** A review score 0..1 → outcome. */
export const outcomeForScore = (score) => (score >= 0.75 ? "correct" : score >= 0.40 ? "partial" : "incorrect");

/**
 * One concept's outcome from the session's teaching evidence: verified →
 * correct; worked on but not verified → partial; not reached → null (it was
 * not reviewed, so it keeps fading).
 */
export function outcomeForEvidence(concept) {
  if (!concept || typeof concept !== "object") return null;
  if (concept.masteryStatus === "verified") return "correct";
  if (concept.masteryStatus === "developing" || Number(concept.attempts) > 0) return "partial";
  return null;
}

const ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
export const conceptName = (row) => String(row?.subtopic || "").trim() || String(row?.topic || "").trim();

/**
 * A topic's health from its concept rows (each { subtopic, confidence,
 * priority }): the average confidence, the worst priority, every concept
 * weakest first, and the faded ones (high / critical).
 */
export function topicHealth(rows) {
  const concepts = (rows || []).map((r) => ({
    concept: conceptName(r),
    confidence: clamp(num(r.confidence, 0.5), 0, 1),
    priority: r.priority || "low",
  })).sort((a, b) => a.confidence - b.confidence);
  if (!concepts.length) return { confidence: null, priority: null, concepts: [], faded: [] };
  const confidence = concepts.reduce((sum, c) => sum + c.confidence, 0) / concepts.length;
  const priority = concepts.reduce((worst, c) => (ORDER[c.priority] > ORDER[worst] ? c.priority : worst), "low");
  return { confidence, priority, concepts, faded: concepts.filter((c) => c.priority === "critical" || c.priority === "high") };
}
