/**
 * modules/agent-context/personas/student.js — prompt builders for the Student
 * Agent (the learner's protégé, agents/student/agent.js — Context Layer
 * Adoption P2b flagship persona). Verbatim workspace templates in
 * akoro-agent/agents/student/*.md; byte-identity pinned by
 * agentContext.golden.personas.test.mjs.
 *
 * The split (mini-plan D2/D3): the templates own the persona VOICE (reply
 * rules, evidence judging, understanding analysis, knowledge extraction, the
 * five evolving personality bands). Dynamic truth — cognitive state numbers,
 * RAG context, subject-scoped level, teaching evidence, pace, recent history —
 * is computed by the agent from the database and passed in as values; it never
 * lives in files.
 */

import { renderPersona } from "../template.js";

const DIR = "agents/student";

/** The protégé's in-session reply persona (state-conditioned). */
export async function buildStudentAgentReplyPrompt(values) {
  return renderPersona(`${DIR}/REPLY.md`, values);
}

/** The teaching-evidence judge (JSON). */
export async function buildStudentAgentEvidencePrompt(values) {
  return renderPersona(`${DIR}/EVIDENCE.md`, values);
}

/** The understanding-analysis judge (JSON). */
export async function buildStudentAgentAnalyzePrompt(values) {
  return renderPersona(`${DIR}/ANALYZE.md`, values);
}

/** The knowledge-extraction judge (JSON). */
export async function buildStudentAgentExtractPrompt(values) {
  return renderPersona(`${DIR}/EXTRACT.md`, values);
}

/**
 * One personality voice band — NEW_SUBJECT | FRESH | EARLY | SOLID | ADVANCED.
 * The agent picks the band from level/sessions/mastery (behaviour, code);
 * the band's words are doctrine (files).
 */
export async function studentPersonality(band, values = {}) {
  return renderPersona(`${DIR}/personality/${band}.md`, values ?? {});
}
