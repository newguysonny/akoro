/**
 * adaptive-learning/toolRecovery.js — what Agent Chat does after a tool call
 * fails (Grand Plan Phase 16, step 3). Pure; no db.
 *
 * Before telling the learner, in this order:
 *   1. a TEMPORARY failure (time-out, provider busy, network, "just now") is
 *      retried once, automatically — for tools that only read, and for a change
 *      only when the failure means it never ran (refused, timed out at the door);
 *   2. otherwise the observation names the documented alternative for that job,
 *      when there is one ("try search_my_study_knowledge instead");
 *   3. only then: tell the learner plainly what failed and offer a next step.
 */

const TEMPORARY = /\b(?:time(?:d)?[- ]?out|timeout|temporar(?:y|ily)|try again|just now|busy|unavailable|overloaded|rate.?limit|429|502|503|504|econnreset|socket hang up|network|fetch failed|stalled|not answering)\b/i;
// A change that never reached its backend is safe to send again; anything vaguer is not.
const NEVER_RAN = /\b(?:not (?:answering|available)|unavailable|503|502|504|econnrefused|fetch failed|time(?:d)?[- ]?out before)\b/i;

/**
 * The documented alternative for a tool's job: another tool that answers the
 * same need from a different source. Only read tools — a fallback never makes
 * a second, different change. Every name here must exist in the catalogue
 * (checked by the contract test).
 */
export const TOOL_FALLBACKS = Object.freeze({
  search_my_library: "search_my_study_knowledge",
  search_my_study_knowledge: "search_my_library",
  get_learning_overview: "check_progress",
  check_progress: "get_learning_overview",
  get_knowledge_map: "get_weak_topics",
  get_weak_topics: "get_knowledge_map",
  analyse_past_papers: "get_past_question_practice",
  get_running_work: "get_study_prep_session",
  list_tasks: "get_learner_context",
  list_my_goals: "get_learner_context",
  read_blog_post: "search_blog_posts",
  find_battles: "search_challenge_requests",
});

const errorText = (result) => {
  if (!result || typeof result !== "object") return "";
  return [result.error, result.message, result.code, result.reason, result.detail].filter((x) => typeof x === "string").join(" ").slice(0, 400);
};

/** PURE: did this result fail? (the shapes the chat's tools return) */
export function failed(result) {
  if (result == null) return true;
  if (typeof result !== "object") return false;
  return result.success === false || result.ok === false || (typeof result.error === "string" && result.error.length > 0);
}

/** PURE: retry this failure once, automatically? */
export function shouldRetry(tool, result, { sideEffecting = false } = {}) {
  if (!failed(result)) return false;
  const text = errorText(result);
  if (!TEMPORARY.test(text)) return false;
  return !sideEffecting || NEVER_RAN.test(text);
}

/**
 * PURE: the recovery hint added to a failed observation (after any retry).
 * → { retried, next } where `next` is what the model should do now.
 */
export function recoveryHint(tool, result, { retried = false, offered = [] } = {}) {
  if (!failed(result)) return null;
  const alt = TOOL_FALLBACKS[tool];
  const available = !alt || !offered.length || offered.includes(alt);
  if (alt && available) {
    return { retried, next: `${tool} failed${retried ? " twice" : ""}. Try ${alt} for the same need before telling the learner; if that fails too, say plainly what didn't work and offer a next step.` };
  }
  return { retried, next: `${tool} failed${retried ? " twice" : ""}. Tell the learner plainly what didn't work (no internal details), don't claim it worked, and offer a next step they can take.` };
}
