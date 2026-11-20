/**
 * modules/self-study/draft-questions.js — the questions a battle or a review
 * battle asks, prepared on the draft before anything is assigned.
 */

import { invalid } from "./createAssignment.js";
import { updateDraftPayload } from "./draftVersions.js";
import { getActivityDraft } from "./draft-records.js";

/**
 * A battle draft's real questions — archive first, AI tops up, as the battle
 * would draw them (battle/questionSource.js collectQuestions). The battle made
 * from the draft places exactly these (battle routes: draft_id). A failure (no
 * coins, nothing on the topic) leaves none and says why; the battle then draws
 * its own when it's created, as before.
 */
export async function draftBattleQuestions(instructor, payload, keep = []) {
  const d = payload.details || {};
  const total = d.total_questions || 10;
  try {
    const { collectQuestions, presetQuestions } = await import("../battle/index.js");
    const topic = d.topic || payload.topic || null;
    const out = await Promise.race([
      // `keep`: questions already on the draft — kept first, in order; only the rest are written.
      collectQuestions({ source: "auto", total, subject: payload.subject || "General", topic,
        difficulty: payload.difficulty || "intermediate", userId: instructor.id, onTopic: true, have: presetQuestions(keep, topic) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("took too long")), 60_000)),
    ]);
    const questions = (out.questions || []).map((q) => ({ stem: q.stem, options: q.options, correctIndex: q.correctIndex, topic: q.topic || null,
      ...(q.explanation ? { explanation: q.explanation } : {}), ...(q.exam ? { exam: q.exam, year: q.year ?? null } : {}) }));
    return { questions, questions_note: questions.length < 5 ? `Only ${questions.length} questions could be prepared — the battle tops up the rest when it's created.` : null };
  } catch (e) {
    return { questions: [], questions_note: /coin/i.test(String(e?.message)) ? "Not enough coins to write the questions yet — top up, and they're written when the battle is created." : "The questions couldn't be prepared right now — the battle draws its own when it's created." };
  }
}

/**
 * The review battle's questions for a self study or assignment draft — written
 * when the instructor turns the review on (or changes how many), on the
 * activity's topic and concepts, the same way a battle draft's are. Saved on
 * the draft (payload.review_questions); assigning it carries them into the
 * review battle, which asks exactly these.
 */
export async function prepareReviewQuestions(instructor, id, count) {
  const draft = await getActivityDraft(instructor, id);
  if (!["self_study", "assignment", "project"].includes(draft.type)) throw invalid("Only a self study or an assignment has a review battle", 400);
  if (draft.status !== "draft") throw invalid("Only pending drafts can be changed", 409);
  const { REVIEW_LIMITS } = await import("./activityReview.js");
  const { reviewFocus } = await import("../battle/index.js");
  const p = draft.payload || {};
  const n = Math.min(REVIEW_LIMITS.MAX_Q, Math.max(REVIEW_LIMITS.MIN_Q, Math.round(Number(count) || REVIEW_LIMITS.DEFAULT_Q)));
  const topic = reviewFocus(p.topic || draft.title, Array.isArray(p.subtopics) ? p.subtopics : []);
  // The questions the instructor has already seen stay: fewer → the first n (the rest kept
  // aside for going back up), more → those plus only the extra ones written. A new topic starts over.
  const was = p.review_questions?.topic === topic ? [...(p.review_questions.items || []), ...(p.review_questions.spare || [])] : [];
  const out = was.length >= n ? { questions: was, questions_note: null }
    : await draftBattleQuestions(instructor, { subject: p.subject, difficulty: p.difficulty, details: { topic, total_questions: n } }, was);
  const all = out.questions.length ? out.questions : was;
  const review_questions = { count: n, topic, items: all.slice(0, n), spare: all.slice(n), note: out.questions_note, at: new Date().toISOString() };
  await updateDraftPayload(draft.id, (pp, row) => (row.status !== "draft" ? null : { ...pp, review_questions }));
  return review_questions;
}
