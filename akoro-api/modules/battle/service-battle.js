/**
 * battle/service-battle.js — one battle's detail, state, results, questions,
 * log-adjacent PDF, the creator's edit/delete, and the instructor dashboard.
 */
import { isMarkSheet } from "./entry.js";
import { cleanHpPerMiss } from "./hp.js";
import { res200, res400, res403, res404, notifyUser } from "./service-core.js";
import { fmtDuration, EDITABLE_BATTLE_FIELDS } from "./rules.js";
import { battles, seats, questions, people } from "./store.js";

export async function battleDetail(req, res) {
  const { data: battle } = await battles.battleDetailHeader(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: participants } = await seats.detailSeats(req.params.battleId);

  const { count: viewerCount } = await seats.viewerCount(req.params.battleId);

  res.json({
    battle,
    participants: (participants ?? []).map((p) => ({ ...p, isMe: p.user_id === req.user.id })),
    viewer_count: viewerCount ?? 0,
  });
}

export async function battleResults(req, res) {
  const { data: battle } = await battles.battleByIdSingle(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.status !== "completed") return res.status(400).json({ error: "Battle not completed", status: battle.status });

  const { data: resultSeats } = await seats.resultsSeats(req.params.battleId);

  // The teacher hosts the battle rather than competing in it, so they are not
  // on the scoreboard. They used to be — with a score of 0 and the tie broken
  // by HP, that ranked them first and named the teacher the winner of their
  // own class battle.
  const participants = (resultSeats ?? []).filter((p) => p.role !== "teacher");

  const scoreboard = (participants ?? []).map((p) => {
    const total = (p.correct_answers ?? 0) + (p.wrong_answers ?? 0);
    return {
      rank: p.final_rank, userId: p.user_id,
      username: p.users?.username, agentName: p.user_agents?.agent_name,
      agentEmoji: p.user_agents?.agent_emoji, agentColor: p.user_agents?.agent_color,
      score: p.score, hp: p.hp, correctAnswers: p.correct_answers, wrongAnswers: p.wrong_answers,
      accuracy: total > 0 ? Math.round((p.correct_answers / total) * 100) : 0,
      maxStreak: p.max_streak, xpEarned: p.xp_earned, isWinner: !!p.is_winner, isMe: p.user_id === req.user.id,
    };
  });

  // ── A REVIEW returns a MARK SHEET, not a scoreboard ──────────────────────
  // Nobody won; the question is what this learner knew. So: every question in
  // order, what they chose, what was right, and the total. A ranking of one is
  // not information, and calling them the winner of a solo review would be
  // actively misleading.
  // An Agent Check (D45) is a mark sheet too: one seat, no winner.
  if (isMarkSheet(battle.battle_type)) {
    // A class review has a seat per learner: each sees their own sheet (anyone else, the first).
    const seat = (participants ?? []).find((p) => p.role !== "teacher" && p.user_id === req.user.id)
      ?? (participants ?? []).find((p) => p.role !== "teacher");
    const learner = scoreboard.find((r) => r.userId === seat?.user_id) ?? scoreboard[0] ?? null;

    const { data: questionsRows } = await questions.allBattleQuestions(req.params.battleId);

    const { data: answers } = seat
      ? await questions.answersOfParticipant(seat.id)
      : { data: [] };
    const byQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));

    const sheet = (questionsRows ?? []).map((q) => {
      const options = JSON.parse(q.options_json);
      const a = byQuestion.get(q.id);
      return {
        order:         q.question_order,
        question:      q.question_text,
        topic:         q.topic ?? null,
        options,
        correctIndex:  q.correct_answer_index,
        correctAnswer: options[q.correct_answer_index],
        // null answer = ran out of time. That is different from a wrong
        // answer on a mark sheet, and a teacher reading it needs to see which.
        chosenIndex:   a?.selected_index ?? null,
        chosenAnswer:  a?.selected_index != null ? options[a.selected_index] : null,
        isCorrect:     a ? !!a.is_correct : false,
        answered:      !!a,
        // Agent Check: the notes didn't cover it and the agent picked anyway —
        // not demonstrated, right or wrong.
        guessed:       battle.battle_type === "check" && a?.answer_basis === "unknown",
        responseMs:    a?.response_time_ms ?? null,
      };
    });

    const total   = sheet.length;
    // A guess is not demonstrated, so it is not counted correct (D45).
    const correct = sheet.filter((r) => r.isCorrect && !r.guessed).length;
    const missed  = sheet.filter((r) => !r.answered).length;
    const guessed = sheet.filter((r) => r.guessed).length;

    // Where they actually went wrong, so the teacher does not have to tally it
    // by hand off the sheet.
    const byTopic = {};
    for (const r of sheet) {
      const k = r.topic || "General";
      byTopic[k] ??= { topic: k, total: 0, correct: 0 };
      byTopic[k].total++;
      if (r.isCorrect && !r.guessed) byTopic[k].correct++;
    }

    return res.json({
      type: battle.battle_type,
      battle: { ...battle, duration_formatted: fmtDuration(battle.duration_seconds ?? 0) },
      learner: learner && {
        userId: learner.userId, username: learner.username,
        fullName: (participants ?? []).find((p) => p.user_id === learner.userId)?.users?.full_name ?? null,
        agentName: learner.agentName, agentEmoji: learner.agentEmoji,
        // What the review actually paid. A completed review had no result panel
        // at all — no winner means the battle panel rendered nothing — so the
        // learner saw a finished review and no idea what they got for it.
        xpEarned: seat?.xp_earned ?? 0,
      },
      score: {
        correct, total,
        wrong:      total - correct - missed - guessed,
        unanswered: missed,
        guessed,
        percent:    total ? Math.round((correct / total) * 100) : 0,
      },
      byTopic: Object.values(byTopic)
        .map((t) => ({ ...t, percent: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
        .sort((x, y) => x.percent - y.percent),   // weakest first — that is the useful order
      markSheet: sheet,
    });
  }

  // The winner the battle actually named — not just the top row. With every
  // agent knocked out, or a team tie, there is none.
  const winner = battle.battle_type === "team" ? null : scoreboard.find((p) => p.isWinner) ?? null;
  const dur = battle.duration_seconds ?? 0;
  res.json({
    battle: { ...battle, duration_formatted: fmtDuration(dur) },
    winner: winner && { userId: winner.userId, agentName: winner.agentName, agentEmoji: winner.agentEmoji, score: winner.score, xpEarned: winner.xpEarned },
    scoreboard,
    // Sergeant, the platform's judge: the verdict once the battle is over.
    judge: { name: "Sergeant", verdict: battle.judge_verdict ?? null },
  });
}

/**
 * GET /api/battle/battles/:battleId/questions.pdf — a FINISHED battle's
 * questions, options, answers and explanations as one PDF (the Questions
 * tab's "Download as PDF"). Before the end the answers aren't everyone's yet.
 */
export async function battleQuestionsPdf(req, res) {
  const { data: battle } = await battles.battlePdfFields(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.status !== "completed") return res.status(409).json({ code: "NOT_FINISHED", error: "The questions can be downloaded once the battle has finished." });
  const { data: questionsRows } = await questions.questionsForPdf(battle.id);
  const { buildQuestionsPdf } = await import("./questionsPdf.js");
  const bytes = await buildQuestionsPdf({ battle, questions: questionsRows ?? [] });
  const name = `${String(battle.title || "battle").replace(/[^\w .-]/g, "").trim() || "battle"} - questions.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(Buffer.from(bytes));
}

/**
 * GET /api/battle/battles/:battleId/questions
 *
 * The answer key was already withheld until you'd answered — but the question
 * TEXT was not, at any status. So anyone in a battle could read all fifteen
 * questions during the lobby, and for a scheduled battle that window can be
 * days. In a timed contest, knowing the questions in advance is most of the
 * game, key or no key. Worse for AI-generated battles, where the person who
 * chose the topic is also the one who could read them.
 *
 * A question is now only returned once it has actually been PUT IN PLAY. The
 * worker logs each question as it broadcasts it, so the furthest logged
 * question_order is exactly "what has been shown" — no new column, and it
 * preserves the client's socket-drop fallback, which looks for the first
 * question with no revealed key and finds it as the last item here.
 */
export async function battleQuestions(req, res) {
  const { data: battle } = await battles.battleQuestionsStatus(req.params.battleId);
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const finished = ["completed", "expired", "cancelled"].includes(battle.status);

  // Not started: say how many there are, show none of them.
  if (!finished && battle.status !== "live") {
    return res.json({ questions: [], total: battle.total_questions ?? 0, notStarted: true });
  }

  const { data: questionsRows } = await questions.allBattleQuestions(req.params.battleId);
  const { data: participant } = await seats.participantOfUser(req.params.battleId, req.user.id);

  // How far the battle has actually got. Battle-wide, not per-participant, so
  // someone who timed out on a question doesn't get stuck behind it.
  let reached = Infinity;
  if (!finished) {
    const { data: log } = await questions.questionReached(req.params.battleId);
    reached = log?.[0]?.question_order ?? 1;
  }

  const inPlay = (questionsRows ?? []).filter((q) => q.question_order <= reached);

  const result = await Promise.all(inPlay.map(async (q) => {
    const myAnswer = participant
      ? (await questions.myAnswer(participant.id, q.id)).data
      : null;
    const revealed = finished || !!myAnswer;
    const options  = JSON.parse(q.options_json);
    return {
      questionOrder: q.question_order, questionText: q.question_text, options,
      topic: q.topic, xpValue: q.xp_value,
      correctAnswerIndex: revealed ? q.correct_answer_index : null,
      correctAnswer:      revealed ? options[q.correct_answer_index] : null,
      myAnswer:           myAnswer?.selected_index ?? null,
      isCorrect:          myAnswer?.is_correct     ?? null,
      xpGained:           myAnswer?.xp_gained      ?? null,
    };
  }));

  // `total` stays the real count so progress reads "3 of 15", not "3 of 3".
  res.json({ questions: result, total: battle.total_questions ?? (questionsRows ?? []).length });
}

/**
 * PUT /api/battle/battles/:battleId
 * Edit battle title, XP pool, time limit, total questions.
 * Only allowed while battle is in lobby or scheduled state.
 */
export async function editBattle(req, res) {
  const { data: battle } = await battles.battleEditFields(req.params.battleId);
  if (!battle) return res404(res, "Battle not found");
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res403(res, "Not authorised");
  // Anything that isn't in flight or finished is editable. Restricting this to
  // lobby/scheduled meant a battle that had expired or been cancelled could
  // never be fixed and re-used — you had to build it again from scratch.
  if (["live", "completed"].includes(battle.status)) return res400(res, `Cannot edit a ${battle.status} battle`);

  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => EDITABLE_BATTLE_FIELDS.includes(k)));
  if ("hp_per_miss" in updates) updates.hp_per_miss = cleanHpPerMiss(updates.hp_per_miss);
  if ("min_xp" in updates) updates.min_xp = Math.max(0, Math.round(Number(updates.min_xp) || 0));
  // The questions are already written for the count it was made with; a
  // different count would leave the card and the paper disagreeing.
  if ("total_questions" in updates) {
    const { count: written } = await questions.countBattleQuestions(req.params.battleId);
    if (written && Number(updates.total_questions) !== written) {
      return res400(res, `This battle's ${written} questions are already written — make a new battle to change how many.`);
    }
    delete updates.total_questions;
  }

  if (!Object.keys(updates).length) return res400(res, "No valid fields to update");
  updates.updated_at = new Date().toISOString();

  const { data, error } = await battles.updateBattleSelected(req.params.battleId, updates);
  if (error) throw new Error(error.message);
  res200(res, data);
}

