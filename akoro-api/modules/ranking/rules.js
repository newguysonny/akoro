/**
 * modules/ranking/rules.js — the XP award amounts and awardXP, extracted from
 * routes.js. Other modules award XP through the ranking index.
 */

import db from "../../db.js";

// ─── XP award amounts ─────────────────────────────────────────────────────────
// Centralised so they can be tuned without touching logic

export const XP = {
  LESSON_COMPLETE:   10,
  QUIZ_PASS:         20,
  QUIZ_PERFECT:      35,   // 100% score
  SESSION_ATTEND:    15,
  COURSE_COMPLETE:   50,
  AGENT_REPLY:       10,
  PEER_SESSION_HOST: 25,
};

// ─── XP transaction helper ────────────────────────────────────────────────────

/**
 * awardXP
 * Creates an xp_transactions record and updates user_agents.total_xp.
 * Called by other modules (course-content, live-sessions, agents) via import.
 */
export const awardXP = async ({ userId, courseId = null, classroomId = null, reason, amount, metadata = {}, subject = null }) => {
  try {
    // Subject powers the per-subject leaderboards. Callers that know it pass
    // it; for course XP we can always derive it, so the caller doesn't have to.
    let subj = subject || metadata?.subject || null;
    if (!subj && courseId) {
      const { data: c } = await db.from("courses").select("subject").eq("id", courseId).maybeSingle();
      subj = c?.subject || null;
    }

    await db.from("xp_transactions").insert({
      user_id:      userId,
      course_id:    courseId,
      classroom_id: classroomId,
      reason,
      amount,
      metadata,
      subject:      subj,
    });

    // Update agent XP
    const { error: xpErr } = await db.rpc("increment_agent_xp", { user_id_input: userId, xp_amount: amount });
    if (xpErr) {
      // Fallback if RPC not set up — read-modify-write the XP total.
      const { data: agentRow } = await db.from("user_agents")
        .select("total_xp").eq("user_id", userId).maybeSingle();
      if (agentRow) {
        await db.from("user_agents")
          .update({ total_xp: (agentRow.total_xp ?? 0) + amount })
          .eq("user_id", userId);
      }
    }
  } catch (e) {
    console.warn("[ranking] awardXP failed:", e.message);
  }
};
