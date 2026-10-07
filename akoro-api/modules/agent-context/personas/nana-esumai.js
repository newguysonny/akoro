/**
 * modules/agent-context/personas/nana-esumai.js — prompt builders for the
 * NaNa Esumai learning guide (Context Layer Adoption P2).
 *
 * Every prompt is a verbatim workspace template
 * (akoro-agent/agents/nana-esumai/*.md) with {{token}} placeholders;
 * byte-identity to the pre-migration literals is pinned by
 * agentContext.golden.personas.test.mjs. Dynamic truth (objectives, history,
 * evidence numbers) is computed by the caller and passed in — never stored
 * in files.
 */

import { renderPersona } from "../template.js";

const DIR = "agents/nana-esumai";

/** Lesson-ladder knowledge map (generateSubtopics). */
export async function buildKnowledgeMapPrompt() {
  return renderPersona(`${DIR}/KNOWLEDGE_MAP.md`, {});
}

/** Per-subtopic learning objectives (generateObjectives). */
export async function buildObjectivesPrompt() {
  return renderPersona(`${DIR}/OBJECTIVES.md`, {});
}

/** Subtopic opener: hook, why it matters, objectives, interactive ask. */
export async function buildOpenSubtopicPrompt({ agentName, agentEmoji, subtopic, topic, subject, subtopicNumber, totalSubtopics }) {
  return renderPersona(`${DIR}/OPEN_SUBTOPIC.md`, { agentName, agentEmoji, subtopic, topic, subject, subtopicNumber, totalSubtopics });
}

/** Per-turn coaching tip. `remaining` is the JSON-stringified objectives array. */
export async function buildCoachTurnPrompt({ agentName, subtopic, phase, agentConfidence, remaining }) {
  return renderPersona(`${DIR}/COACH_TURN.md`, { agentName, subtopic, phase, agentConfidence, remaining });
}

/** Phase-4 push: real-world application or edge case. */
export async function buildPushFurtherPrompt({ agentName, subtopic, topic }) {
  return renderPersona(`${DIR}/PUSH_FURTHER.md`, { agentName, subtopic, topic });
}

/** Subtopic teaching evaluation. */
export async function buildEvaluateSubtopicPrompt({ agentName, subtopic }) {
  return renderPersona(`${DIR}/EVALUATE_SUBTOPIC.md`, { agentName, subtopic });
}

/** Must-know parts detection (legacy decay-flow interface). */
export async function buildMustKnowPrompt() {
  return renderPersona(`${DIR}/MUST_KNOW.md`, {});
}

/**
 * The server-owned evidence instruction injected into the tip decision.
 * Computes the dynamic numbers from teaching evidence (the caller's dynamic
 * truth) and fills the doctrine template. Returns the string WITH its
 * leading newline — the tip template splices it in mid-prompt.
 */
export async function buildEvidenceInstruction({ teachingEvidence = {}, dialogue = {} }) {
  const currentEvidence = teachingEvidence.currentConcept || {};
  const learnerMasteryPct = Math.round((currentEvidence.learnerMastery || 0) * 100);
  const protegeUnderstandingPct = Math.round((currentEvidence.protegeUnderstanding || 0) * 100);
  const verified = currentEvidence.masteryStatus === "verified" ? "yes" : "no";
  return renderPersona(`${DIR}/EVIDENCE_INSTRUCTION.md`, {
    learnerMasteryPct,
    protegeUnderstandingPct,
    verified,
    move: dialogue.move || "clarify_core",
    pace: dialogue.pace || teachingEvidence.pace || "standard",
  });
}

/**
 * The tip decision prompt (getTip). `mustKnowParts` is the JSON-stringified
 * array; `currentSubtopic` is the already-fallback value (|| "none");
 * `evidenceInstruction` is buildEvidenceInstruction's output.
 */
export async function buildTipDecisionPrompt({ topic, phase, mustKnowParts, currentSubtopic, understanding, confusion, evidenceInstruction, mustKnowIndex }) {
  return renderPersona(`${DIR}/TIP_DECISION.md`, {
    topic, phase, mustKnowParts, currentSubtopic, understanding, confusion, evidenceInstruction, mustKnowIndex,
  });
}

/** Class-analytics read of one assigned activity's aggregate results. */
export async function buildClassAnalyticsPrompt() {
  return renderPersona(`${DIR}/CLASS_ANALYTICS.md`, {});
}

/** Whole-session teaching evaluation. */
export async function buildEvaluateSessionPrompt() {
  return renderPersona(`${DIR}/EVALUATE_SESSION.md`, {});
}