/**
 * DELETE /api/battle/battles/:battleId
 *
 * Removes a battle for good — participants, questions and logs cascade with it.
 * Only the creator (or an admin) may, and never while it is live: deleting a
 * battle mid-round would strand everyone currently answering. Finished battles
 * CAN be deleted; they are the creator's own history to clear.
 *
 * ?cancel=1 keeps the record and just marks it cancelled, which is what the
 * older /challenges/:id route does.
 */
export async function deleteBattle(req, res) {
  const { data: battle } = await battles.battleDeleteFields(req.params.battleId);
  if (!battle) return res404(res, "Battle not found");
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res403(res, "Not authorised");
  if (battle.status === "live") return res400(res, "Cannot delete a battle that is live — end it first");

  if (req.query.cancel === "1") {
    const { error } = await battles.setBattleStatus(battle.id, "cancelled");
    if (error) throw new Error(error.message);
    return res200(res, { id: battle.id, cancelled: true });
  }

  // Tell everyone who was invited, so a battle doesn't just vanish from their
  // list with no explanation.
  const { data: parts } = await seats.otherSeatUserIds(battle.id, battle.created_by);
  for (const p of (parts ?? [])) {
    await notifyUser(p.user_id, "battle_cancelled", `Battle cancelled: ${battle.title}`,
      "The person who created it has removed this battle.", battle.id).catch(() => {});
  }

  const { error } = await battles.deleteBattle(battle.id);
  if (error) throw new Error(error.message);
  res200(res, { id: battle.id, deleted: true });
}

