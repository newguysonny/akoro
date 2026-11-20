/**
 * battle/worker-create.js — the start-battle job: claim a waiting battle live,
 * drop the seats nobody took, broadcast Q1 and hand the rest to worker-start.
 */
import db from "../../db.js";
import { minPlayersFor } from "./entry.js";
import { prepareRuling, JUDGE } from "./judge.js";
import { buildQuestionPayload, getIO, now } from "./worker-rules.js";
import { appendLog, getBattleWorkerQueue } from "./worker-core.js";
import { scheduleAgentAnswers } from "./worker-start.js";
import { endBattle } from "./worker-end.js";

async function startBattle(battleId) {
  const { data: battle } = await db.from("battles")
    .select("title, battle_type, status, created_by, recurring_key").eq("id", battleId).single();
  // The invite window may have closed on a cancelled or already-finished
  // battle; starting one of those would resurrect it.
  if (!battle || !["lobby", "scheduled"].includes(battle.status)) return;

  const { data: seats } = await db.from("battle_participants")
    .select(`user_id, role, joined_at, declined_at, user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", battleId);

  // Only those who actually took their seat compete. A teacher's battle is now
  // an invitation, so at start time some of the invited may never have answered
  // — running them anyway would score learners on a battle they never agreed
  // to and never saw. They are dropped, not failed.
  const runners  = (seats ?? []).filter((p) => p.role === "teacher");
  const competing = (seats ?? []).filter((p) => p.role !== "teacher" && p.joined_at && !p.declined_at);

  // A REVIEW is one learner working through a paper — "not enough players" is
  // its normal state, not a failure. It needs one, and only one.
  // The daily battle runs for whoever turned up, even one agent: it is the
  // day's set, ranked across all its heats, not a duel.
  const minPlayers = minPlayersFor(battle);

  if (competing.length < minPlayers) {
    await db.from("battles").update({ status: "cancelled" }).eq("id", battleId);
    if (battle.created_by) {
      // `content`, not `message` — the column is content, and PostgREST accepts
      // the insert regardless, so a wrong key here loses the notification in
      // silence rather than erroring.
      await db.from("notifications").insert({
        user_id: battle.created_by, type: "battle_cancelled",
        title:   `Battle cancelled: ${battle.title}`,
        content: battle.battle_type === "review"
          ? "The learner did not accept the review before it expired."
          : competing.length
            ? "Only one learner accepted, so there was nobody to compete against."
            : "Nobody accepted the invitation before it expired.",
        related_id: battleId,
      });
    }
    // The battle is already cancelled and the teacher already told; a missing
    // socket must not throw here and have the job retried against a battle
    // that is no longer in a startable state.
    global.io?.to(`battle:${battleId}`).emit("battle:cancelled", { battleId, reason: "not_enough_players" });
    return;
  }

  // Clear out the seats nobody claimed so results, ranks and the XP split are
  // computed over the people who actually played.
  const dropped = (seats ?? []).filter(
    (p) => p.role !== "teacher" && !competing.includes(p));
  for (const p of dropped) {
    await db.from("battle_participants").delete().eq("battle_id", battleId).eq("user_id", p.user_id);
  }

  const participants = [...runners, ...competing];
  // Claim the start: only one run may flip a waiting battle live. Start jobs
  // can be queued more than once (at creation, on accept, by Start now); a
  // second run used to broadcast Q1 and schedule every agent's answers again.
  const { data: claimed } = await db.from("battles").update({
    status: "live", actual_start: now(), total_participants: participants.length,
  }).eq("id", battleId).in("status", ["lobby", "scheduled"]).select("id");
  if (!claimed?.length) return;

  for (const p of (participants ?? [])) {
    await db.from("battle_viewers").upsert({ battle_id: battleId, user_id: p.user_id, is_participant: true }, { onConflict: "battle_id,user_id" });
  }

  getIO().to(`battle:${battleId}`).emit("battle:started", {
    battleId, title: battle?.title, battleType: battle?.battle_type,
    participants: (participants ?? []).map((p) => ({ ...p, hp: 100, score: 0 })),
  });
  // `competing`, not `participants` — the teacher is in the room, not the fight.
  await appendLog(battleId, "battle_start",
    battle.battle_type === "review"
      ? `Study review started — ${competing.length} learner working through the questions.`
      : battle.battle_type === "check" && competing.length > 1
        ? `Class review started — ${competing.length} agents answer from what their learners taught them; ${JUDGE.name} judges.`
      : battle.battle_type === "check"
        ? `Agent Check started — ${JUDGE.name} judges, and your agent answers only from what you taught it.`
        : `Battle started! ${competing.length} agents competing.`);

  const { data: firstQ } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", 1).single();
  if (!firstQ) return endBattle(battleId);

  getIO().to(`battle:${battleId}`).emit("battle:question", buildQuestionPayload(firstQ));
  // Sergeant starts on the ruling now, so it is ready by the reveal (not in a review).
  if (battle.battle_type !== "review") prepareRuling(firstQ).catch(() => {});
  await appendLog(battleId, "question_start", `━━━ Q1: ${firstQ.topic} ━━━`, null, null, null, 1, { questionOrder: 1, topic: firstQ.topic });
  await scheduleAgentAnswers(battleId, firstQ);

  await getBattleWorkerQueue().add("reveal-question",
    { action: "reveal-question", battleId, questionOrder: 1 },
    { delay: (firstQ.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q1` }
  );
}

export { startBattle };
