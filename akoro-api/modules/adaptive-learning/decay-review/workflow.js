/**
 * decay-review/workflow.js — the Decay Review as a workflow of the engine
 * (Grand Plan §10, Phase 8). PURE — no db, no model, no clock.
 *
 *   inspecting     the alert and the topic's concepts are read
 *   diagnostic     a short Agent Check (retention_check, 3 questions): has the
 *                  protégé's knowledge faded?
 *   evaluating     the check is in — code decides retained / decayed
 *   retained       → completed (reinforced, alert resolved)
 *   decayed        → intervention
 *   intervention   retrieval practice first (the learner recalls, hint ladder,
 *                  server-scored, ≤3 rounds); after a failed retest, a
 *                  re-teaching session (the decay teaching dialogue)
 *   retest         an Agent Check again — passed → completed; failed →
 *                  adapt_strategy → intervention (teaching), at most 2 retests
 *   completed / abandoned / cancelled; any open state ⇄ paused
 *
 * Created only by the learner's action (the scheduler only raises alerts).
 * Everything that decides — retained or not, the score, the hint ladder, the
 * caps, the evidence — is here or in the harness, never the model's.
 */
import { defineWorkflow } from "../../workflows/definition.js";
import { registerWorkflow } from "../../workflows/registry.js";

export const DECAY_STATES = Object.freeze(["created", "inspecting", "diagnostic", "evaluating", "retained", "decayed", "intervention", "retest", "adapt_strategy", "completed", "paused", "abandoned", "cancelled"]);
const OPEN = ["created", "inspecting", "diagnostic", "evaluating", "decayed", "intervention", "retest", "adapt_strategy"];
export const DECAY_TRANSITIONS = Object.freeze({
  created: ["inspecting", "cancelled", "abandoned"],
  inspecting: ["diagnostic", "paused", "cancelled", "abandoned"],
  diagnostic: ["evaluating", "paused", "cancelled", "abandoned"],
  evaluating: ["retained", "decayed"],
  retained: ["completed"],
  decayed: ["intervention", "paused", "cancelled", "abandoned"],
  intervention: ["retest", "paused", "cancelled", "abandoned"],
  retest: ["completed", "adapt_strategy", "paused", "cancelled", "abandoned"],
  adapt_strategy: ["intervention", "completed", "cancelled", "abandoned"],
  paused: OPEN.filter((s) => s !== "created" && s !== "evaluating"),
  completed: [], abandoned: [], cancelled: [],
});
export const OPEN_DECAY_STATES = Object.freeze(OPEN);

export const decayReviewWorkflow = registerWorkflow(defineWorkflow({
  type: "decay_review", version: "1",
  states: DECAY_STATES, initial: "created", transitions: DECAY_TRANSITIONS,
  statusOf: {
    created: "active", inspecting: "active", diagnostic: "waiting_child", evaluating: "active",
    retained: "active", decayed: "active", intervention: "waiting_learner", retest: "waiting_child",
    adapt_strategy: "active", completed: "completed", paused: "paused", abandoned: "abandoned", cancelled: "cancelled",
  },
}));

/** §10.3 — the review's fixed rules. */
export const DECAY_POLICY = Object.freeze({
  CHECK_QUESTIONS: 3,           // the short retention check
  RETEST_QUESTIONS: 3,
  RETAINED_AT: 0.7,             // score ≥ this → retained
  MAX_RETESTS: 2,
  RETRIEVAL_ROUNDS: 3,
  HINT_LEVELS: Object.freeze(["none", "cue", "partial"]),
});

/** PURE: retained or decayed, from a check's result. */
export const evaluateRetention = (result) => ((Number(result?.score) || 0) >= DECAY_POLICY.RETAINED_AT ? "retained" : "decayed");

/** PURE: one recall answer's outcome — a hint lowers what a right answer counts for. */
export function recallOutcome({ verdict, hintLevel = 0 }) {
  if (verdict === "correct") return hintLevel === 0 ? "correct" : "partial";
  if (verdict === "partial") return hintLevel === 0 ? "partial" : "incorrect";
  return "incorrect";
}

/** PURE: the next hint level, or null when the ladder is used up. */
export const nextHintLevel = (current) => (current + 1 < DECAY_POLICY.HINT_LEVELS.length ? current + 1 : null);

/**
 * PURE: per-concept outcomes for the forgetting curve — what the check's
 * questions and the recall rounds showed. A concept the review never reached
 * is left out (it keeps fading).
 */
export function conceptOutcomes({ concepts = [], check = null, recalls = [] }) {
  const out = {};
  const names = concepts.map((c) => String(c?.concept ?? c ?? "").trim()).filter(Boolean);
  const match = (text) => names.find((n) => String(text || "").toLowerCase().includes(n.toLowerCase()) || n.toLowerCase().includes(String(text || "").toLowerCase().slice(0, 40))) || null;
  const rank = { incorrect: 0, partial: 1, correct: 2 };
  const put = (name, outcome) => { if (name && (out[name] == null || rank[outcome] > rank[out[name]])) out[name] = outcome; };
  for (const q of check?.perQuestion || []) {
    const name = q.outcome === "correct" ? match(q.fromNote) : match(q.gap);
    put(name, q.outcome === "correct" ? "correct" : "incorrect");
  }
  for (const r of recalls) put(match(r.concept) || r.concept, r.outcome);
  // A check that reached nothing nameable: its score speaks for the topic's faded concepts.
  if (!Object.keys(out).length && check) for (const n of names) out[n] = (Number(check.score) || 0) >= DECAY_POLICY.RETAINED_AT ? "correct" : "incorrect";
  return out;
}

/** §10.4 — the outcome a finished review records. */
export function decayOutcome({ retained, before = null, after = null, strategy = null, recalls = [], checks = [] }) {
  return {
    retained: !!retained, retentionBefore: before, retentionAfter: after,
    strategyUsed: strategy || (recalls.length ? "retrieval_practice" : null),
    evidence: [
      ...checks.map((c) => ({ kind: c.kind, score: c.score, correct: c.correct, total: c.total })),
      ...recalls.map((r) => ({ kind: r.outcome === "incorrect" ? "retrieval_failure" : "retrieval_success", concept: r.concept, outcome: r.outcome, hints: r.hintLevel })),
    ],
  };
}

/** The modal's and the dashboard's view of one review. */
export function decayView(instance) {
  if (!instance) return null;
  const m = instance.metadata || {};
  const round = m.retrieval?.current || null;
  return {
    workflowId: instance.id, state: instance.state, status: instance.status,
    subject: m.subject || null, topic: m.topic || null, concepts: (m.concepts || []).map((c) => c.concept ?? c),
    confidence: m.confidence ?? null,
    check: m.check || null, retest: m.retest || null, retests: m.retests || 0,
    retrieval: m.retrieval ? {
      round: m.retrieval.round || 0, of: DECAY_POLICY.RETRIEVAL_ROUNDS, done: m.retrieval.done || [],
      // The question and the hints shown so far — never the answer key.
      current: round ? { question: round.question, concept: round.concept, hintLevel: round.hintLevel || 0, hints: (round.hints || []).slice(0, round.hintLevel || 0) } : null,
    } : null,
    teaching: m.teaching || null,
    outcome: m.outcome || null,
    createdAt: instance.created_at || null, updatedAt: instance.updated_at || null,
  };
}
