/**
 * adaptive-learning/toolLimits.js — Agent Chat's tool time limits (Grand Plan
 * Phase 18, item 3). Pure, apart from the timer.
 *
 * Every chat tool has a limit: its own (CHAT_TOOL_TIME_LIMITS_MS), else its
 * family's — a read, a change, or a tool that writes with a model (drafts,
 * builds, consults). Past it the loop stops waiting and the agent reads a
 * failed observation with the code `timeout`; the recovery rule
 * (toolRecovery.js) takes it from there: a read is tried once more, a change
 * is not repeated (it may still finish on its own).
 */
import { withToolTimeLimit } from "../agent-runtime/toolTime.js";

export const CHAT_TOOL_FAMILY_LIMITS_MS = Object.freeze({
  read: 45_000,
  change: 90_000,
  model: 180_000,
});

/** Tools that call a model or another agent before they answer: the `model` family. */
export const MODEL_BACKED_CHAT_TOOLS = Object.freeze([
  "consult_peer_agents", "consult_teaching_guide", "ask_to_be_taught", "analyse_past_papers",
  "search_my_study_knowledge", "search_my_library", "make_study_material", "read_blog_post",
  "start_study_prep_session", "challenge_agent", "class_battle", "rematch_battle", "request_guide_review",
  "prepare_activity", "revise_activity_draft", "run_teaching_tool", "check_activity_outcomes",
]);

/** Limits declared per tool (above their family's). */
export const CHAT_TOOL_TIME_LIMITS_MS = Object.freeze({
  // Builds, verifies (up to five builder calls) and may run the new tool once.
  create_tool: 300_000,
  // Waits for the learner's tap on a card (its own poll window is 100s).
  await_decision: 150_000,
  schema_lookup: 20_000,
  update_plan: 5_000,
});

/** PURE: the limit for one chat tool call. */
export function chatToolTimeLimit(tool, { sideEffecting = false } = {}) {
  if (CHAT_TOOL_TIME_LIMITS_MS[tool]) return CHAT_TOOL_TIME_LIMITS_MS[tool];
  if (MODEL_BACKED_CHAT_TOOLS.includes(tool)) return CHAT_TOOL_FAMILY_LIMITS_MS.model;
  return sideEffecting ? CHAT_TOOL_FAMILY_LIMITS_MS.change : CHAT_TOOL_FAMILY_LIMITS_MS.read;
}

/** PURE: the tool result a time-out becomes (the shape the chat's tools return on failure). */
export function timeoutResult(error) {
  return { success: false, code: "timeout", error: String(error?.message || "The tool timed out.").slice(0, 300), timedOut: true };
}

/**
 * Run one chat tool call within its limit → the tool's result, or the
 * timeout result. Other errors are thrown as before (the loop's catch).
 */
export async function runWithinLimit(fn, tool, { sideEffecting = false, limitMs = null } = {}) {
  try {
    return await withToolTimeLimit(fn, limitMs ?? chatToolTimeLimit(tool, { sideEffecting }), tool);
  } catch (error) {
    if (error?.name === "ToolTimeout") return timeoutResult(error);
    throw error;
  }
}
