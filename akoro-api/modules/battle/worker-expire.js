/**
 * battle/worker-expire.js — the invite deadline (expire-battle), and the
 * course leaderboard refresh a finished battle queues.
 */
import db from "../../db.js";
import { minPlayersFor } from "./entry.js";
import { startBattle } from "./worker-create.js";

/**
 * The invite window closed. Only a battle that never got going is expired —
 * the status filter means a live or finished battle is untouched, so this is an
 * accept deadline, not a time limit on play.
 *
 * The guard below is belt and braces. The start job is queued to fire slightly
 * BEFORE this one for exactly that reason, but if it were delayed, retried, or
 * lost, expiring a battle that a class had already accepted would throw away
 * real work. If there are enough players, start it instead.
 */
async function expireBattle(battleId) {
  const { data: battle } = await db.from("battles").select("status, battle_type, recurring_key").eq("id", battleId).maybeSingle();
  if (!battle || !["lobby", "scheduled"].includes(battle.status)) return;

  const { data: seats } = await db.from("battle_participants")
    .select("role, joined_at, declined_at").eq("battle_id", battleId);
  const players = (seats ?? []).filter((p) => p.role !== "teacher" && p.joined_at && !p.declined_at).length;
  // Enough said yes → run it with them (a review or daily battle needs only one).
  if (players >= minPlayersFor(battle)) return startBattle(battleId);

  const { data } = await db.from("battles").update({ status: "expired" })
    .in("status", ["lobby", "scheduled"]).eq("id", battleId).select("id").maybeSingle();
  if (data) {
    global.io?.to(`battle:${battleId}`).emit("battle:log", { eventType: "system", message: "This battle expired before it could start.", timestamp: new Date().toLocaleTimeString() });
  }
}

async function refreshLeaderboard(courseId, scope) {
  // Class battles have no course. Querying course_id = null would match nothing
  // useful and rewrite the course-scoped leaderboard with an empty set, so skip
  // — class standings are covered by the classroom/subject scopes elsewhere.
  if (!courseId) return;

  const { data: rows } = await db.from("battle_participants")
    .select(`user_id, is_winner, battle_id, battles!inner(course_id, status)`)
    .eq("battles.course_id", courseId).eq("battles.status", "completed");

  const grouped = {};
  for (const r of (rows ?? [])) {
    if (!grouped[r.user_id]) grouped[r.user_id] = { user_id: r.user_id, battles_won: 0, battles_played: 0, total_xp: 0 };
    grouped[r.user_id].battles_played++;
    if (r.is_winner) grouped[r.user_id].battles_won++;
  }

  const sorted = Object.values(grouped).sort((a, b) => b.total_xp - a.total_xp);
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    await db.from("xp_leaderboard").upsert({
      user_id:        r.user_id,
      scope:          "battle_course",
      scope_ref_id:   courseId,
      course_id:      null,
      classroom_id:   null,
      total_xp:       r.total_xp,
      rank:           i + 1,
      battles_won:    r.battles_won,
      battles_played: r.battles_played,
      win_rate:       r.battles_played > 0 ? Math.round((r.battles_won / r.battles_played) * 100) : 0,
      updated_at:     new Date().toISOString(),
    }, { onConflict: "user_id,scope,course_id,classroom_id" });
  }
  console.log(`[battle-worker] Leaderboard refreshed — course:${courseId} (${sorted.length} entries)`);
}

export { expireBattle, refreshLeaderboard };
