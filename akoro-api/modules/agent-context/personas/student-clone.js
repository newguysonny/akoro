/**
 * modules/agent-context/personas/student-clone.js — prompt builders for the
 * shared Student-AI-clone reply and understanding analysis
 * (base-orchestrator.js, Context Layer Adoption P2). Verbatim workspace
 * templates in akoro-agent/agents/student-clone/*.md; byte-identity pinned
 * by agentContext.golden.personas.test.mjs.
 */

import { renderPersona } from "../template.js";

const DIR = "agents/student-clone";

/** The student clone's in-session reply persona (state-conditioned). */
export async function buildStudentCloneReplyPrompt({ topic, phaseLabel, understanding, confusion }) {
  return renderPersona(`${DIR}/REPLY.md`, { topic, phaseLabel, understanding, confusion });
}

/** The JSON understanding-analysis judge. */
export async function buildStudentCloneAnalyzePrompt() {
  return renderPersona(`${DIR}/ANALYZE.md`, {});
}
