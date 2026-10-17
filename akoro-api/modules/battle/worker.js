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
import { redisConnectionOptions } from "../../lib/redisOptions.js";
import { traceRedis } from "../../lib/redisTrace.js";
import { thinkingTimeMs, autoPlayers } from "./agentPlayer.js";
import { embedQuestion, recall, recallStrength, answerFromRecall } from "./agentRecall.js";
import { updateKnowledgeConfidence, flagBattleReviewTopics } from "./knowledge.js";
import { emitAutonomyEvent } from "../autonomy/triggers.js";
import { workerJob } from "../../lib/workerLog.js";
import { coinsAvailable, schoolBillTo, InsufficientCoins, grantCoins } from "../../lib/coins.js";
import { REVIEW_REWARD_COINS, minPlayersFor, isMarkSheet } from "./entry.js";
import { prepareRuling, ruling, verdict, JUDGE } from "./judge.js";
import { HP_PER_MISS_DEFAULT } from "./hp.js";
import { guardWorker } from "../../lib/redisQuotaGuard.js";

// Agents already told they are out of coins this battle (one log line each, not one per question).
const toldNoCoins = new Set();
// Each question's embedding, computed once when it goes out and reused by every
// agent's answer job (the platform pays for it — once, not once per agent).
const questionVectors = new Map();
const rememberVector = (qid, v) => {
  if (!qid || !v) return;
  questionVectors.set(qid, v);
  if (questionVectors.size > 500) questionVectors.delete(questionVectors.keys().next().value);
};

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", redisConnectionOptions({ label: "battle-worker" }));
redis.on("error", (err) => console.error("[battle-worker/redis]", err.message));
traceRedis(redis, "battle-worker");   // local quota forensics — inert unless AKORO_REDIS_TRACE=true

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
    case "agent-answer":        return agentAnswer(battleId, job.data.questionOrder, job.data.participantId, job.data.thinkingMs);
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
  stalledInterval: 300_000,   // 5 min between stalled-job scans. Top level: BullMQ ignores it inside `settings`, which left every worker scanning every 30 s.
});
// Quota errors pause every worker instead of a 100 ms retry storm (lib/redisQuotaGuard.js).
guardWorker(worker, "battle worker");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Emitting is best-effort. It used to THROW when no socket was attached, which
 * failed the job — and BullMQ retries three times, so a battle re-broadcast
 * questions it had already asked and logged "Battle complete!" twice. That is
 * the duplicated Q4/Q5/Q6 and the second finish in the battle log.
 *
 * A missing socket means nobody is watching live. It must not change what the
 * battle DOES; the log and the database are the record either way.
 */
const getIO = () => global.io ?? { to: () => ({ emit: () => {} }) };

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

