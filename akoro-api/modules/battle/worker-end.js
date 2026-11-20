/**
 * battle/worker-end.js — the end-battle job: settle the answers, rank, pay the
 * XP pool (and a review's coins), announce the result, then hand an Agent Check
 * back to Study Prep. Also the past-paper attempt log the settle writes.
 */
import db from "../../db.js";
import { emitAutonomyEvent } from "../autonomy/index.js";
import { workflowWiring } from "../../lib/workflowWiring.js";
import { grantCoins } from "../../lib/coins.js";
import { REVIEW_REWARD_COINS, isMarkSheet } from "./entry.js";
import { verdict, JUDGE } from "./judge.js";
import { flagBattleReviewTopics } from "./knowledge.js";
import { appendLog, creditXP, getBattleWorkerQueue, toldNoCoins } from "./worker-core.js";
import { computeXpDistribution, getIO, now } from "./worker-rules.js";

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
      const { completeAgentCheckBattle } = workflowWiring();
      await completeAgentCheckBattle(battleId);
    } catch (e) { console.warn("[battle-worker] agent check result:", e.message); }
    // A Decay Review's check or retest (Phase 8): retained / decayed / passed, decided in code.
    try {
      const { decayReview } = workflowWiring();
      await decayReview().onCheckEnded(battleId);
    } catch (e) { console.warn("[battle-worker] decay review check:", e.message); }
    // Question tags, timings and confusion pairs (§7.15.1) — never fails the battle's end.
    await import("./agentCheck.js").then((m) => m.recordCheckQuestionSignals(battleId)).catch((e) => console.warn("[battle-worker] question signals:", e?.message || e));
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

  await getBattleWorkerQueue().add("refresh-leaderboard", { action: "refresh-leaderboard", courseId: battleInfo?.course_id, scope: "classroom" }, { delay: 2000 });
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

export { endBattle, logBattlePastQuestions };
