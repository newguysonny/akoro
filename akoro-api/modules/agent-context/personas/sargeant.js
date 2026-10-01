/**
 * modules/agent-context/personas/sargeant.js — prompt builders for Sargeant
 * (assessment gate) and SergeantProctor (human exam interrogator)
 * (Context Layer Adoption P2). Verbatim workspace templates in
 * akoro-agent/agents/sargeant/*.md; byte-identity pinned by
 * agentContext.golden.personas.test.mjs.
 */

import { renderPersona } from "../template.js";

const DIR = "agents/sargeant";

/* ── Sargeant — assessment gate between subtopics ────────────────────────── */

/** Two assessment questions for the Student AI Agent. */
export async function buildAssessmentQuestionsPrompt({ agentName, subtopic }) {
  return renderPersona(`${DIR}/ASSESSMENT_QUESTIONS.md`, { agentName, subtopic });
}

/** Strict evaluation of the agent's answer. */
export async function buildAssessmentEvaluatePrompt() {
  return renderPersona(`${DIR}/ASSESSMENT_EVALUATE.md`, {});
}

/** Post-assessment verdict. `passed` is the boolean gate result. */
export async function buildAssessmentVerdictPrompt({ agentName, subtopic, avgScore, passed }) {
  return renderPersona(`${DIR}/ASSESSMENT_VERDICT.md`, { agentName, subtopic, avgScore, passed });
}

/** Topic-drift check during teaching phases. */
export async function buildAssessmentDriftPrompt({ intendedTopic }) {
  return renderPersona(`${DIR}/ASSESSMENT_DRIFT.md`, { intendedTopic });
}

/* ── SergeantProctor — proctored assessment of the HUMAN ─────────────────── */

/**
 * Question-bank generation. `subjectSuffix` is the caller-computed
 * " (Subject)" fragment (empty when no subject) — a conditional in the
 * original interpolation, kept as decision logic in code.
 */
export async function buildProctorQuestionsPrompt({ questionCount, topic, subjectSuffix }) {
  return renderPersona(`${DIR}/PROCTOR_QUESTIONS.md`, { questionCount, topic, subjectSuffix });
}

/** Evaluation of one human answer. */
export async function buildProctorEvaluatePrompt({ difficulty, objective }) {
  return renderPersona(`${DIR}/PROCTOR_EVALUATE.md`, { difficulty, objective });
}

/** The one-sentence Socratic hint. */
export async function buildProctorHintPrompt() {
  return renderPersona(`${DIR}/PROCTOR_HINT.md`, {});
}

/**
 * Final exam verdict. `cheatPercent` is the caller-computed
 * (cheatProbability * 100).toFixed(0); `verdictTail` is the caller's
 * decision-logic ternary (review-required vs next-step wording).
 */
export async function buildProctorVerdictPrompt({ topic, avg, cheatPercent, verdictLabel, verdictTail }) {
  return renderPersona(`${DIR}/PROCTOR_VERDICT.md`, { topic, avg, cheatPercent, verdictLabel, verdictTail });
}
