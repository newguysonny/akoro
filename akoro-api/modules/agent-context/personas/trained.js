/**
 * modules/agent-context/personas/trained.js — prompt builders for trained
 * teacher agents (Context Layer Adoption P2b: TRAINED_SHELL).
 *
 * The mini-plan's composition contract: a trained agent's prompt is
 * agents/trained/SHELL.md (platform doctrine) FIRST, then the teacher's own
 * DB-configured style and pgvector context — the layer composes doctrine
 * AROUND a teacher's style, never replaces it (D3). The seam exposes the
 * shell and the six verbatim templates; training/agentPromptBuilder.js and
 * agents/trained/*.js compute the dynamic truth and DB config as values.
 *
 * Byte-identity of the templates (excluding the deliberately prepended
 * shell) is pinned by agentContext.golden.personas.test.mjs; the
 * shell-first order is pinned by trained-shell.contract.test.mjs.
 */

import { loadDoctrine } from "../context-manager.js";
import { renderPersona } from "../template.js";

const DIR = "agents/trained";

/** The platform shell every trained-agent session prompt opens with. */
export async function trainedShell() {
  return loadDoctrine(`${DIR}/SHELL.md`);
}

/** The guide agent's tip-decision prompt (teacher style + session truth). */
export async function buildTrainedGuideTipPrompt(values) {
  return renderPersona(`${DIR}/GUIDE_TIP.md`, values);
}

/** The control agent's drift-classification prompt. */
export async function buildTrainedControlDriftPrompt(values) {
  return renderPersona(`${DIR}/CONTROL_DRIFT.md`, values);
}

/** The trained student agent's reply persona. */
export async function buildTrainedStudentReplyPrompt(values) {
  return renderPersona(`${DIR}/STUDENT_REPLY.md`, values);
}

/** Curriculum must-know fallback (JSON judge). */
export async function buildTrainedMustKnowPrompt() {
  return renderPersona(`${DIR}/MUST_KNOW.md`, {});
}

/** Topic-boundary definition for the control agent (JSON judge). */
export async function buildTrainedBoundaryPrompt(values) {
  return renderPersona(`${DIR}/BOUNDARY.md`, values);
}

/** End-of-session evaluation (JSON judge). */
export async function buildTrainedEvaluateSessionPrompt(values) {
  return renderPersona(`${DIR}/EVALUATE_SESSION.md`, values);
}
