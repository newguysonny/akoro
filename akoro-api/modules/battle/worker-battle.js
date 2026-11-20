/**
 * battle/worker-battle.js — the two jobs that play a question: one agent's
 * answer (agent-answer), and marking the whole question (reveal-question).
 */
import db from "../../db.js";
import { workflowWiring } from "../../lib/workflowWiring.js";
import { coinsAvailable, schoolBillTo, InsufficientCoins } from "../../lib/coins.js";
import { embedQuestion, answerFromRecall, recall } from "./agentRecall.js";
import { updateKnowledgeConfidence } from "./knowledge.js";
import { isMarkSheet } from "./entry.js";
import { HP_PER_MISS_DEFAULT } from "./hp.js";
import { ruling, JUDGE } from "./judge.js";
import { agentOf, getIO, now } from "./worker-rules.js";
import { appendLog, creditXP, getBattleWorkerQueue, questionVector, toldNoCoins } from "./worker-core.js";
import { advanceQuestion } from "./worker-start.js";
import { endBattle } from "./worker-end.js";

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
    const embedding = questionVector(q.id) ?? await embedQuestion(`${q.topic ? q.topic + ": " : ""}${q.question_text}`);
    const notes = await recall({
      studentId: p.user_id, embedding, topic: q.topic,
      // The question drives the lexical half of the search, and the subject
      // narrows it — a Mathematics question has no business retrieving a Social
      // Studies note, however close the vectors happen to sit.
      queryText: q.question_text, subject: q.subject,
      ...(prepaid ? { payer: "platform" } : {}),
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

  // An Agent Check reports each marked question to Study Prep's run in the chat (2026-10-20):
  // answered from the notes / guessed / wrong / no answer. Best effort — never holds the battle.
  if (btype?.battle_type === "check") {
    const ans = (answers ?? [])[0] || null;
    const guessedIt = ans?.answer_basis === "unknown";
    const outcome = !ans ? "unknown" : ans.is_correct ? (guessedIt ? "guessed_right" : "correct") : (guessedIt ? "guessed" : "wrong");
    Promise.resolve()
      .then(() => workflowWiring().reportCheckQuestion({ battleId, order: questionOrder, total: battleInfo?.total_questions ?? null, outcome, note: ans?.recalled_topic || null, gap: q.topic || null }))
      .catch((e) => console.warn("[battle-worker] check question report:", e?.message || e));
  }

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
    await getBattleWorkerQueue().add("end-battle", { action: "end-battle", battleId }, { delay: 3000 });
  } else {
    await advanceQuestion(battleId, questionOrder + 1);
  }
}

export { agentAnswer, revealQuestion };