/** The answering agent, reached through the participant row it belongs to. */
const agentOf = (answer) => answer?.battle_participants?.user_agents ?? null;

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

  await battleQueue.add("reveal-question",
    { action: "reveal-question", battleId, questionOrder: 1 },
    { delay: (firstQ.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q1` }
  );
}

// ─── agent-answer ─────────────────────────────────────────────────────────────

/**
 * One agent answers one question, on its own schedule.
 *
 * Queued per participant when a question is broadcast, each with its own delay,
 * so the agents answer independently rather than in lockstep. Nothing used to
 * do this at all: a battle nobody was watching produced ten questions of
 * "⏰ ran out of time" and a 0–0 result.
 */
async function agentAnswer(battleId, questionOrder, participantId, thinkingMs = null) {
  const { data: battle } = await db.from("battles").select("status, battle_type").eq("id", battleId).maybeSingle();
  if (battle?.status !== "live") return;                       // ended, or ended early
  // An Agent Check (D45) was paid for up front by Study Prep — one charge per
  // check (§7.12.2) — so its answers are the platform's, not billed again.
  const prepaid = battle.battle_type === "check";

  const { data: q } = await db.from("battle_questions")
    .select("*").eq("battle_id", battleId).eq("question_order", questionOrder).maybeSingle();
  if (!q) return;

  const { data: p } = await db.from("battle_participants")
    .select("*").eq("id", participantId).maybeSingle();
  if (!p) return;                                              // dropped before the start
  // No HP, no answer: a knocked-out agent watches the rest as a spectator.
  if ((p.hp ?? 100) <= 0) return;

  // Already answered — by the human at the keyboard, or by a retry of this very
  // job. Either way there is nothing to add.
  const { data: already } = await db.from("battle_answers")
    .select("id").eq("participant_id", p.id).eq("question_id", q.id).maybeSingle();
  if (already) return;

  const options = JSON.parse(q.options_json);

  // To answer, an agent needs three things: HP (checked above), token credit
  // (its learner pays for its answers), and knowledge (its learner's notes must
  // cover the question). Missing any of them it gives NO answer — never a
  // guess — which the reveal marks wrong, with no XP and the usual HP loss.
  //
  // What the learner taught this agent about this question — nothing else:
  // the question is embedded, the learner's own notes are searched, and the
  // model is shown ONLY those notes. A correct answer therefore means their
  // notes contained the answer.
  const billTo = prepaid ? null : await schoolBillTo(p.user_id).catch(() => null);
  const wallet = prepaid ? { ok: true } : await coinsAvailable({ userId: p.user_id, billTo, min: 1 }).catch(() => ({ ok: true }));
  let picked = null, basis = "unknown", cited = null;
  let broke = !wallet.ok;
  if (!broke) {
    const embedding = questionVectors.get(q.id) ?? await embedQuestion(`${q.topic ? q.topic + ": " : ""}${q.question_text}`);
    const notes = await recall({
      studentId: p.user_id, embedding, topic: q.topic,
      // The question drives the lexical half of the search, and the subject
      // narrows it — a Mathematics question has no business retrieving a Social
      // Studies note, however close the vectors happen to sit.
      queryText: q.question_text, subject: q.subject,
    });
    try {
      const ans = await answerFromRecall({
        question: q.question_text, options, notes, userId: p.user_id, ...(prepaid ? { payer: "platform" } : {}),
      });
      basis = ans.basis; cited = ans.cited;
      picked = ans.index;
    } catch (e) {
      // A model failure is not knowledge the learner lacks, so it must not be
      // recorded as one — but the question still has to resolve or the battle
      // stalls on it.
      if (e instanceof InsufficientCoins) broke = true;
      else console.warn("[battle-worker] recall answer failed:", e.message);
      picked = null;
    }
  }
  if (broke || picked == null) {
    // No answer. Say why, once per question — the reveal reads this and marks
    // it wrong rather than "ran out of time".
    const { data: ag } = await db.from("user_agents").select("agent_name, agent_emoji").eq("id", p.agent_id).maybeSingle();
    const name = ag?.agent_name || "An agent";
    const k = `${battleId}:${p.id}`;
    const msg = broke
      ? (toldNoCoins.has(k) ? `${name} has no token credit — no answer` : `${name} is out of token credit — it can't answer until its learner tops up`)
      : `${name} has nothing in its notes on this — no answer`;
    if (broke) toldNoCoins.add(k);
    await appendLog(battleId, "no_answer", msg, p.user_id, ag?.agent_name, ag?.agent_emoji, questionOrder, { reason: broke ? "no_tokens" : "no_knowledge" });
    // Not knowing is something the learner is modelled as not knowing; no credit is not.
    if (!broke) {
      const { data: bT } = await db.from("battles").select("topic, title, subject").eq("id", battleId).maybeSingle();
      const head = bT?.topic || bT?.title || q.subject || "General";
      await updateKnowledgeConfidence(p.user_id, head, q.subject ?? bT?.subject, false, q.topic && q.topic !== head ? q.topic : "")
        .catch(() => {});
    }
    return;
  }

  // Too late? Recall and the answer take time; if the question has been
  // revealed meanwhile, this answer doesn't count — the reveal already marked
  // the miss and took the HP. (Counting it afterwards scored a point the
  // reveal had already called wrong.)
  const { data: still } = await db.from("battle_questions").select("revealed_at").eq("id", q.id).maybeSingle();
  if (still?.revealed_at) return;

  const isCorrect   = picked === q.correct_answer_index;
  const newStreak   = isCorrect ? (p.current_streak ?? 0) + 1 : 0;
  const streakBonus = isCorrect ? Math.floor(newStreak * 5) : 0;

  const { error: answerErr } = await db.from("battle_answers").insert({
    battle_id: battleId, participant_id: p.id, question_id: q.id,
    selected_index: picked, is_correct: isCorrect,
    // The thinking time this agent was given, carried on the job — battle_questions
    // has no "shown at" column, so it is the only true measure of who was quicker.
    response_time_ms: thinkingMs ?? null,
    xp_gained: isCorrect ? q.xp_value + streakBonus : 0,
    streak_at_time: newStreak,
    // Whether this came from the learner's notes or was a guess. Without it a
    // right answer from memory and a lucky guess are the same row, and the
    // whole point of answering from the knowledge bank is that they are not.
    answer_basis: basis,
    recalled_topic: cited,
  });
  // Loudly. An unchecked insert here is how a whole battle silently scores 0–0:
  // every agent "answers", nothing is written, and the log fills with "ran out
  // of time" for agents that did not. Two inserts in this subsystem have
  // already failed for months behind a swallowed error.
  if (answerErr) {
    console.error("[battle-worker] ANSWER NOT RECORDED:", answerErr.message);
    return;
  }

  // Streaks only. The correct/wrong TALLY belongs to revealQuestion, which sees
  // the whole question at once and is the only place that can count a
  // no-answer. Counting here as well double-counted every answer — a 6-question
  // review reported 7 correct — and that error fed the XP share and the mark
  // sheet. It was invisible until answers started being visible to the reveal.
  await db.from("battle_participants").update({
    current_streak: newStreak,
    max_streak:     Math.max(p.max_streak ?? 0, newStreak),
  }).eq("id", p.id);

  // Feed the result back into what the learner is modelled as knowing.
  //
  // This used to happen in the HTTP answer route, which no longer exists. It
  // has to happen HERE or the loop is open: agent accuracy is read from the
  // same per-topic confidence, so with nothing writing to it every agent would
  // be frozen at whatever its owner knew the day this shipped, and no battle
  // would teach anyone anything.
  // topic = what the BATTLE was about, subtopic = what this QUESTION was about.
  // A six-question battle on "Family" now leaves one topic with six subtopics
  // under it, instead of six unrelated top-level topics that nothing could roll
  // up or compare.
  const { data: bTopic } = await db.from("battles").select("topic, title, subject").eq("id", battleId).maybeSingle();
  const headline = bTopic?.topic || bTopic?.title || q.subject || "General";
  await updateKnowledgeConfidence(
    p.user_id, headline, q.subject ?? bTopic?.subject, isCorrect,
    // Only when it says something the topic does not — a question whose topic
    // IS the battle's topic has no subtopic to record.
    q.topic && q.topic !== headline ? q.topic : "")
    .catch((e) => console.warn("[battle-worker] knowledge update failed:", e?.message ?? e));

  // Push the running scoreboard so anyone watching sees it move as they answer,
  // rather than everything jumping at the reveal.
  const { data: rows } = await db.from("battle_participants")
    .select(`user_id, role, score, hp, current_streak, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false });
  global.io?.to(`battle:${battleId}`).emit("battle:state", {
    questionOrder,
    participants: (rows ?? []).map((r) => ({
      userId: r.user_id, role: r.role, agentName: r.user_agents?.agent_name, agentEmoji: r.user_agents?.agent_emoji,
      score: r.score, hp: r.hp, streak: r.current_streak,
    })),
  });
}

/**
 * Queue one answer per agent for the question just broadcast.
 *
 * jobId is per battle/question/participant, so a retried or duplicated
 * broadcast cannot make an agent answer twice.
 */
async function scheduleAgentAnswers(battleId, q) {
  const players = await autoPlayers(battleId);
  // One embedding for the question, shared by every agent searching against it.
  // Per agent it would be the same vector computed N times and billed N times.
  const embedding = await embedQuestion(`${q.topic ? q.topic + ": " : ""}${q.question_text}`);
  rememberVector(q.id, embedding);
  for (const p of players) {
    // Pacing only. An agent with notes on the topic answers sooner, so the log
    // still reads like a race — but what it ANSWERS is decided later, by
    // reading the notes, not by this number.
    const notes = await recall({
      studentId: p.user_id, embedding, topic: q.topic,
      queryText: q.question_text, subject: q.subject, limit: 3,
    });
    const thinkingMs = thinkingTimeMs(recallStrength(notes), q.time_limit_seconds);
    await battleQueue.add("agent-answer",
      { action: "agent-answer", battleId, questionOrder: q.question_order, participantId: p.id, thinkingMs },
      {
        delay: thinkingMs,
        jobId: `answer-${battleId}-q${q.question_order}-${p.id}`,
      });
  }
}

// ─── reveal-question ──────────────────────────────────────────────────────────

async function revealQuestion(battleId, questionOrder) {
  // A finished battle keeps no scores. Reveals queued for questions that never
  // got asked still fired after the battle ended — re-tallying answers on top
  // of the final settle (a 6-question review reported 7 correct) and printing
  // "⏰ ran out of time" under "🏁 Battle complete!" in the log.
  const { data: liveCheck } = await db.from("battles").select("status").eq("id", battleId).maybeSingle();
  if (liveCheck?.status !== "live") return;

  const { data: q0 } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", questionOrder).single();
  if (!q0) return endBattle(battleId);
  // Claim the reveal: once, however often the job is retried or queued, and
  // from this moment no late answer is accepted for the question.
  const { data: claimedQ } = await db.from("battle_questions").update({ revealed_at: now() })
    .eq("id", q0.id).is("revealed_at", null).select("*");
  if (!claimedQ?.length) return;
  const q = claimedQ[0];

  // The agent has to be reached THROUGH the participant. battle_answers has no
  // agent_id, so embedding user_agents directly asked PostgREST for a foreign
  // key that does not exist — it answered PGRST200 and the client turned that
  // into `answers = null`. Every answer was therefore invisible here: scores
  // stayed 0, and every learner was logged as having run out of time even when
  // they had answered. Nothing exposed it while no answer was ever recorded.
  const { data: answers, error: answersErr } = await db.from("battle_answers")
    .select(`*, battle_participants!inner(user_id, agent_id, id, user_agents(agent_name, agent_emoji, agent_color))`)
    .eq("question_id", q.id);
  if (answersErr) console.error("[battle-worker] could not read answers:", answersErr.message);

  const { data: participants } = await db.from("battle_participants").select("*").eq("battle_id", battleId);
  const options = JSON.parse(q.options_json);

  const { data: btype } = await db.from("battles").select("battle_type, hp_per_miss").eq("id", battleId).maybeSingle();
  const isReviewBattle = isMarkSheet(btype?.battle_type);   // a review or an Agent Check: no HP, no XP race
  const judgeRules = btype?.battle_type !== "review";       // Sergeant rules in every contest and every Agent Check
  // What a miss costs: the creator set it, and invitees saw it before accepting.
  const hpPerMiss = btype?.hp_per_miss ?? HP_PER_MISS_DEFAULT;

  // The teacher hosts the battle. Their agent used to appear in the commentary
  // — "⏰ Agent demo_teacher1 ran out of time!" on every question — and be
  // scored alongside the learners in a battle they were only refereeing.
  // Only agents with HP are still playing; a knocked-out agent is a spectator.
  const players = (participants ?? []).filter((p) => p.role !== "teacher" && (isReviewBattle || (p.hp ?? 100) > 0));
  // Agents that gave no answer this question, and why (logged when they passed).
  const { data: passLog } = await db.from("battle_log").select("user_id").eq("battle_id", battleId)
    .eq("question_order", questionOrder).eq("event_type", "no_answer");
  const passed = new Set((passLog ?? []).map((r) => r.user_id));

  for (const p of players) {
    const ans     = (answers ?? []).find((a) => a.battle_participants?.user_id === p.user_id);
    const correct = ans?.is_correct;
    // Where the answer came from. This is the loop the whole feature exists for:
    // a learner watching their agent guess on a topic learns exactly what to go
    // and teach it, and a right answer that says which note carried it is worth
    // far more than a bare tick.
    const guessed = ans?.answer_basis === "unknown";
    const from    = ans?.recalled_topic ? ` — from my notes on ${ans.recalled_topic}` : "";

    if (!ans) {
      // A missed question still counts as wrong on the mark sheet; only the HP
      // loss is a contest mechanic, so a review keeps the count and drops the
      // damage. (isReviewBattle is read once, above the loop.)
      // A miss breaks the streak, however the miss happened.
      await db.from("battle_participants").update({
        wrong_answers: (p.wrong_answers ?? 0) + 1, current_streak: 0,
      }).eq("id", p.id);
      if (!passed.has(p.user_id)) {   // a pass was already explained when it happened
        const { data: agent } = await db.from("user_agents").select("agent_name, agent_emoji").eq("id", p.agent_id).single();
        await appendLog(battleId, "answer_timeout", `${agent?.agent_name} ran out of time!`, p.user_id, agent?.agent_name, agent?.agent_emoji, questionOrder);
      }
    } else if (!correct) {
      // Counted here, like a no-answer — the reveal is the one tally of misses.
      await db.from("battle_participants").update({ wrong_answers: (p.wrong_answers ?? 0) + 1 }).eq("id", p.id);
      await appendLog(battleId, "answer_wrong",
        guessed
          ? `${agentOf(ans)?.agent_name} had nothing on this — guessed ${options[ans.selected_index]}`
          : `${agentOf(ans)?.agent_name} answered wrong — chose ${options[ans.selected_index]}${from}`,
        p.user_id, agentOf(ans)?.agent_name, agentOf(ans)?.agent_emoji, questionOrder);
    } else {
      // A review pays once, at the end (pool × share of the paper) — no XP per
      // question. A battle pays per right answer as it goes, plus the pool.
      const streakBonus = isReviewBattle ? 0 : Math.floor((ans.streak_at_time ?? 0) * 5);
      const xpGained    = isReviewBattle ? 0 : q.xp_value + streakBonus;
      await db.from("battle_participants").update({ score: (p.score ?? 0) + 1, correct_answers: (p.correct_answers ?? 0) + 1 }).eq("id", p.id);
      if (xpGained > 0) await creditXP(p.user_id, p.agent_id, xpGained, "battle_correct", battleId);
      await db.from("battle_answers").update({ xp_gained: xpGained }).eq("id", ans.id);
      await appendLog(battleId, "answer_correct",
        guessed
          ? `${agentOf(ans)?.agent_name} guessed ${options[q.correct_answer_index]} — and got lucky`
          : `${agentOf(ans)?.agent_name} answered correctly — ${options[q.correct_answer_index]}${from}`,
        p.user_id, agentOf(ans)?.agent_name, agentOf(ans)?.agent_emoji, questionOrder,
        { xpGained, streak: ans.streak_at_time, responseMs: ans.response_time_ms });
      if (!isReviewBattle && (ans.streak_at_time ?? 0) >= 2) {
        await appendLog(battleId, "streak",
          `${agentOf(ans)?.agent_name} is on a ${ans.streak_at_time}× streak! +${streakBonus} bonus XP`,
          p.user_id, agentOf(ans)?.agent_name, agentOf(ans)?.agent_emoji, questionOrder,
          { streak: ans.streak_at_time, bonusXp: streakBonus });
      }
    }
  }

  // HP: every question an agent didn't get right — a wrong answer, or no
  // answer at all — costs the battle's hp_per_miss, whatever the others did.
  // One rule, set by the creator, so a learner knows the cost before they
  // accept. A review has no HP to lose.
  if (!isReviewBattle && hpPerMiss > 0) {
    for (const p of players) {
      const ans = (answers ?? []).find((a) => a.battle_participants?.user_id === p.user_id);
      if (!ans?.is_correct) {
        await db.from("battle_participants").update({ hp: Math.max(0, (p.hp ?? 100) - hpPerMiss) }).eq("id", p.id);
      }
    }
  }

  // Sergeant's ruling: the key (marking is never a model's call) and why.
  const judged = judgeRules ? await ruling(q).catch(() => null) : null;
  if (judged) await appendLog(battleId, "judge_ruling", judged.text, null, JUDGE.name, null, questionOrder, { why: judged.why });

  getIO().to(`battle:${battleId}`).emit("battle:reveal", {
    questionOrder, correctIndex: q.correct_answer_index, correctAnswer: options[q.correct_answer_index],
    judge: judged,
    answers: (answers ?? []).map((a) => ({
      userId: a.battle_participants?.user_id, agentName: agentOf(a)?.agent_name,
      agentEmoji: agentOf(a)?.agent_emoji, selectedIndex: a.selected_index,
      isCorrect: a.is_correct, responseTimeMs: a.response_time_ms, xpGained: a.xp_gained,
    })),
  });

  const { data: battleInfo } = await db.from("battles").select("total_questions").eq("id", battleId).single();

  // Who just ran out of HP: from here they watch, unranked.
  let stillIn = players.length;
  if (!isReviewBattle) {
    const { data: after } = await db.from("battle_participants").select("id, user_id, hp, agent_id, role").eq("battle_id", battleId);
    stillIn = 0;
    for (const a of (after ?? [])) {
      if (a.role === "teacher") continue;
      if ((a.hp ?? 100) > 0) { stillIn++; continue; }
      if (players.some((p) => p.id === a.id)) {
        const { data: ag } = await db.from("user_agents").select("agent_name, agent_emoji").eq("id", a.agent_id).maybeSingle();
        await appendLog(battleId, "knocked_out", `${ag?.agent_name || "An agent"} is out of HP — it watches the rest as a spectator`, a.user_id, ag?.agent_name, ag?.agent_emoji, questionOrder);
      }
    }
  }

  // The scoreboard as the reveal left it — score and HP only change here, so
  // without this the arena lagged until its next poll.
  const { data: board } = await db.from("battle_participants")
    .select(`user_id, role, score, hp, current_streak, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false });
  global.io?.to(`battle:${battleId}`).emit("battle:state", {
    questionOrder,
    participants: (board ?? []).map((r) => ({
      userId: r.user_id, role: r.role, agentName: r.user_agents?.agent_name, agentEmoji: r.user_agents?.agent_emoji,
      score: r.score, hp: r.hp, streak: r.current_streak,
    })),
  });

  // Every question is played while anyone still has HP to play it. A battle
  // doesn't end because one agent is left standing — only after the last
  // question, or when nobody is left who can answer.
  if (questionOrder >= (battleInfo?.total_questions ?? 0) || stillIn === 0) {
    await battleQueue.add("end-battle", { action: "end-battle", battleId }, { delay: 3000 });
  } else {
    await advanceQuestion(battleId, questionOrder + 1);
  }
}

