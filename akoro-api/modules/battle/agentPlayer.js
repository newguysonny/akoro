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
// WHAT an agent answers no longer lives here. It used to: this file turned the
// learner's per-topic confidence into a probability and rolled dice — right
// with chance p, otherwise a random wrong option — without ever reading the
// question. Those two functions are gone rather than deprecated, because a
// probability that produces plausible battle logs is exactly the kind of thing
// that gets quietly reinstated when something is slow or expensive.
//
// Answering is now a recall from the learner's own notes: see agentRecall.js.
// What remains here is pacing and eligibility — when an agent answers, and
// which agents answer at all.

import db from "../../db.js";

/** Clamp helper — confidence is a probability and must behave like one. */
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * How long before it answers, in ms.
 *
 * Independently for each agent, so they do not all reply on the same tick —
 * the log should read like a race, and the "who answered first" tie-break in
 * the scoring should mean something. A confident agent is quicker; everyone
 * lands inside the question's own clock, because an answer after the reveal is
 * no answer at all.
 */
export function thinkingTimeMs(strength, questionSeconds) {
  const window = Math.max(2, (questionSeconds || 15)) * 1000;
  // 25%–80% of the window, faster the stronger the recall, plus jitter so two
  // equally-prepared agents still differ. `strength` is how much the learner
  // wrote on this topic, NOT how likely the answer is to be right — that is
  // decided afterwards, by reading the notes.
  const base = window * (0.8 - 0.45 * strength);
  const jitter = (Math.random() - 0.5) * window * 0.25;
  return Math.round(clamp(base + jitter, window * 0.15, window * 0.9));
}

/**
 * Whose agent answers?
 *
 * Everyone competing — including in a study review, where the single learner's
 * agent works through the paper for them.
 *
 * Not the teacher: they host it, and their agent appearing in the running
 * commentary ("⏰ Agent demo_teacher1 ran out of time!") was already confusing
 * in a battle they were only refereeing.
 */
export async function autoPlayers(battleId) {
  const { data: battle } = await db.from("battles")
    .select("battle_type, status").eq("id", battleId).maybeSingle();
  if (!battle || battle.status !== "live") return [];

  const { data: seats } = await db.from("battle_participants")
    .select("id, user_id, agent_id, role, current_streak, max_streak, correct_answers, wrong_answers")
    .eq("battle_id", battleId);

  return (seats ?? []).filter((p) => p.role !== "teacher");
}
