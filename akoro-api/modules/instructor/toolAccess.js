/**
 * instructor/toolAccess.js — enforcement layer for purchased platform tools.
 *
 * Maps agent tool names → the catalog key (edu.platform_tools.key) an
 * instructor must have UNLOCKED (paid for) before the agent may use them.
 * Tools not listed in TOOL_GATES are ungated (always available).
 */

import db from "../../db.js";

// agent tool name → required catalog key
export const TOOL_GATES = {
  grade_submissions: "grading",
  // Add future catalog-backed tools here, e.g.:
  //   lesson_plan_fill: "lesson-plan",
  //   worksheet_fill:   "worksheets",
  //   exam_prep:        "exam-prep",
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