// ─── advance-question ─────────────────────────────────────────────────────────

async function advanceQuestion(battleId, questionOrder) {
  const { data: liveCheck } = await db.from("battles").select("status, battle_type").eq("id", battleId).maybeSingle();
  if (liveCheck?.status !== "live") return;   // ended early — ask nothing more

  const { data: q } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", questionOrder).single();
  if (!q) return endBattle(battleId);

  getIO().to(`battle:${battleId}`).emit("battle:question", buildQuestionPayload(q));
  if (liveCheck.battle_type !== "review") prepareRuling(q).catch(() => {});
  await appendLog(battleId, "question_start", `━━━ Q${questionOrder}: ${q.topic} ━━━`, null, null, null, questionOrder, { questionOrder, topic: q.topic });
  await scheduleAgentAnswers(battleId, q);
  await battleQueue.add("reveal-question",
    { action: "reveal-question", battleId, questionOrder },
    { delay: (q.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q${questionOrder}` }
  );
}

// ─── end-battle ───────────────────────────────────────────────────────────────

async function endBattle(battleId) {
  // Claim the end: only a LIVE battle ends, and only once. "End now" and the
  // last reveal's queued end could both pass a read-then-write check and pay
  // the XP pool (and a review's coins) twice; and ending a battle that never
  // started ranked and paid invitees who had never accepted.
  const { data: ended } = await db.from("battles").update({ status: "completed", actual_end: now() })
    .eq("id", battleId).eq("status", "live").select("id");
  if (!ended?.length) return;

  const { data: battleInfo } = await db.from("battles").select("xp_prize, xp_pool, battle_type, course_id, actual_start, actual_end, total_questions").eq("id", battleId).single();
  const durSecs = battleInfo?.actual_start && battleInfo?.actual_end
    ? Math.round((new Date(battleInfo.actual_end) - new Date(battleInfo.actual_start)) / 1000) : 0;

  await db.from("battles").update({
    duration_seconds: durSecs,
    peak_viewers: (await db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", battleId)).count ?? 0,
  }).eq("id", battleId);

  // ── Settle the scores from the ANSWERS, not the running counters ─────────
  // The counters are maintained by revealQuestion, one question at a time. End
  // a battle early — the teacher's "End now", or the last question ending it —
  // and the reveals still queued never run, so those answers are never counted:
  // a learner who answered 4 correctly was recorded with 3, and the XP and mark
  // sheet followed the wrong number. battle_answers is the record of what was
  // actually answered, so the final tally comes from there.
  const { data: settle } = await db.from("battle_answers")
    .select("participant_id, question_id, is_correct").eq("battle_id", battleId);
  const { data: revealedQs } = await db.from("battle_questions").select("id").eq("battle_id", battleId).not("revealed_at", "is", null);
  const revealed = new Set((revealedQs ?? []).map((r) => r.id));
  const tally = new Map();
  for (const a of (settle ?? [])) {
    const t = tally.get(a.participant_id) ?? { correct: 0, unrevealedWrong: 0 };
    if (a.is_correct) t.correct++;
    else if (!revealed.has(a.question_id)) t.unrevealedWrong++;   // the reveal already counted the rest
    tally.set(a.participant_id, t);
  }
  const { data: preSeats } = await db.from("battle_participants")
    .select("id, role, wrong_answers").eq("battle_id", battleId);
  for (const p of (preSeats ?? [])) {
    if (p.role === "teacher") continue;
    const t = tally.get(p.id) ?? { correct: 0, unrevealedWrong: 0 };
    // Misses: every one the reveals counted (wrong answers AND no answers —
    // no notes, no credit, out of time), plus wrong answers on a question
    // "End now" cut off before its reveal.
    await db.from("battle_participants")
      .update({ score: t.correct, correct_answers: t.correct, wrong_answers: (p.wrong_answers ?? 0) + t.unrevealedWrong })
      .eq("id", p.id);
  }

  const { data: seats } = await db.from("battle_participants")
    .select(`*, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false }).order("hp", { ascending: false });

  // The teacher runs the battle, they are not in it. Their seat exists so the
  // battle has a host, and it carries a score of 0 like everyone else at the
  // start — which, with the tie broken by HP, ranked them FIRST and declared
  // the teacher the winner of their own class battle, with a share of the XP.
  // Nobody noticed while the scoreboard was invisible to them.
  const participants = (seats ?? []).filter((p) => p.role !== "teacher");

  // A REVIEW has no OPPONENT, so nobody beat anybody — is_winner stays false.
  // But the work is real and it counts: the learner earns from the same pool,
  // scaled by how much of the paper they actually got right, and that XP flows
  // to the leaderboard exactly as a battle's does. Paying a flat prize for
  // turning up would make a review the cheapest XP on the platform; paying
  // nothing would make it the only work that does not count.
  const isReview = isMarkSheet(battleInfo?.battle_type);
  // An Agent Check (D45) is Study Prep's practice: no XP, no reward coins —
  // Study Prep scores it and tells the learner in chat.
  const isCheck = battleInfo?.battle_type === "check";
  // A TEAM battle (2v2): the team with more correct answers wins; every
  // member of it is a winner. Ties share the result.
  const isTeam = battleInfo?.battle_type === "team";
  const teamTotals = {};
  // A knocked-out member's points stop counting for the team — they are out.
  // Both teams are on the board even if one has nobody left (it scores 0).
  if (isTeam) {
    for (const p of participants) teamTotals[p.team || "A"] ??= 0;
    for (const p of participants) if ((p.hp ?? 100) > 0) teamTotals[p.team || "A"] += (p.score || 0);
  }
  const winTeam = isTeam ? (Object.entries(teamTotals).sort((a, b) => b[1] - a[1])[0] || [null])[0] : null;
  const teamTie = isTeam && new Set(Object.values(teamTotals)).size === 1;

  // No HP, no ranking: an agent knocked out watched the rest as a spectator, so
  // it is unranked, wins nothing and takes no share of the pool. (The XP it
  // earned for right answers before that stays — it was earned.) A review has
  // no HP to lose.
  const alive  = (p) => isReview || (p.hp ?? 100) > 0;
  const ranked = participants.filter(alive);
  const rankOf = new Map(ranked.map((p, i) => [p.id, i]));

  const pool   = battleInfo?.battle_type === "classroom" ? battleInfo.xp_pool
               : battleInfo?.xp_prize;
  const xpDist = isReview ? {}
    : isTeam ? Object.fromEntries(ranked.map((p) => [p.id, teamTie ? Math.round((battleInfo?.xp_prize ?? 0) * 0.5)
      : (p.team || "A") === winTeam ? (battleInfo?.xp_prize ?? 0) : Math.round((battleInfo?.xp_prize ?? 0) * 0.2)]))
    : computeXpDistribution(ranked, pool ?? 0);

  const earnedXp = new Map();
  for (let i = 0; i < (participants ?? []).length; i++) {
    const p = participants[i];
    const r = rankOf.get(p.id);
    const share = (p.correct_answers ?? 0) / Math.max(1, battleInfo?.total_questions ?? 0);
    const xpEarned = isCheck ? 0 : isReview
      ? Math.round((pool ?? 0) * Math.min(1, share))
      : (xpDist[p.id] ?? 0);
    earnedXp.set(p.id, xpEarned);

    await db.from("battle_participants").update({
      // A rank of 1 in a field of one is not a boast, but it IS what every
      // "my battles" list and leaderboard join expects to find — leaving it
      // null kept reviews out of the learner's own history.
      is_winner:  r == null || isReview ? false : isTeam ? (!teamTie && (p.team || "A") === winTeam) : r === 0,
      final_rank: r == null ? null : isTeam ? ((p.team || "A") === winTeam || teamTie ? 1 : 2) : r + 1,
      xp_earned:  xpEarned,
    }).eq("id", p.id);
    if (xpEarned > 0) {
      await creditXP(p.user_id, p.agent_id, xpEarned, isReview ? "study_review" : "battle_win", battleId);
    }
  }

  // A review is a check of knowledge, not a contest: everyone who took part
  // gets a free coin from the platform for doing it.
  if (isReview && !isCheck && REVIEW_REWARD_COINS > 0) {
    for (const p of participants) {
      const gave = await grantCoins({ userId: p.user_id, coins: REVIEW_REWARD_COINS, feature: "review_participation", ref: battleId }).catch(() => null);
      if (gave != null) {
        await appendLog(battleId, "review_reward", `${p.user_agents?.agent_name || "Your agent"} earned ${REVIEW_REWARD_COINS} free coin${REVIEW_REWARD_COINS === 1 ? "" : "s"} for taking part`, p.user_id, p.user_agents?.agent_name, null, null);
        global.io?.to(`user:${p.user_id}`).emit("coins_granted", { coins: REVIEW_REWARD_COINS, reason: "review_participation", battleId });
      }
    }
  }

  // Past-paper questions answered here count as past-question practice.
  await logBattlePastQuestions(battleId, participants ?? []).catch((e) => console.warn("[battle-worker] past-question log:", e.message));

  // Event trigger: a battle/review just finished — every participant gets
  // a fresh signal (their score is real, recent feedback worth planning on).
  for (const p of participants ?? []) {
    emitAutonomyEvent(p.user_id, "battle").catch(() => {});
  }

  const winner   = ranked[0];
  const runnerUp = ranked[1];
  const mm = String(Math.floor(durSecs / 60)).padStart(2, "0");
  const ss = String(durSecs % 60).padStart(2, "0");

  await appendLog(battleId, "battle_end",
    isCheck
      ? `Agent Check complete — ${winner?.score ?? 0} of ${battleInfo?.total_questions ?? 0} correct.`
      : isReview
      ? `Review complete — ${winner?.score ?? 0} of ${battleInfo?.total_questions ?? 0} correct. Mark sheet ready.`
      : winner ? `Battle complete! ${winner.user_agents?.agent_name} wins ${winner.score ?? 0}–${runnerUp?.score ?? 0}`
      : "Battle complete — every agent ran out of HP, so nobody is ranked",
    winner?.user_id, winner?.user_agents?.agent_name, winner?.user_agents?.agent_emoji, null,
    { finalScores: (participants ?? []).map((p) => ({ rank: rankOf.has(p.id) ? rankOf.get(p.id) + 1 : null, agentName: p.user_agents?.agent_name, score: p.score, xpEarned: earnedXp.get(p.id) ?? 0 })) }
  );

  getIO().to(`battle:${battleId}`).emit("battle:over", {
    // No winner in a review — sending participants[0] as one would have the
    // arena announce "X wins!" for a solo paper the moment it finished, before
    // the mark sheet arrived to say otherwise.
    team: isTeam ? { totals: teamTotals, winner: teamTie ? null : winTeam } : null,
    winner: isReview || !winner ? null : { userId: winner?.user_id, agentName: winner?.user_agents?.agent_name, agentEmoji: winner?.user_agents?.agent_emoji, score: winner?.score, xpEarned: xpDist[winner?.id] },
    finalScores: (participants ?? []).map((p) => ({
      rank: rankOf.has(p.id) ? rankOf.get(p.id) + 1 : null, userId: p.user_id, agentName: p.user_agents?.agent_name,
      agentEmoji: p.user_agents?.agent_emoji, score: p.score, hp: p.hp, xpEarned: earnedXp.get(p.id) ?? 0,
    })),
    durationSeconds: durSecs, durationFormatted: `${mm}:${ss}`,
    // So the arena can switch to the mark-sheet panel without waiting for the
    // results fetch to tell it what kind of battle it was watching.
    battleType: battleInfo?.battle_type ?? null,
    reviewScore: isReview
      ? { correct: winner?.score ?? 0, total: battleInfo?.total_questions ?? 0 }
      : null,
  });

  // Sergeant's verdict (the app pays; not for a review, which has no contest).
  if (!isReview) {
    const v = await verdict(battleId, { participants: ranked, knockedOut: participants.length - ranked.length, battleType: battleInfo?.battle_type, team: isTeam ? { totals: teamTotals, winner: teamTie ? null : winTeam } : null });
    if (v) {
      await appendLog(battleId, "judge_verdict", `${JUDGE.name}'s verdict: ${v}`, null, JUDGE.name, null, null);
      global.io?.to(`battle:${battleId}`).emit("battle:verdict", { battleId, judge: JUDGE.name, verdict: v });
    }
  }
  for (const p of participants) toldNoCoins.delete(`${battleId}:${p.id}`);

  // An Agent Check hands its result to Study Prep: the Engine scores it, the
  // topic moves on (or offers a retest), and the protégé reports in chat.
  if (isCheck) {
    try {
      const { completeAgentCheckBattle } = await import("../adaptive-learning/study-prep/wiring.js");
      await completeAgentCheckBattle(battleId);
    } catch (e) { console.warn("[battle-worker] agent check result:", e.message); }
  }

  // Revisions, once, now that the whole battle can be seen.
  //
  // This used to happen inside the per-answer confidence update, which meant a
  // fifteen-question battle raised up to fifteen revision cards WHILE THE
  // LEARNER WAS STILL PLAYING — one per question, each naming that question's
  // topic. Raised here it is one card per learner, listing the sub-topics they
  // were actually weak on across the whole battle.
  //
  // After the emit deliberately: the arena should show the result the instant
  // the battle ends, and a revision write is not worth a frame of delay.
  await flagBattleReviewTopics(battleId);

  await battleQueue.add("refresh-leaderboard", { action: "refresh-leaderboard", courseId: battleInfo?.course_id, scope: "classroom" }, { delay: 2000 });
}

/** Each participant's answers to past-paper questions → past_question_attempts (per exam/subject/year). */
async function logBattlePastQuestions(battleId, participants) {
  const { data: qs } = await db.from("battle_questions").select("id, subject, past_exam, past_year").eq("battle_id", battleId).not("past_exam", "is", null);
  if (!qs?.length) return;
  const byQ = new Map(qs.map((q) => [q.id, q]));
  const { data: answers } = await db.from("battle_answers").select("participant_id, question_id, is_correct").eq("battle_id", battleId);
  const { data: battle } = await db.from("battles").select("subject").eq("id", battleId).maybeSingle();
  for (const p of participants) {
    const groups = new Map();
    for (const a of answers || []) {
      if (a.participant_id !== p.id || !byQ.has(a.question_id)) continue;
      const q = byQ.get(a.question_id);
      const k = `${q.past_exam}|${q.past_year ?? ""}`;
      const g = groups.get(k) || { exam: q.past_exam, year: q.past_year, subject: q.subject || battle?.subject || null, attempted: 0, correct: 0 };
      g.attempted += 1; if (a.is_correct) g.correct += 1;
      groups.set(k, g);
    }
    for (const g of groups.values()) {
      await db.schema("edu").from("past_question_attempts").insert({ user_id: p.user_id, ...g, source: "battle", battle_id: battleId });
    }
  }
}

// ─── expire-battle ────────────────────────────────────────────────────────────

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
worker.on("completed", (job) => {
  console.log(`[battle-worker] ✅ ${job.data.action} battle=${job.data.battleId ?? ""}`);
  workerJob("battles", "done", job, { action: job.data?.action });
});
worker.on("failed",    (job, err) => {
  console.error(`[battle-worker] ❌ ${job?.data.action} failed:`, err.message);
  workerJob("battles", "failed", job, { action: job?.data?.action, error: err?.message });
});

export default worker;
