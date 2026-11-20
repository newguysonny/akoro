/**
 * modules/ranking/store.js — the leaderboard aggregation, extracted from
 * routes.js. The router schedules it; this file owns the rebuild.
 */

import db from "../../db.js";

const now = () => new Date().toISOString();

// ─── Leaderboard refresh ──────────────────────────────────────────────────────

/**
 * refreshLeaderboard
 * Aggregates xp_transactions into xp_leaderboard.
 * Runs every 15 minutes via cron + can be triggered manually.
 */
export const refreshLeaderboard = async () => {
  console.log("[ranking] 🔄 Refreshing leaderboard...");

  // ── Aggregate all XP ──────────────────────────────────────────────────────
  const { data: txns } = await db.from("xp_transactions").select("user_id, course_id, amount");

  const globalMap = {};   // user_id -> total xp (ALL sources, so global is complete)
  const courseMap = {};   // `${user}:${course}` -> { user_id, course_id, total_xp }
  for (const t of (txns ?? [])) {
    globalMap[t.user_id] = (globalMap[t.user_id] ?? 0) + (t.amount ?? 0);
    if (t.course_id) {
      const k = `${t.user_id}:${t.course_id}`;
      courseMap[k] = courseMap[k] ?? { user_id: t.user_id, course_id: t.course_id, total_xp: 0 };
      courseMap[k].total_xp += (t.amount ?? 0);
    }
  }

  // Classroom scope = each active member's total XP credited to their classroom
  // (transactions rarely carry classroom_id, so derive it from membership).
  const { data: members } = await db.from("classroom_students").select("user_id, classroom_id").eq("status", "active");
  const classroomMap = {};
  for (const m of (members ?? [])) {
    const k = `${m.user_id}:${m.classroom_id}`;
    classroomMap[k] = { user_id: m.user_id, classroom_id: m.classroom_id, total_xp: globalMap[m.user_id] ?? 0 };
  }

  // ── Build rows + compute rank within each scope group ─────────────────────
  const globalRows    = Object.entries(globalMap).map(([uid, xp]) => ({ user_id: uid, scope: "global",    course_id: null, classroom_id: null, scope_ref_id: null, total_xp: xp }));
  const courseRows    = Object.values(courseMap).map((r)          => ({ user_id: r.user_id, scope: "course",    course_id: r.course_id, classroom_id: null, scope_ref_id: r.course_id, total_xp: r.total_xp }));
  const classroomRows = Object.values(classroomMap).map((r)       => ({ user_id: r.user_id, scope: "classroom", course_id: null, classroom_id: r.classroom_id, scope_ref_id: r.classroom_id, total_xp: r.total_xp }));

  const assignRanks = (rows, groupOf) => {
    const groups = {};
    for (const r of rows) { const g = groupOf(r); (groups[g] ??= []).push(r); }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => b.total_xp - a.total_xp);
      g.forEach((r, i) => { r.rank = i + 1; r.updated_at = now(); });
    }
  };
  assignRanks(globalRows,    () => "g");
  assignRanks(courseRows,    (r) => r.course_id);
  assignRanks(classroomRows, (r) => r.classroom_id);

  const all = [...globalRows, ...courseRows, ...classroomRows];

  // ── Clean rebuild (avoids the NULL-in-UNIQUE upsert duplicate bug). Only the
  // app-managed scopes are rebuilt; battle_course is left to the battle worker.
  try {
    await db.from("xp_leaderboard").delete().in("scope", ["global", "course", "classroom"]);
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      if (chunk.length) await db.from("xp_leaderboard").insert(chunk);
    }
  } catch (e) { console.warn("[ranking] leaderboard rebuild error:", e.message); }

  console.log(`[ranking] ✅ Leaderboard refreshed  entries=${all.length}`);
};
