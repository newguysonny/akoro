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

import { addLater } from "../../lib/deferredJobs.js";
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
 *
 * A CLASS review (an activity's review battle, self-study/activityReview.js)
 * passes `learnerIds` and `startsAt`: one check, a seat for every learner with
 * an agent, sent as a CHALLENGE (seats unanswered, in their Challenges list
 * until it starts); it starts at `startsAt` with whoever accepted. Each gets a
 * mark sheet. → also { seated, noAgent }.
 */
export async function createCheckBattle({ learnerId = null, learnerIds = null, startsAt = null, subject, topic, total = CHECK_DEFAULTS.QUESTIONS, studyPrepTopicId = null, mode = "diagnostic", secondsPerQuestion = CHECK_DEFAULTS.SECONDS_PER_QUESTION, basedOn = [], title: titleIn = null, extra = {}, preset = null }) {
  const group = Array.isArray(learnerIds);
  const seats = [], noAgent = [];
  for (const id of group ? learnerIds : [learnerId]) {
    const agentId = await protegeOf(id);
    if (agentId) seats.push({ userId: id, agentId }); else noAgent.push(id);
  }
  if (!seats.length) throw fail(group ? "Nobody in the class has an agent yet — the review is their agents answering." : "Create your agent first — the Agent Check is your agent answering.", 409);
  const count = Math.max(3, Math.min(10, Number(total) || CHECK_DEFAULTS.QUESTIONS));
  const seconds = Math.max(8, Math.min(60, Number(secondsPerQuestion) || CHECK_DEFAULTS.SECONDS_PER_QUESTION));
  const title = (titleIn || `Agent Check${mode === "retest" ? " (retest)" : ""}: ${topic}`).slice(0, 200);
  const startMs = group && startsAt ? Math.max(Date.now(), Date.parse(startsAt)) : null;

  const { data: battle, error } = await db.from("battles").insert({
    course_id: null, classroom_id: null, battle_type: "check",
    title, topic, subject, difficulty: "intermediate",
    total_questions: count, time_limit_seconds: count * seconds,
    xp_prize: 0, xp_pool: 0, hp_per_miss: 0, min_xp: 0,
    max_participants: seats.length, total_participants: seats.length,
    status: startMs ? "scheduled" : "lobby",
    scheduled_start: startMs ? new Date(startMs).toISOString() : null,
    // A class review's accept window closes when it starts.
    expires_at: new Date(startMs ?? Date.now() + 3600_000).toISOString(),
    // The platform asks (and pays for the questions); nobody "created" it.
    created_by: null,
    study_prep_topic_id: studyPrepTopicId,
    // A guide review (battle/guideReview.js) marks itself: who asked, from which session.
    ...extra,
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
      // Questions prepared ahead (an activity draft's review battle): asked as they are.
      ...(preset?.length ? { preset } : {}),
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

  const { error: seatError } = await db.from("battle_participants").insert(seats.map((s) => ({
    battle_id: battle.id, user_id: s.userId, agent_id: s.agentId, role: "participant", joined_at: group ? null : now(),
  })));
  if (seatError) {
    await db.from("battles").delete().eq("id", battle.id);
    throw new Error(seatError.message);
  }

  const q = await queue();
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
    { delay: startMs ? startMs - Date.now() : CHECK_DEFAULTS.START_DELAY_MS, jobId: `start-${battle.id}` });
  const out = { battleId: battle.id, placed: fill.placed, title };
  if (group) return { ...out, seated: seats.map((s) => s.userId), noAgent };
  global.io?.to(`user:${learnerId}`).emit("join_battle_room", { battleId: battle.id });
  return out;
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
export async function checkResults(battleId, learnerId = null) {
  const [{ data: battle }, { data: questions }, { data: seats }] = await Promise.all([
    db.from("battles").select("id, battle_type, topic, subject, total_questions, study_prep_topic_id, status").eq("id", battleId).maybeSingle(),
    db.from("battle_questions").select("id, question_order, question_text, topic, correct_answer_index, explanation").eq("battle_id", battleId).order("question_order", { ascending: true }),
    db.from("battle_participants").select("id, user_id, role").eq("battle_id", battleId),
  ]);
  if (!battle || battle.battle_type !== "check") return null;
  // A class review has a seat per learner: theirs, else the (only) one.
  const seat = (seats || []).find((s) => s.role !== "teacher" && (!learnerId || s.user_id === learnerId));
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
 * §7.15.1 signals from a finished Agent Check: each seat's per-question tags,
 * time to answer and confusion pairs, through the one recorder
 * (adaptive-learning/question-signals.js). Idempotent; never throws.
 * → [{ learnerId, recorded }]
 */
export async function recordCheckQuestionSignals(battleId) {
  try {
    const [{ data: battle }, { data: questions }, { data: seats }] = await Promise.all([
      db.from("battles").select("id, battle_type, topic, subject").eq("id", battleId).maybeSingle(),
      db.from("battle_questions").select("id, question_order, question_text, options_json, topic, correct_answer_index, time_limit_seconds, skill, format").eq("battle_id", battleId).order("question_order", { ascending: true }),
      db.from("battle_participants").select("id, user_id, role").eq("battle_id", battleId),
    ]);
    if (!battle || battle.battle_type !== "check" || !questions?.length) return [];
    const { checkQuestionSignals, recordQuestionSignals } = await import("../adaptive-learning/question-signals.js");
    const out = [];
    for (const seat of (seats || []).filter((s) => s.role !== "teacher" && s.user_id)) {
      const { data: answers } = await db.from("battle_answers").select("question_id, selected_index, is_correct, answer_basis, response_time_ms").eq("participant_id", seat.id);
      const r = await recordQuestionSignals({
        learnerId: seat.user_id, source: "agent_check", sessionRef: `check:${battleId}`, subject: battle.subject, topic: battle.topic,
        questions: checkQuestionSignals({ battle, questions, answers: answers || [] }),
      });
      out.push({ learnerId: seat.user_id, recorded: r.recorded });
    }
    return out;
  } catch (e) {
    console.warn("[agent-check] question signals:", e?.message || e);
    return [];
  }
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
