/**
 * lib/toolAccess.js — enforcement layer for purchased platform tools.
 *
 * Maps agent tool names → the catalog key (edu.platform_tools.key) an
 * instructor must have UNLOCKED (paid for) before the agent may use them.
 * Tools not listed in TOOL_GATES are ungated (always available).
 */

import db from "../db.js";

// Every instructor agent tool is open to every instructor: nothing is gated any more
// (they used to need the matching catalogue item bought in Tools & Assets — generate_quiz,
// fetch_student_data, send_reminder, schedule_session, export_report, grading,
// lesson_plan_fill, worksheet_fill, report_writing, exam_prep, attendance_rollcall,
// interactive_material; see git history for the map). The enforcement points
// (tasks/tools/index.js, agent-tools/routes.js) read this map and simply find it empty.
export const TOOL_GATES = {};

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
