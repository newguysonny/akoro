/**
 * lib/agentActivity.js — what the learner's agent is doing RIGHT NOW.
 *
 * Background work (autonomy due-task reviews, scheduled follow-ups, agent
 * tool loops) emits a short human label — "Checking your schedule…",
 * "Creating a battle…" — to the user's socket room. The learner app's agent
 * header streams it live, then falls back to the static subtitle after a
 * quiet period. Events are best-effort: no socket, no payload, no throw —
 * a status line must never break the work it describes.
 */

// Friendly labels per background action. Anything unmapped stays quiet —
// silence reads as idle; a wrong label reads as a lie.
const TOOL_LABELS = {
  "prepare_activity":    "Preparing an activity draft…",
  "revise_activity_draft": "Revising an activity draft…",
  "list_my_classrooms":  "Checking your classes…",
  "get_my_school":       "Checking your school…",
  "list_school_subjects": "Checking your subjects…",
  "list_my_teachers":    "Checking your teachers…",
  "find_teacher":        "Looking up a teacher…",
  "get_my_learning_sessions": "Reading your learning sessions…",
  "create_task":         "Planning a task…",
  "create-battle":       "Creating a battle…",
  "generate-quiz":       "Generating quiz questions…",
  "fetch-student-data":  "Searching your study data…",
  "schedule-session":    "Checking the schedule…",
  "send-reminder":       "Sending a reminder…",
  "grade-submissions":   "Grading work…",
  "export-report":       "Preparing your report…",
};

/** Broadcast one activity label (null = back to idle) to the user's room. */
export function reportAgentActivity(userId, label) {
  const id = String(userId || "").trim();
  const text = label == null ? null : String(label).trim() || null;
  if (!id || !global.io?.to) return false;
  try {
    global.io.to(`user:${id}`).emit("agent:activity", { label: text, at: Date.now() });
    return true;
  } catch { /* a status line must never break the work it describes */ return false; }
}

/** Emit only when the tool has a friendly label — unmapped tools stay quiet. */
export function agentToolActivity(userId, tool) {
  const label = TOOL_LABELS[String(tool || "")];
  if (label) reportAgentActivity(userId, label);
  return Boolean(label);
}

/** The work finished — the header returns to its idle subtitle. */
export function clearAgentActivity(userId) {
  return reportAgentActivity(userId, null);
}
