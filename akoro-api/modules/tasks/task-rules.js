export const VALID_EXECUTORS = ["llm_prompt", "notify", "create_battle", "http_webhook"];
export const VALID_SCOPES     = ["global", "user", "school"];

// Learner tasks are plans owned and completed by the learner. They must never
// enter the generic task-runner, which can call arbitrary task executors. Their
// only automatic behaviour is the separate, opt-in, due-time Agent Chat.
export const LEARNER_ROLES = new Set(["student", "learner"]);
export const isLearnerTask = (req) => LEARNER_ROLES.has(String(req.user?.role || "").toLowerCase());

export const isPreciseDueAt = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
  && Number.isFinite(new Date(value).getTime());

/** PURE: the next due instant for a repeating to-do, always in the future. */
export function nextRecurrenceDue(prevDueAt, everySeconds, now = Date.now()) {
  const step = Math.max(60, Math.floor(everySeconds)) * 1000;
  let t = prevDueAt ? new Date(prevDueAt).getTime() : now;
  if (!Number.isFinite(t)) t = now;
  t += step;
  let guard = 0;
  while (t <= now && guard++ < 5000) t += step;
  return new Date(t);
}
