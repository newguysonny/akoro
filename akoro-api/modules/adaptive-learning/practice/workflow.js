/**
 * practice/workflow.js — the `practice` workflow type (Grand Plan §11, Phase 9).
 * PURE — no db, no model, no clock.
 *
 * One type, two kinds of run (one definition, since the engine keys by type):
 *   · the live PROCTORED assessment (§11): created → consent → preparing →
 *     in_progress ⇄ paused → scoring → evaluated → completed, or terminated
 *     (integrity — never the agent's call), abandoned, cancelled;
 *   · an Agent Check run (§7.12, study-prep/agent-check-run.js): running →
 *     completed | stopped | abandoned. Its rows are created straight in
 *     `running`, so it behaves exactly as before.
 *
 * Everything that decides — the score, the hint policy and its deductions,
 * the verdict, whether evidence may be written — is here, in code.
 */
import { defineWorkflow } from "../../workflows/definition.js";
import { registerWorkflow } from "../../workflows/registry.js";

const PROCTORED = ["created", "consent", "preparing", "in_progress", "paused", "scoring", "evaluated", "completed", "terminated", "abandoned", "cancelled"];
const CHECK = ["running", "stopped"];
export const PRACTICE_STATES = Object.freeze([...PROCTORED, ...CHECK]);
export const PRACTICE_TRANSITIONS = Object.freeze({
  created: ["consent", "preparing", "abandoned", "cancelled"],
  consent: ["preparing", "abandoned", "cancelled"],
  preparing: ["in_progress", "abandoned", "cancelled"],
  in_progress: ["paused", "scoring", "terminated", "abandoned", "cancelled"],
  paused: ["in_progress", "terminated", "abandoned"],
  scoring: ["evaluated", "terminated"],
  evaluated: ["completed"],
  running: ["completed", "stopped", "abandoned"],
  completed: [], terminated: [], abandoned: [], cancelled: [], stopped: [],
});
export const practiceWorkflow = registerWorkflow(defineWorkflow({
  type: "practice", version: "practice.2",
  states: PRACTICE_STATES, initial: "created", transitions: PRACTICE_TRANSITIONS,
  statusOf: {
    created: "active", consent: "waiting_learner", preparing: "active", in_progress: "active", paused: "paused",
    scoring: "active", evaluated: "active", completed: "completed", terminated: "abandoned", abandoned: "abandoned", cancelled: "cancelled",
    running: "active", stopped: "cancelled",
  },
}));

/** §11.4 — fixed in code, never the agent's call. */
export const PRACTICE_POLICY = Object.freeze({
  PASS_AT: 70,                    // assessment_score (0–100) for a pass
  FLAG_AT: 0.4,                   // cheat probability: a passing score is "flagged" from here
  TERMINATE_AT: 0.85,             // sustained cheat probability ends the exam (the gateway's auto-terminate)
  MAX_HINTS_PER_QUESTION: 1,
  MAX_HINTS_PER_SESSION: 2,
  HINT_DEDUCTION: 15,             // points off that question's score for a hint
  MAX_PROBES_PER_QUESTION: 1,     // a follow-up on the same question
  MAX_ITERATIONS: 3,
  DECISION_TIMEOUT_MS: 8_000,
});

/** PURE: one question's harness score — Sergeant's judgement (a proposal, 0–100), a probe's if better, minus hint deductions. */
export function questionScore({ judged = 0, probe = null, hints = 0 }) {
  const base = Math.max(Number(judged) || 0, probe == null ? 0 : Math.round(((Number(judged) || 0) + (Number(probe) || 0)) / 2));
  return Math.max(0, Math.min(100, Math.round(base - hints * PRACTICE_POLICY.HINT_DEDUCTION)));
}

/** PURE: the assessment_score (0–100) over every question asked. */
export function assessmentScore(questions = []) {
  const scored = questions.filter((q) => q && q.judged != null);
  return scored.length ? Math.round(scored.reduce((s, q) => s + questionScore(q), 0) / scored.length) : 0;
}

/** PURE: the verdict, computed from the score, the pass mark and integrity (Sergeant only explains it). */
export function computeVerdict({ score, cheatProbability = 0, terminated = false }) {
  if (terminated || cheatProbability >= PRACTICE_POLICY.TERMINATE_AT) return "terminated";
  if (cheatProbability >= PRACTICE_POLICY.FLAG_AT) return "flagged";
  return (Number(score) || 0) >= PRACTICE_POLICY.PASS_AT ? "pass" : "fail";
}

/** PURE: evidence goes to the learner model only for a clean, completed run. */
export const evidenceAllowed = (verdict) => verdict === "pass" || verdict === "fail";

/** PURE: what to do next (§11.8); a flagged or terminated run recommends nothing. */
export function recommendNext({ verdict, score }) {
  if (!evidenceAllowed(verdict)) return "none";
  if (verdict === "pass") return "none";
  return (Number(score) || 0) >= 50 ? "retrieval_practice" : "teaching";
}

/** PURE: may the agent give a hint now? → { ok } | { ok:false, error } */
export function hintAllowed({ hintsThisQuestion = 0, hintsThisSession = 0 }) {
  if (hintsThisQuestion >= PRACTICE_POLICY.MAX_HINTS_PER_QUESTION) return { ok: false, error: "hint_limit_question" };
  if (hintsThisSession >= PRACTICE_POLICY.MAX_HINTS_PER_SESSION) return { ok: false, error: "hint_limit_session" };
  return { ok: true };
}

/** §11.8 — the outcome a finished run records. */
export function practiceOutcome({ score, verdict, cheatProbability, questions = [], topic }) {
  const clean = evidenceAllowed(verdict);
  return {
    score, passed: verdict === "pass", verdict, cheatProbability,
    conceptEvidence: clean ? questions.map((q) => ({ concept: q.objective || topic, score: questionScore(q), hints: q.hints || 0, probed: q.probe != null })) : [],
    recommendedNextAction: recommendNext({ verdict, score }),
  };
}
