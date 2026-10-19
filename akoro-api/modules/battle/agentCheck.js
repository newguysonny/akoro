/**
 * battle/agentCheck.js — the Agent Check (Grand Plan §7.12, D45) as a real
 * battle the learner watches in the arena.
 *
 *   the platform / teaching guide asks   questions on the topic (generated
 *                                        for it, paid by the platform)
 *   the learner's protégé answers        ONLY from its learner's notes
 *                                        (agentRecall) — no notes, no answer
 *   Sergeant judges                      every question (the stored key
 *                                        marks it; Sergeant says why)
 *   the Education Engine scores          Study Prep, from checkResults()
 *
 * battle_type 'check': one seat (the protégé), already joined; a mark sheet —
 * no HP, no winner, no XP. Study Prep charged the practice price once before
 * creating it (§7.12.2), so neither the questions nor the answers bill again.
 */
import db from "../../db.js";
import { buildQuestions } from "./questionSource.js";

const now = () => new Date().toISOString();
let _q = null;
const queue = async () => (_q ||= (await import("./worker.js")).battleQueue);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export const CHECK_DEFAULTS = Object.freeze({ QUESTIONS: 5, SECONDS_PER_QUESTION: 25, START_DELAY_MS: 6000 });

/** The learner's protégé (their active agent, else their newest). → id or null. */
async function protegeOf(learnerId) {
  const { data } = await db.from("user_agents").select("id, is_active, created_at")
    .eq("user_id", learnerId).order("is_active", { ascending: false }).order("created_at", { ascending: false }).limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Create and queue one Agent Check. → { battleId, placed, title }.
 * Starts on its own after START_DELAY_MS, so the learner can open the arena
 * first; the learner's sockets are told to join its room.
 */
export async function createCheckBattle({ learnerId, subject, topic, total = CHECK_DEFAULTS.QUESTIONS, studyPrepTopicId = null, mode = "diagnostic", secondsPerQuestion = CHECK_DEFAULTS.SECONDS_PER_QUESTION, basedOn = [] }) {
  const agentId = await protegeOf(learnerId);
  if (!agentId) throw fail("Create your agent first — the Agent Check is your agent answering.", 409);
  const count = Math.max(3, Math.min(10, Number(total) || CHECK_DEFAULTS.QUESTIONS));
  const seconds = Math.max(8, Math.min(60, Number(secondsPerQuestion) || CHECK_DEFAULTS.SECONDS_PER_QUESTION));
  const title = `Agent Check${mode === "retest" ? " (retest)" : ""}: ${topic}`.slice(0, 200);

  const { data: battle, error } = await db.from("battles").insert({
    course_id: null, classroom_id: null, battle_type: "check",
    title, topic, subject, difficulty: "intermediate",
    total_questions: count, time_limit_seconds: count * seconds,
    xp_prize: 0, xp_pool: 0, hp_per_miss: 0, min_xp: 0,
    max_participants: 1, total_participants: 1, status: "lobby",
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    // The platform asks (and pays for the questions); nobody "created" it.
    created_by: null,
    study_prep_topic_id: studyPrepTopicId,
  }).select().single();
  if (error) throw new Error(error.message);

  let fill;
  try {
    // Generated for THIS topic: the past-paper bank is matched by subject
    // only, and a check of "Cell Structure" must ask about cell structure.
    fill = await buildQuestions({
      battleId: battle.id, source: "ai", total: count, subject, topic,
      difficulty: "intermediate", classLabel: null, userId: null, durationSeconds: count * seconds,
      // Planned from the learner's own past papers: ask what those papers ask (§7.17.3).
      ...(basedOn?.length ? { basedOn } : {}),
    });
  } catch (e) {
    await db.from("battles").delete().eq("id", battle.id);
    throw fail(`Couldn't write the check questions: ${e.message}`, 503);
  }
  if ((fill?.placed ?? 0) < 3) {
    await db.from("battles").delete().eq("id", battle.id);
    throw fail(`Couldn't put together enough questions on ${topic} — try again in a moment.`, 503);
  }
  if (fill.placed !== count) {
    await db.from("battles").update({ total_questions: fill.placed, time_limit_seconds: fill.placed * (fill.secondsPerQuestion || seconds) }).eq("id", battle.id);
  }

  const { error: seatError } = await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: learnerId, agent_id: agentId, role: "participant", joined_at: now(),
  });
  if (seatError) {
    await db.from("battles").delete().eq("id", battle.id);
    throw new Error(seatError.message);
  }

  const q = await queue();
  await q.add("start-battle", { action: "start-battle", battleId: battle.id },
    { delay: CHECK_DEFAULTS.START_DELAY_MS, jobId: `start-${battle.id}` });
  global.io?.to(`user:${learnerId}`).emit("join_battle_room", { battleId: battle.id });
  return { battleId: battle.id, placed: fill.placed, title };
}

