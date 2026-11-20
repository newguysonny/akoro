/**
 * battle/worker-start.js — starting a question: queue one answer per agent for
 * the question just broadcast, and the advance-question job that broadcasts the
 * next one.
 */
import db from "../../db.js";
import { thinkingTimeMs, autoPlayers } from "./agentPlayer.js";
import { embedQuestion, recall, recallStrength } from "./agentRecall.js";
import { prepareRuling } from "./judge.js";
import { buildQuestionPayload, getIO } from "./worker-rules.js";
import { appendLog, getBattleWorkerQueue, rememberVector } from "./worker-core.js";
import { endBattle } from "./worker-end.js";

/**
 * Queue one answer per agent for the question just broadcast.
 *
 * jobId is per battle/question/participant, so a retried or duplicated
 * broadcast cannot make an agent answer twice.
 */
async function scheduleAgentAnswers(battleId, q) {
  const players = await autoPlayers(battleId);
  const { data: bt } = await db.from("battles").select("battle_type").eq("id", battleId).maybeSingle();
  const prepaid = bt?.battle_type === "check";   // an Agent Check's searches are the platform's (D45)
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
      ...(prepaid ? { payer: "platform" } : {}),
    });
    const thinkingMs = thinkingTimeMs(recallStrength(notes), q.time_limit_seconds);
    await getBattleWorkerQueue().add("agent-answer",
      { action: "agent-answer", battleId, questionOrder: q.question_order, participantId: p.id, thinkingMs },
      {
        delay: thinkingMs,
        jobId: `answer-${battleId}-q${q.question_order}-${p.id}`,
      });
  }
}

async function advanceQuestion(battleId, questionOrder) {
  const { data: liveCheck } = await db.from("battles").select("status, battle_type").eq("id", battleId).maybeSingle();
  if (liveCheck?.status !== "live") return;   // ended early — ask nothing more

  const { data: q } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", questionOrder).single();
  if (!q) return endBattle(battleId);

  getIO().to(`battle:${battleId}`).emit("battle:question", buildQuestionPayload(q));
  if (liveCheck.battle_type !== "review") prepareRuling(q).catch(() => {});
  await appendLog(battleId, "question_start", `━━━ Q${questionOrder}: ${q.topic} ━━━`, null, null, null, questionOrder, { questionOrder, topic: q.topic });
  await scheduleAgentAnswers(battleId, q);
  await getBattleWorkerQueue().add("reveal-question",
    { action: "reveal-question", battleId, questionOrder },
    { delay: (q.time_limit_seconds || 15) * 1000, jobId: `reveal-${battleId}-q${questionOrder}` }
  );
}

export { advanceQuestion, scheduleAgentAnswers };
