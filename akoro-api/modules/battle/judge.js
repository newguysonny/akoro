/**
 * battle/judge.js — Sergeant, the platform's agent, judges every battle.
 *
 * Who pays for what in a battle:
 *   questions   the creator (questionSource.generate — a platform-made battle,
 *               like the daily one, has no creator, so the app pays)
 *   answers     each learner, for their own agent's recall and answer
 *               (agentRecall.answerFromRecall / rerank carry their userId)
 *   judging     the app — Sergeant's rulings and verdict are free to learners
 *
 * Marking itself is never a model's call: an answer is right when it matches
 * the stored key (revealQuestion). Sergeant explains the ruling — why the key
 * is right — and at the end gives the verdict: who won and what decided it.
 * A review (self study) is not a contest and has no judge.
 */
import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";

export const JUDGE = Object.freeze({ name: "Sergeant", role: "judge" });
const JUDGE_MODEL = process.env.BATTLE_JUDGE_MODEL || "gpt-4o-mini";
// Every judge call is the platform's: never the creator's or a learner's wallet,
// even when the worker happens to run inside someone's request.
// Sergeant judging is the locked `assessor` role (§7.12.2, `__role` on each call): env model, never the learner's pick.
const PLATFORM = { __payer: "platform" };

const letter = (i) => String.fromCharCode(65 + i);
const optText = (o) => String(o ?? "").replace(/^[A-E][.)]\s*/, "");

/**
 * The ruling's reason for one question, written once and kept on the question
 * (heats of the daily battle copy it along). Started when the question goes
 * out, so it is ready by the reveal.
 */
export async function prepareRuling(q) {
  if (!q?.id || q.explanation) return q?.explanation || null;
  try {
    const options = JSON.parse(q.options_json || "[]");
    const resp = await openai.chat.completions.create({
      ...PLATFORM, __feature: "battle_judge", __role: "assessor", model: JUDGE_MODEL, max_tokens: 90, temperature: 0.2,
      messages: [
        { role: "system", content: "You are Sergeant, the judge of a school quiz battle. In ONE short sentence (max 30 words), say why the marked answer is correct. Plain words a secondary-school learner understands. No preamble." },
        { role: "user", content: `Question: ${q.question_text}\nOptions:\n${options.map((o, i) => `${letter(i)}. ${optText(o)}`).join("\n")}\nCorrect answer: ${letter(q.correct_answer_index)}` },
      ],
    });
    const why = String(resp.choices?.[0]?.message?.content ?? "").trim().replace(/\s+/g, " ").slice(0, 300);
    if (why) await db.from("battle_questions").update({ explanation: why }).eq("id", q.id);
    return why || null;
  } catch (e) {
    console.warn("[battle/judge] ruling failed:", e.message);
    return null;
  }
}

/** The ruling shown at the reveal: the key, and why. */
export async function ruling(q) {
  const options = JSON.parse(q.options_json || "[]");
  let why = q.explanation || null;
  if (!why) {
    // Not ready yet (or the early call failed): give it one short chance.
    why = await Promise.race([prepareRuling(q), new Promise((r) => setTimeout(() => r(null), 3000))]);
  }
  const answer = `${letter(q.correct_answer_index)}. ${optText(options[q.correct_answer_index])}`;
  return { judge: JUDGE.name, answer, why: why || null, text: `${JUDGE.name}: the answer is ${answer}.${why ? ` ${why}` : ""}` };
}

/**
 * The verdict once the battle is over: a few sentences on who won and what
 * decided it, from the settled scoreboard and the per-topic results.
 * Stored on the battle so the result screen can show it later.
 */
export async function verdict(battleId, { participants = [], knockedOut = 0, battleType = null, team = null } = {}) {
  try {
    const { data: b } = await db.from("battles").select("title, subject, total_questions").eq("id", battleId).maybeSingle();
    const { data: qs } = await db.from("battle_questions").select("id, topic").eq("battle_id", battleId);
    const { data: answers } = await db.from("battle_answers").select("participant_id, question_id, is_correct, answer_basis").eq("battle_id", battleId);
    const topicOf = new Map((qs || []).map((q) => [q.id, q.topic || "General"]));
    const missed = {};
    for (const a of answers || []) if (!a.is_correct) { const t = topicOf.get(a.question_id); missed[t] = (missed[t] || 0) + 1; }
    const board = participants.slice(0, 8).map((p, i) => `${i + 1}. ${p.user_agents?.agent_name || "Agent"} — ${p.correct_answers ?? p.score ?? 0}/${b?.total_questions ?? "?"}${p.team ? ` (team ${p.team})` : ""}`).join("\n");
    const hardest = Object.entries(missed).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${t} (${n} missed)`).join(", ");
    const resp = await openai.chat.completions.create({
      ...PLATFORM, __feature: "battle_judge", __role: "assessor", model: JUDGE_MODEL, max_tokens: 160, temperature: 0.3,
      messages: [
        { role: "system", content: "You are Sergeant, the judge of a school quiz battle between learners' AI agents (each agent answers only from its learner's notes). Give the verdict in 2–3 short sentences: who won and by how much, what decided it, and the one topic everyone should go and teach their agent next. Fair, firm, encouraging. No emojis, no preamble." },
        { role: "user", content: `Battle: ${b?.title || "Battle"} (${b?.subject || "General"}, ${battleType || "battle"})\n` +
          `${team ? `Team totals: ${Object.entries(team.totals || {}).map(([k, v]) => `${k} ${v}`).join(", ")}; winner: ${team.winner || "tie"}\n` : ""}` +
          `Final scoreboard (agents still with HP):\n${board || "(every agent ran out of HP — nobody ranked)"}\n${knockedOut ? `Knocked out (ran out of HP, unranked): ${knockedOut}\n` : ""}Most-missed topics: ${hardest || "none"}\nQuestions passed for lack of notes or credit are in the commentary.` },
      ],
    });
    const text = String(resp.choices?.[0]?.message?.content ?? "").trim().slice(0, 700);
    if (text) await db.from("battles").update({ judge_verdict: text }).eq("id", battleId);
    return text || null;
  } catch (e) {
    console.warn("[battle/judge] verdict failed:", e.message);
    return null;
  }
}
