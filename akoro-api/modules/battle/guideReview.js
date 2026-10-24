/**
 * battle/guideReview.js — a review with the teaching guide, requested by the
 * student (reference/Akoro Battles — Model.md, 2026-10-24).
 *
 * You never battle a teacher or the guide: when they are involved it is a
 * Review. A student asks for one (typically at the end of a teaching
 * session) and it runs at once, on the Agent Check machinery
 * (battle/agentCheck.js): the guide asks questions on what was taught, the
 * student's PROTÉGÉ answers only from its notes, and the result is a mark
 * sheet. No HP, no winner, no XP; it goes straight to the guide (no teacher
 * approval). The platform pays for the questions, so a learner may request
 * GUIDE_REVIEWS_PER_DAY a day (default 5).
 */
import db from "../../db.js";
import { createCheckBattle } from "./agentCheck.js";

export const GUIDE_REVIEW = Object.freeze({
  QUESTIONS: 8,
  SECONDS_PER_QUESTION: 25,
  PER_DAY: Math.max(1, Number(process.env.GUIDE_REVIEWS_PER_DAY) || 5),
});

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** PURE: a part of a session (a string or { name | title | label }) → its name. */
export const partName = (p) => String(p?.name || p?.title || p?.label || p?.topic || (typeof p === "string" ? p : "")).trim();

/** PURE: what the questions are generated on: the topic, narrowed to the parts taught. */
export function reviewFocus(topic, parts = []) {
  const names = [...new Set((parts || []).map(partName).filter(Boolean))].slice(0, 4);
  return names.length ? `${topic} (${names.join(", ")})`.slice(0, 180) : String(topic).slice(0, 180);
}

/** The session being reviewed, if it is the learner's. → { topic, subject, parts } | null */
async function sessionOf(learnerId, sessionId) {
  if (!sessionId) return null;
  const { data } = await db.schema("edu").from("adaptive_sessions")
    .select("id, student_id, topic, subject, subtopics").eq("id", sessionId).maybeSingle();
  if (!data || data.student_id !== learnerId) throw fail("That teaching session isn't yours.", 403);
  return { topic: data.topic, subject: data.subject, parts: Array.isArray(data.subtopics) ? data.subtopics : [] };
}

/** How many guide reviews this learner asked for in the last 24 hours. */
async function usedToday(learnerId) {
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await db.from("battles").select("id", { count: "exact", head: true })
    .eq("requested_by", learnerId).eq("review_host", "guide").gte("created_at", since);
  return count ?? 0;
}

/**
 * Ask the guide for a review. From a teaching session (sessionId), or on a
 * subject + topic. → { battleId, title, questions, topic, subject, left }
 */
export async function requestGuideReview({ learnerId, sessionId = null, subject = null, topic = null }) {
  if (!learnerId) throw fail("Sign in first.", 401);
  const session = await sessionOf(learnerId, sessionId);
  const t = String(session?.topic || topic || "").trim();
  const s = String(session?.subject || subject || "").trim();
  if (!t || !s) throw fail("Which topic should the review cover? Pick a teaching session, or a subject and topic.");
  const used = await usedToday(learnerId);
  if (used >= GUIDE_REVIEW.PER_DAY) throw fail(`You've had ${GUIDE_REVIEW.PER_DAY} reviews with your guide today. Try again tomorrow.`, 429);

  const made = await createCheckBattle({
    learnerId, subject: s, topic: reviewFocus(t, session?.parts),
    total: GUIDE_REVIEW.QUESTIONS, secondsPerQuestion: GUIDE_REVIEW.SECONDS_PER_QUESTION,
    title: `Review: ${t}`,
    extra: { review_host: "guide", requested_by: learnerId, teaching_session_id: session ? sessionId : null },
  });
  return { ...made, questions: made.placed, topic: t, subject: s, left: GUIDE_REVIEW.PER_DAY - used - 1 };
}
