/**
 * modules/battle/worker.js  —  Akoro Battle BullMQ Worker
 * Adapted from piabam-battles:
 *   • SQLite db.get/run/all → Supabase JS client
 *   • Uses ioredis (already our standard)
 *   • global.io for Socket.io
 */

import { Worker, Queue } from "bullmq";
import Redis             from "ioredis";
import db                from "../../db.js";
import { bullRedisOptions } from "../../lib/redisOptions.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", bullRedisOptions);
redis.on("error", (err) => console.error("[battle-worker/redis]", err.message));

export const battleQueue = new Queue("battles", {
  connection: redis,
  defaultJobOptions: {
    attempts:         3,
    backoff:          { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 200 },
    removeOnFail:     { count: 500 },
  },
});

const worker = new Worker("battles", async (job) => {
  const { action, battleId } = job.data;
  switch (action) {
    case "start-battle":        return startBattle(battleId);
    case "advance-question":    return advanceQuestion(battleId, job.data.questionOrder);
    case "reveal-question":     return revealQuestion(battleId, job.data.questionOrder);
    case "end-battle":          return endBattle(battleId);
    case "expire-battle":       return expireBattle(battleId);
    case "refresh-leaderboard": return refreshLeaderboard(job.data.courseId, job.data.scope);
    default: throw new Error(`Unknown action: ${action}`);
  }
}, {
  connection:  redis,
  concurrency: 10,
  // Reduce idle Redis traffic on per-request-billed providers (Upstash):
  // block the poll longer and check for stalled jobs far less often.
  drainDelay:  60,                          // seconds the blocking poll waits when idle
  settings:    { stalledInterval: 300_000 }, // 5 min between stalled-job scans
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getIO = () => {
  if (!global.io) throw new Error("global.io not set");
  return global.io;
};

const now = () => new Date().toISOString();

async function appendLog(battleId, eventType, message, userId = null, agentName = null, agentEmoji = null, questionOrder = null, meta = null) {
  await db.from("battle_log").insert({
    battle_id: battleId, question_order: questionOrder, event_type: eventType,
    user_id: userId, agent_name: agentName, agent_emoji: agentEmoji,
    message, meta_json: meta ? JSON.stringify(meta) : null,
  });
  getIO().to(`battle:${battleId}`).emit("battle:log", {
    eventType, agentName, agentEmoji, message, meta: meta ?? null,
    timestamp: new Date().toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  });
}

function buildQuestionPayload(q) {
  return {
    questionId: q.id, questionOrder: q.question_order, questionText: q.question_text,
    options: JSON.parse(q.options_json), topic: q.topic,
    xpValue: q.xp_value, timeLimitMs: (q.time_limit_seconds || 15) * 1000,
  };
}

function computeXpDistribution(participants, pool) {
  const dist = {};
  if (!participants.length) return dist;
  if (participants.length === 1) { dist[participants[0].id] = pool; return dist; }
  dist[participants[0].id] = Math.round(pool * 0.60);
  if (participants.length >= 2) dist[participants[1].id] = Math.round(pool * 0.30);
  const remainder = pool - Object.values(dist).reduce((s, v) => s + v, 0);
  if (participants.length >= 3 && remainder > 0) {
    const share = Math.floor(remainder / (participants.length - 2));
    for (let i = 2; i < participants.length; i++) dist[participants[i].id] = share;
  }
  return dist;
}

async function creditXP(userId, agentId, amount, source, referenceId) {
  const { data: current } = await db.from("user_agents").select("total_xp").eq("id", agentId).single();
  const newTotal = (current?.total_xp ?? 0) + amount;
  await db.from("user_agents").update({ total_xp: newTotal }).eq("id", agentId);
  await db.from("xp_ledger").insert({ user_id: userId, agent_id: agentId, amount, source, reference_id: referenceId, running_total: newTotal });
}

// ─── start-battle ─────────────────────────────────────────────────────────────

async function startBattle(battleId) {
  const { data: battle } = await db.from("battles")
    .select("title, battle_type, status, created_by").eq("id", battleId).single();
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

  if (competing.length < 2) {
    await db.from("battles").update({ status: "cancelled" }).eq("id", battleId);
    if (battle.created_by) {
      // `content`, not `message` — the column is content, and PostgREST accepts
      // the insert regardless, so a wrong key here loses the notification in
      // silence rather than erroring.
      await db.from("notifications").insert({
        user_id: battle.created_by, type: "battle_cancelled",
        title:   `Battle cancelled: ${battle.title}`,
        content: competing.length
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
  await db.from("battles").update({
    status: "live", actual_start: now(), total_participants: participants.length,
  }).eq("id", battleId);

  for (const p of (participants ?? [])) {
    await db.from("battle_viewers").upsert({ battle_id: battleId, user_id: p.user_id, is_participant: true }, { onConflict: "battle_id,user_id" });
  }

  getIO().to(`battle:${battleId}`).emit("battle:started", {
    battleId, title: battle?.title, battleType: battle?.battle_type,
    participants: (participants ?? []).map((p) => ({ ...p, hp: 100, score: 0 })),
  });
  // `competing`, not `participants` — the teacher is in the room, not the fight.
  await appendLog(battleId, "battle_start", `⚔️ Battle started! ${competing.length} agents competing.`);

  const { data: firstQ } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", 1).single();
  if (!firstQ) return endBattle(battleId);

  getIO().to(`battle:${battleId}`).emit("battle:question", buildQuestionPayload(firstQ));
  await appendLog(battleId, "question_start", `━━━ Q1: ${firstQ.topic} ━━━`, null, null, null, 1, { questionOrder: 1, topic: firstQ.topic });

  await battleQueue.add("reveal-question",
    { action: "reveal-question", battleId, questionOrder: 1 },
    { delay: (firstQ.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q1` }
  );
}

// ─── reveal-question ──────────────────────────────────────────────────────────

async function revealQuestion(battleId, questionOrder) {
  const { data: q } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", questionOrder).single();
  if (!q) return endBattle(battleId);

  const { data: answers } = await db.from("battle_answers")
    .select(`*, battle_participants!inner(user_id, agent_id, id), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("question_id", q.id);

  const { data: participants } = await db.from("battle_participants").select("*").eq("battle_id", battleId);
  const options = JSON.parse(q.options_json);

  for (const p of (participants ?? [])) {
    const ans     = (answers ?? []).find((a) => a.battle_participants?.user_id === p.user_id);
    const correct = ans?.is_correct;

    if (!ans) {
      await db.from("battle_participants").update({ hp: Math.max(0, (p.hp ?? 100) - 8), wrong_answers: (p.wrong_answers ?? 0) + 1 }).eq("id", p.id);
      const { data: agent } = await db.from("user_agents").select("agent_name, agent_emoji").eq("id", p.agent_id).single();
      await appendLog(battleId, "answer_timeout", `⏰ ${agent?.agent_name} ran out of time!`, p.user_id, agent?.agent_name, agent?.agent_emoji, questionOrder);
    } else if (!correct) {
      await appendLog(battleId, "answer_wrong",
        `❌ ${ans.user_agents?.agent_name} answered wrong — chose ${options[ans.selected_index]}`,
        p.user_id, ans.user_agents?.agent_name, ans.user_agents?.agent_emoji, questionOrder);
    } else {
      const streakBonus = Math.floor((ans.streak_at_time ?? 0) * 5);
      const xpGained    = q.xp_value + streakBonus;
      await db.from("battle_participants").update({ score: (p.score ?? 0) + 1, correct_answers: (p.correct_answers ?? 0) + 1 }).eq("id", p.id);
      await creditXP(p.user_id, p.agent_id, xpGained, "battle_correct", battleId);
      await db.from("battle_answers").update({ xp_gained: xpGained }).eq("id", ans.id);
      await appendLog(battleId, "answer_correct",
        `✅ ${ans.user_agents?.agent_name} answered correctly — ${options[q.correct_answer_index]}`,
        p.user_id, ans.user_agents?.agent_name, ans.user_agents?.agent_emoji, questionOrder,
        { xpGained, streak: ans.streak_at_time, responseMs: ans.response_time_ms });
      if ((ans.streak_at_time ?? 0) >= 2) {
        await appendLog(battleId, "streak",
          `🔥 ${ans.user_agents?.agent_name} is on a ${ans.streak_at_time}× streak! +${streakBonus} bonus XP`,
          p.user_id, ans.user_agents?.agent_name, ans.user_agents?.agent_emoji, questionOrder,
          { streak: ans.streak_at_time, bonusXp: streakBonus });
      }
    }
  }

  // HP damage to wrong-answerers when opponents got it right
  const correctCount = (answers ?? []).filter((a) => a.is_correct).length;
  if (correctCount > 0) {
    for (const p of (participants ?? [])) {
      const ans = (answers ?? []).find((a) => a.battle_participants?.user_id === p.user_id);
      if (!ans?.is_correct) {
        await db.from("battle_participants").update({ hp: Math.max(0, (p.hp ?? 100) - 8) }).eq("id", p.id);
      }
    }
  }

  getIO().to(`battle:${battleId}`).emit("battle:reveal", {
    questionOrder, correctIndex: q.correct_answer_index, correctAnswer: options[q.correct_answer_index],
    answers: (answers ?? []).map((a) => ({
      userId: a.battle_participants?.user_id, agentName: a.user_agents?.agent_name,
      agentEmoji: a.user_agents?.agent_emoji, selectedIndex: a.selected_index,
      isCorrect: a.is_correct, responseTimeMs: a.response_time_ms, xpGained: a.xp_gained,
    })),
  });

  const { data: battleInfo } = await db.from("battles").select("total_questions").eq("id", battleId).single();
  const { count: aliveCount } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", battleId).gt("hp", 0);

  if (questionOrder >= (battleInfo?.total_questions ?? 0) || (aliveCount ?? 0) <= 1) {
    await battleQueue.add("end-battle", { action: "end-battle", battleId }, { delay: 3000 });
  } else {
    await advanceQuestion(battleId, questionOrder + 1);
  }
}

// ─── advance-question ─────────────────────────────────────────────────────────

async function advanceQuestion(battleId, questionOrder) {
  const { data: q } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", questionOrder).single();
  if (!q) return endBattle(battleId);

  getIO().to(`battle:${battleId}`).emit("battle:question", buildQuestionPayload(q));
  await appendLog(battleId, "question_start", `━━━ Q${questionOrder}: ${q.topic} ━━━`, null, null, null, questionOrder, { questionOrder, topic: q.topic });
  await battleQueue.add("reveal-question",
    { action: "reveal-question", battleId, questionOrder },
    { delay: (q.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q${questionOrder}` }
  );
}

// ─── end-battle ───────────────────────────────────────────────────────────────

async function endBattle(battleId) {
  const { data: current } = await db.from("battles").select("status").eq("id", battleId).single();
  if (current?.status === "completed") return;

  await db.from("battles").update({ status: "completed", actual_end: now() }).eq("id", battleId);

  const { data: battleInfo } = await db.from("battles").select("xp_prize, xp_pool, battle_type, course_id, actual_start, actual_end").eq("id", battleId).single();
  const durSecs = battleInfo?.actual_start && battleInfo?.actual_end
    ? Math.round((new Date(battleInfo.actual_end) - new Date(battleInfo.actual_start)) / 1000) : 0;

  await db.from("battles").update({
    duration_seconds: durSecs,
    peak_viewers: (await db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", battleId)).count ?? 0,
  }).eq("id", battleId);

  const { data: seats } = await db.from("battle_participants")
    .select(`*, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false }).order("hp", { ascending: false });

  // The teacher runs the battle, they are not in it. Their seat exists so the
  // battle has a host, and it carries a score of 0 like everyone else at the
  // start — which, with the tie broken by HP, ranked them FIRST and declared
  // the teacher the winner of their own class battle, with a share of the XP.
  // Nobody noticed while the scoreboard was invisible to them.
  const participants = (seats ?? []).filter((p) => p.role !== "teacher");

  const pool   = battleInfo?.battle_type === "classroom" ? battleInfo.xp_pool : battleInfo?.xp_prize;
  const xpDist = computeXpDistribution(participants ?? [], pool ?? 0);

  for (let i = 0; i < (participants ?? []).length; i++) {
    const p = participants[i];
    const xpEarned = xpDist[p.id] ?? 0;
    await db.from("battle_participants").update({ is_winner: i === 0, final_rank: i + 1, xp_earned: xpEarned }).eq("id", p.id);
    await creditXP(p.user_id, p.agent_id, xpEarned, "battle_win", battleId);
  }

  const winner   = participants?.[0];
  const runnerUp = participants?.[1];
  const mm = String(Math.floor(durSecs / 60)).padStart(2, "0");
  const ss = String(durSecs % 60).padStart(2, "0");

  await appendLog(battleId, "battle_end",
    `🏁 Battle complete! ${winner?.user_agents?.agent_name} wins ${winner?.score ?? 0}–${runnerUp?.score ?? 0}`,
    winner?.user_id, winner?.user_agents?.agent_name, winner?.user_agents?.agent_emoji, null,
    { finalScores: (participants ?? []).map((p, i) => ({ rank: i + 1, agentName: p.user_agents?.agent_name, score: p.score, xpEarned: xpDist[p.id] ?? 0 })) }
  );

  getIO().to(`battle:${battleId}`).emit("battle:over", {
    winner: { userId: winner?.user_id, agentName: winner?.user_agents?.agent_name, agentEmoji: winner?.user_agents?.agent_emoji, score: winner?.score, xpEarned: xpDist[winner?.id] },
    finalScores: (participants ?? []).map((p, i) => ({
      rank: i + 1, userId: p.user_id, agentName: p.user_agents?.agent_name,
      agentEmoji: p.user_agents?.agent_emoji, score: p.score, hp: p.hp, xpEarned: xpDist[p.id] ?? 0,
    })),
    durationSeconds: durSecs, durationFormatted: `${mm}:${ss}`,
  });

  await battleQueue.add("refresh-leaderboard", { action: "refresh-leaderboard", courseId: battleInfo?.course_id, scope: "classroom" }, { delay: 2000 });
}

// ─── expire-battle ────────────────────────────────────────────────────────────

async function expireBattle(battleId) {
  const { data } = await db.from("battles").update({ status: "expired" }).in("status", ["lobby", "scheduled"]).eq("id", battleId).select("id").single();
  if (data) {
    getIO().to(`battle:${battleId}`).emit("battle:log", { eventType: "system", message: "⏰ This battle expired before it could start.", timestamp: new Date().toLocaleTimeString() });
  }
}

// ─── refresh-leaderboard ──────────────────────────────────────────────────────

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

// ─── Worker events ────────────────────────────────────────────────────────────
worker.on("completed", (job) => console.log(`[battle-worker] ✅ ${job.data.action} battle=${job.data.battleId ?? ""}`));
worker.on("failed",    (job, err) => console.error(`[battle-worker] ❌ ${job?.data.action} failed:`, err.message));

export default worker;