/**
 * GET /api/battle/instructor/stats
 * Aggregated battle stats for the teacher dashboard:
 *   live count, total battles, total XP in play, agent win rate
 */
export async function instructorStats(req, res) {
  const teacherId = req.user.id;

  // Get all courses owned by this teacher
  const { data: courses } = await people.coursesOfTeacher(teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);

  if (!courseIds.length) {
    return res200(res, { live_now: 0, total_battles: 0, total_xp_in_play: 0, agent_win_rate: 0 });
  }

  const { data: teacherBattles } = await battles.battlesOfTeacherCourses(courseIds);

  const all       = teacherBattles ?? [];
  const liveNow   = all.filter((b) => b.status === "live").length;
  const totalXP   = all.filter((b) => ["lobby","scheduled","live"].includes(b.status))
    .reduce((s, b) => s + (b.xp_pool ?? 0), 0);

  // Agent win rate from xp_leaderboard battle_course scope
  const { data: agentXP } = await people.agentWithXp(teacherId);

  // Battle win rate
  const { data: participated } = await seats.seatsOfUser(teacherId);

  const played    = (participated ?? []).length;
  const won       = (participated ?? []).filter((p) => p.is_winner).length;
  const winRate   = played > 0 ? Math.round((won / played) * 100) : 0;

  res200(res, {
    live_now:         liveNow,
    total_battles:    all.length,
    total_xp_in_play: totalXP,
    agent_win_rate:   winRate,
    agent_xp:         agentXP?.total_xp ?? 0,
    battles_played:   played,
    battles_won:      won,
  });
}
