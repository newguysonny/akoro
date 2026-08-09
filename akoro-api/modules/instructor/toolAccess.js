/**
 * instructor/toolAccess.js — enforcement layer for purchased platform tools.
 *
 * Maps agent tool names → the catalog key (edu.platform_tools.key) an
 * instructor must have UNLOCKED (paid for) before the agent may use them.
 * Tools not listed in TOOL_GATES are ungated (always available).
 */

import db from "../../db.js";

// agent tool name → required catalog key (edu.platform_tools.key).
// Every instructor-facing agent tool is gated, so a NEW instructor agent has
// no tool commands until the matching item is unlocked in Tools & Assets.
// NOTE: only gate INSTRUCTOR tools here — student-side tools (quiz_me,
// explain_concept, create_study_plan, set_study_reminder, challenge_peer) are
// intentionally left ungated so learners keep them for free.
export const TOOL_GATES = {
  generate_quiz:      "quiz-generator",
  fetch_student_data: "student-data",
  send_reminder:      "send-reminder",
  schedule_session:   "schedule-session",
  export_report:      "export-report",
  // create_battle is retired — the tool inserted battles with no participants.
  // Its replacement, assign_battle, is deliberately NOT gated here: gating it
  // would take chat battle creation away from every instructor who has it
  // today, which is a pricing decision and not a side effect of deleting a
  // broken tool. The 'create-battle' catalog item is still listed and still
  // sells; nobody has bought it (0 unlocks), so nothing is owed to anyone.
  grade_submissions:  "grading",
  // Catalog-backed orchestrated tools
  lesson_plan_fill:     "lesson-plan",
  worksheet_fill:       "worksheets",
  report_writing:       "report-writing",
  exam_prep:            "exam-prep",
  attendance_rollcall:  "attendance",
  interactive_material: "interactive",
};

/**
 * Returns the Set of catalog keys an instructor has unlocked (access_granted).
 * Safe: returns an empty Set on any error so enforcement fails closed.
 */
export async function getUnlockedToolKeys(instructorId) {
  if (!instructorId) return new Set();
  try {
    const { data: owned } = await db
      .schema("edu").from("instructor_tool_access")
      .select("tool_id")
      .eq("instructor_id", instructorId)
      .eq("access_granted", true);

    const ids = (owned || []).map((r) => r.tool_id);
    if (!ids.length) return new Set();

    const { data: tools } = await db
      .schema("edu").from("platform_tools")
      .select("key")
      .in("id", ids);

    return new Set((tools || []).map((t) => t.key).filter(Boolean));
  } catch (e) {
    console.warn("[toolAccess] unlock lookup failed:", e.message);
    return new Set();
  }
}
