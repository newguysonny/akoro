/**
 * modules/self-study/drafts.js — AI-prepared activity drafts (human-in-the-loop).
 *
 * The instructor's agent files drafts from chat via the `prepare_activity`
 * tool. A draft is a PRIVATE proposal: nothing is assigned, nobody is
 * notified. `payload` stores the exact bench-shaped create body so the
 * approval step can replay it through the one shared `createAssignment`
 * path — same insert, same targets, same notifications and ding as the
 * activities workbench.
 *
 * The human is the only actor who can cross the line: the draft endpoints
 * are plain HTTP, called by the preview UI's Assign button. No chat tool
 * reaches this module's assign.
 *
 * Audience rule: the instructor states the audience in their prompt. If the
 * agent cannot say who the work is for, it must ASK — `prepare_activity`
 * rejects a draft with `audience_required` and the model requests
 * clarification instead of guessing.
 *
 * Phase 19 step 4: this is the entry surface; the behaviour lives in
 *   draft-rules.js     pure rules (types, windows, plan/history shapes)
 *   draft-store.js     Supabase queries (classrooms, TTL sweep, draft cap)
 *   draft-audience.js  audience resolution
 *   draft-plan.js      plan generation + background enrichment
 *   draft-model.js     the model calls and the auto-rubric hook
 *   draft-questions.js battle and review-battle questions
 *   draft-create.js    the prepare_activity engine
 *   draft-records.js   read/list/edit/discard
 *   draft-revise.js    conversational revision
 *   draft-history.js   restore one round
 *   draft-assign.js    the approval (replays the shared create path)
 *   draft-edits.js     version edits/retries, settings and rubrics
 */

export { DRAFT_TYPES, HISTORY_KEYS } from "./draft-rules.js";
export { classroomName, instructorClassrooms } from "./draft-store.js";
export { createActivityDraft } from "./draft-create.js";
export {
  discardActivityDraft,
  getActivityDraft,
  listActivityDrafts,
  updateActivityDraft,
} from "./draft-records.js";
export { prepareReviewQuestions } from "./draft-questions.js";
export { restoreDraftHistory } from "./draft-history.js";
export { reviseDraftPayload } from "./draft-revise.js";
export { assignActivityDraft } from "./draft-assign.js";
export {
  generateVersionRubric,
  retryDraftVersion,
  saveDraftVersion,
  saveVersionRubric,
  setAssignmentSettings,
} from "./draft-edits.js";
