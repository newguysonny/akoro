/**
 * Education Engine — deterministic scoring, thresholds, mastery evidence and
 * cost estimation for the study-prep build (Master Plan §4.5).
 *
 * PURE FUNCTIONS ONLY. No db, no LLM, no clock reads — every input is passed
 * in, so contract tests run with fixed fixtures and no time bombs. The agent
 * uses this engine; it never replaces it.
 */
import { getStrategy, isPermittedStrategy as libraryPermits, strategiesFor } from "../strategies/library.js";

/** Deterministic answer-key scoring. The LLM never scores anything. */
export function scoreAttempt(answerKey, answers) {
  const submitted = {};
  for (const item of Array.isArray(answers) ? answers : []) {
    const id = String(item?.questionId || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, 80);
    const answerIndex = Number(item?.answerIndex);
    if (!id || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3 || submitted[id] !== undefined) {
      throw new Error("invalid_answers");
    }
    submitted[id] = answerIndex;
  }
  const key = answerKey || {};
  const total = Object.keys(key).length;
  if (total > 10) throw new Error("too_many_answers");
  const correct = Object.entries(key).filter(([id, answer]) => submitted[id] === Number(answer)).length;
  const score = total ? Math.round((correct / total) * 10_000) / 10_000 : 0;
  return { submitted, total, correct, score };
}

/** Threshold routing for a topic attempt (70% default, policy overridable). */
export function applyThreshold({ score, passThreshold, attemptsUsed, maxAttempts }) {
  const passed = Number(score) >= Number(passThreshold);
  const attemptsRemaining = Math.max(0, Number(maxAttempts) - Number(attemptsUsed));
  const capped = !passed && attemptsRemaining === 0;
  return { passed, capped, attemptsRemaining };
}

/** Topic outcome for the session state machine (S4 topic states). */
export function topicOutcome({ passed, capped }) {
  if (passed) return "understood";
  if (capped) return "capped_out";
  return "retest_offered";
}

/**
 * Scale guard at the learner-model boundary (§7.8, Phase 10). Concept state
 * and evidence are 0–1; `edu.knowledge_confidence` and the proctored
 * assessment score are 0–100. Every caller names the scale it holds:
 *   toUnitScore(0.8)                      → 0.8
 *   toUnitScore(80, { scale: "percent" }) → 0.8
 *   toUnitScore(80)                       → null   (a 0–100 value passed as 0–1 is
 *                                                    refused — never clamped to 1)
 * Non-numbers and out-of-range values → null: no evidence, not a guess.
 */
export function toUnitScore(value, { scale = "unit" } = {}) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (scale === "percent") return n <= 100 ? n / 100 : null;
  if (scale === "unit") return n <= 1 ? n : null;
  throw new Error(`unknown_scale:${scale}`);
}

/** 0–1 → 0–100 for the legacy/UI scale (rounded); null stays null. */
export function toPercentScore(value) {
  const unit = toUnitScore(value);
  return unit == null ? null : Math.round(unit * 100);
}

/**
 * Deterministic mastery write-back (Master Plan §4.5): a passed attempt lifts
 * evidence toward the pass threshold band; a failed attempt decays it
 * slightly. `knowledge_confidence` (0–100) maps to the 0–1 scale as fallback
 * (S4 §6). Never an LLM judgement.
 */
export function masteryWriteBack({ currentMastery = null, knowledgeConfidence = null, score, passed, attemptsUsed = 1 }) {
  const hasMastery = currentMastery != null && Number.isFinite(Number(currentMastery)) && Number(currentMastery) >= 0 && Number(currentMastery) <= 1;
  const hasConfidence = knowledgeConfidence != null && Number.isFinite(Number(knowledgeConfidence));
  const baseline = hasMastery
    ? Number(currentMastery)
    : hasConfidence ? toUnitScore(Math.max(0, Math.min(100, Number(knowledgeConfidence))), { scale: "percent" })
      : null;
  const observed = Number(score);
  if (baseline == null) {
    // No prior evidence: the attempt itself is the first evidence.
    return { previous: null, next: passed ? Math.max(observed, 0.7) : observed, evidence: "first_attempt" };
  }
  // Exponential-ish blend: fresh evidence outweighs stale state, more so after
  // multiple attempts (retrieval practice). Bounded to [0, 1].
  const weight = Math.min(0.6, 0.35 + 0.1 * (Math.max(1, Number(attemptsUsed)) - 1));
  const next = Math.max(0, Math.min(1, baseline * (1 - weight) + observed * weight));
  return { previous: baseline, next: Math.round(next * 10_000) / 10_000, evidence: passed ? "passed_attempt" : "attempt_evidence" };
}

/**
 * Plan-card cost estimate (Master Plan §4.11): per-topic practice generation
 * plus the per-loop LLM cost at a ROUNDED value so the learner is never
 * surprised (S5 still-open recommendation, adopted as Decision).
 */
export const STUDY_PREP_COST = Object.freeze({
  COINS_PER_PRACTICE: 2,
  PRACTICES_PER_TOPIC: 2,          // diagnostic + one retest band
  LOOP_LLM_COINS_PER_STEP: 1,      // rounded per-step loop overhead
  // The agent's turns per topic after approval (its wakes: a topic starting, a check marked, a teach-back…).
  // Measured 2026-10-19 at ~3 coins a decision; the plan's estimate counts this per topic.
  WAKE_COINS_PER_TOPIC: Math.max(1, Math.round(Number(process.env.STUDY_PREP_WAKE_COINS_PER_TOPIC ?? 1)) || 1),
  // What the learner approves at a time when the coins run out ("Approve N more").
  APPROVE_MORE_COINS: 10,
});

export function estimateSessionCost({ topicCount, maxIterationsPerStep = 6 }) {
  const topics = Math.max(0, Math.min(Number(topicCount) || 0, 12));
  const practice = topics * STUDY_PREP_COST.COINS_PER_PRACTICE * STUDY_PREP_COST.PRACTICES_PER_TOPIC;
  const planningLoop = STUDY_PREP_COST.LOOP_LLM_COINS_PER_STEP;                 // one planning step
  const topicLoops = topics * STUDY_PREP_COST.WAKE_COINS_PER_TOPIC;              // the agent's wakes per topic
  return {
    practiceCoins: practice,
    loopCoins: planningLoop + topicLoops,
    totalCoins: practice + planningLoop + topicLoops,
    maxIterationsPerStep,
    breakdown: { perTopicPractice: STUDY_PREP_COST.COINS_PER_PRACTICE * STUDY_PREP_COST.PRACTICES_PER_TOPIC, planningLoop, topicLoops },
  };
}

/**
 * Strategy library (Master Plan §4.2/§4.12 Decision 3; Grand Plan §7.7.2 v3):
 * the agent may only offer a strategy the ONE library (strategies/library.js)
 * allows in Study Prep — anything else, or anything switched off, is
 * rejected with strategy_not_permitted.
 */
export const STRATEGY_LIBRARY = Object.freeze(strategiesFor("study_prep", { includeDisabled: true }));

export function isPermittedStrategy(strategy) {
  const id = String(strategy || "").trim();
  return getStrategy(id)?.id === id && libraryPermits(id, "study_prep");
}