/**
 * What the check showed, question by question (§7.12 step 4).
 *   correct   answered right FROM a note
 *   guessed   the notes didn't cover it and it picked anyway — not
 *             demonstrated, right or wrong ("a correct guess counts as not
 *             demonstrated")
 *   wrong     answered from the notes, wrongly
 *   unknown   no answer: nothing in the notes on it
 * → { total, correct, guessed, wrong, unknown, score, perQuestion, gaps, learnerId }
 */
export async function checkResults(battleId) {
  const [{ data: battle }, { data: questions }, { data: seats }] = await Promise.all([
    db.from("battles").select("id, battle_type, topic, subject, total_questions, study_prep_topic_id, status").eq("id", battleId).maybeSingle(),
    db.from("battle_questions").select("id, question_order, question_text, topic, correct_answer_index, explanation").eq("battle_id", battleId).order("question_order", { ascending: true }),
    db.from("battle_participants").select("id, user_id, role").eq("battle_id", battleId),
  ]);
  if (!battle || battle.battle_type !== "check") return null;
  const seat = (seats || []).find((s) => s.role !== "teacher");
  const { data: answers } = seat
    ? await db.from("battle_answers").select("question_id, is_correct, answer_basis, recalled_topic").eq("participant_id", seat.id)
    : { data: [] };
  const byQ = new Map((answers || []).map((a) => [a.question_id, a]));
  const perQuestion = (questions || []).map((q) => {
    const a = byQ.get(q.id);
    const outcome = !a ? "unknown" : a.answer_basis === "unknown" ? "guessed" : a.is_correct ? "correct" : "wrong";
    return {
      order: q.question_order, outcome,
      fromNote: a?.recalled_topic || null,
      ...(outcome === "correct" ? {} : { gap: String(q.topic && q.topic !== battle.topic ? q.topic : q.question_text).slice(0, 140) }),
    };
  });
  const count = (o) => perQuestion.filter((p) => p.outcome === o).length;
  const total = perQuestion.length;
  const correct = count("correct");
  const gaps = [...new Set(perQuestion.filter((p) => p.gap).map((p) => p.gap))].slice(0, 6);
  return {
    battleId, studyPrepTopicId: battle.study_prep_topic_id, learnerId: seat?.user_id ?? null,
    total, correct, guessed: count("guessed"), wrong: count("wrong"), unknown: count("unknown"),
    score: total ? correct / total : 0, perQuestion, gaps,
  };
}

/**
 * Remove one Agent Check battle (the gate's cleanup) — only a check whose one
 * seat is this learner. Its questions, answers, seats and log go with it.
 * → number of battles deleted.
 */
export async function discardCheckBattle(battleId, learnerId) {
  const { data: seats } = await db.from("battle_participants").select("user_id").eq("battle_id", battleId);
  if (!seats?.length || seats.some((s) => s.user_id !== learnerId)) return 0;
  const { data, error } = await db.from("battles").delete().eq("id", battleId).eq("battle_type", "check").select("id");
  if (error) throw new Error(error.message);
  return (data || []).length;
}
