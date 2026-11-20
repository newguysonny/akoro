/**
 * modules/self-study/draft-model.js — the model calls behind a draft and the
 * auto-rubric hook fired when a version's questions are ready.
 */

import db from "../../db.js";
import { nana } from "./createAssignment.js";
import { beginRubric, runMarkSchemeJob } from "./draftRubric.js";

/** The model call behind an assignment draft's questions, billed to its instructor. */
export const questionChat = (instructorId) => (messages, opts = {}) =>
  nana.generateAssignmentQuestions({ messages, ...opts, billing: { __userId: instructorId, __feature: "assignment_questions" } });

/** The model call behind an assignment's rubric, billed to its instructor. */
export const schemeChat = (instructorId) => (messages, opts = {}) =>
  nana.generateAssignmentQuestions({ messages, ...opts, billing: { __userId: instructorId, __feature: "assignment_markscheme" } });

/** When a version's questions are in and auto-grading is on, write its rubric next. */
export const autoRubric = (draftId, instructorId) => async (n) => {
  const { data } = await db.from("activity_drafts").select("status, payload").eq("id", draftId).maybeSingle();
  if (data?.status !== "draft" || !data.payload?.details?.ai_auto_grade) return;
  if (await beginRubric(draftId, n)) void runMarkSchemeJob(draftId, n, { chat: schemeChat(instructorId) });
};
