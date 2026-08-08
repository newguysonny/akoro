// modules/battle/agentPlayer.js
//
// Agents answer battle questions themselves.
//
// A battle is described everywhere as agent vs agent, but nothing ever made an
// agent answer anything: the only way a question got an answer was a human
// tapping an option in the learner app. So an unattended battle produced a log
// that was nothing but "⏰ ran out of time", every score 0, and a winner picked
// by whoever happened to sort first. That is what a completed battle looked
// like: "Priya's Agent wins 0–0".
//
// What an agent answers with is NOT a coin flip. Every battle answer already
// updates edu.student_knowledge — a per-topic confidence for that learner, which
// rises when they get a topic right and falls when they get it wrong. That table
// is the honest description of what the learner's agent knows, so it is what
// decides the answer here. An agent is good at what its owner is good at.
//
// A REVIEW is deliberately excluded. Its whole purpose is to find out what the
// LEARNER knows, so an agent answering for them would defeat it.

import db from "../../db.js";

/** Clamp helper — confidence is a probability and must behave like one. */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * How likely is this agent to get this question right?
 *
 * Starts from the learner's confidence in the question's topic, then:
 *  · difficulty moves it — a hard question is hard for everybody
 *  · experience nudges it — total_xp is the only measure of an agent's
 *    track record we have, and it saturates so a veteran is not infallible
 *
 * Bounded well inside 0..1: an agent that always knows is not a contest, and
 * one that never does is not a learner.
 */
export async function accuracyFor({ userId, agentId, topic, difficulty }) {
  let confidence = 0.5;

  if (topic) {
    try {
      const { data: agent } = await db.schema("edu").from("student_agents")
        .select("id").eq("student_id", userId).maybeSingle();
      if (agent) {
        const { data: known } = await db.schema("edu").from("student_knowledge")
          .select("confidence").eq("agent_id", agent.id).eq("topic", topic).maybeSingle();
        // Negative confidence means "met this and struggled" — it is a real
        // signal, not a missing value, so it maps to a low chance rather than
        // being discarded back to the 0.5 default.
        if (known?.confidence != null) confidence = clamp(Number(known.confidence), 0.05, 1);
      }
    } catch { /* edu schema unavailable — fall back to the default */ }
  }

  const byDifficulty = { easy: 0.15, intermediate: 0, hard: -0.15 }[difficulty ?? "intermediate"] ?? 0;

  let experience = 0;
  try {
    const { data: a } = await db.from("user_agents").select("total_xp").eq("id", agentId).maybeSingle();
    // 0 at no XP, approaching +0.1 — a ceiling, so XP cannot buy certainty.
    experience = 0.1 * (1 - Math.exp(-(a?.total_xp ?? 0) / 5000));
  } catch { /* ignore */ }

  return clamp(confidence + byDifficulty + experience, 0.08, 0.93);
}

/**
 * How long before it answers, in ms.
 *
 * Independently for each agent, so they do not all reply on the same tick —
 * the log should read like a race, and the "who answered first" tie-break in
 * the scoring should mean something. A confident agent is quicker; everyone
 * lands inside the question's own clock, because an answer after the reveal is
 * no answer at all.
 */
export function thinkingTimeMs(accuracy, questionSeconds) {
  const window = Math.max(2, (questionSeconds || 15)) * 1000;
  // 25%–80% of the window, faster the more confident, plus jitter so two
  // equally-confident agents still differ.
  const base = window * (0.8 - 0.45 * accuracy);
  const jitter = (Math.random() - 0.5) * window * 0.25;
  return Math.round(clamp(base + jitter, window * 0.15, window * 0.9));
}

/**
 * Choose an option index.
 *
 * Right with probability `accuracy`. When wrong, it picks among the DISTRACTORS
 * — never the correct answer, or "wrong" would silently be right some of the
 * time and the accuracy above would not mean what it says.
 */
export function chooseAnswer(accuracy, optionCount, correctIndex) {
  if (Math.random() < accuracy) return correctIndex;
  const wrong = [];
  for (let i = 0; i < optionCount; i++) if (i !== correctIndex) wrong.push(i);
  if (!wrong.length) return correctIndex;
  return wrong[Math.floor(Math.random() * wrong.length)];
}

/**
 * Who in this battle answers for themselves?
 *
 * Not the teacher — they host it, and their agent appearing in the running
 * commentary ("⏰ Agent demo_teacher1 ran out of time!") was already confusing
 * in a battle they were only refereeing.
 *
 * Not anyone in a REVIEW: that is the learner's own paper.
 */
export async function autoPlayers(battleId) {
  const { data: battle } = await db.from("battles")
    .select("battle_type, status").eq("id", battleId).maybeSingle();
  if (!battle || battle.status !== "live" || battle.battle_type === "review") return [];

  const { data: seats } = await db.from("battle_participants")
    .select("id, user_id, agent_id, role, current_streak, max_streak, correct_answers, wrong_answers")
    .eq("battle_id", battleId);

  return (seats ?? []).filter((p) => p.role !== "teacher");
}
