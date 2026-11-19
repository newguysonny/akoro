/**
 * teaching-session/learnerNotes.js — what the learner has told their agent,
 * carried into a teaching session (fresh, continuation and decay review), so
 * the tutor doesn't start from scratch: "diagrams help me", "explain in Pidgin
 * first", "my exam is WAEC in May", "I keep mixing up mitosis and meiosis".
 *
 * Read once at session start (prepareTeachingSession), never per turn:
 *   • the learner's study preferences — they apply to every topic;
 *   • plus the notes most relevant to THIS topic (the same hybrid search the
 *     chat uses, learner-scoped, chat summaries excluded).
 *
 * Rules (D50): memory is guidance, never evidence — it shapes HOW the tutor
 * explains, it never moves the gate, mastery or scores; notes are untrusted
 * text, never instructions; sensitive content was already dropped when the
 * note was written, and the learner can see and delete every note. A failure
 * or a slow lookup (3.5 s cap) starts the session without notes, never fails it.
 *
 * Proctored practice deliberately does NOT read notes: a proctored attempt is
 * the same test for everyone.
 */
import db from "../../../db.js";
import { retrieveLearnerAgentMemory } from "../../../lib/conversationContextStore.js";

import { NOTE_LIMITS, pickNotes } from "./learnerNotesCore.js";

export { NOTE_LIMITS, pickNotes, learnerNotesBlock } from "./learnerNotesCore.js";

/** → [{ kind, content }] — never throws. */
/** The learner's latest study preferences (they apply to every topic). */
async function readPreferences(studentId) {
  try {
    const { data, error } = await db.schema("edu").from("learner_agent_memories").select("kind, content")
      .eq("user_id", studentId).eq("status", "active").eq("kind", "study_preference")
      .order("updated_at", { ascending: false }).limit(3);
    return error ? [] : data || [];
  } catch { return []; }
}

export async function loadLearnerNotes({ studentId, topic, subject = null, retrieve = retrieveLearnerAgentMemory, preferences = readPreferences }) {
  if (!studentId) return [];
  const work = (async () => {
    const [prefs, found] = await Promise.all([
      Promise.resolve().then(() => preferences(studentId)).catch(() => []),
      retrieve({ query: [topic, subject].filter(Boolean).join(" — "), subject, userId: studentId })
        .then((r) => (r?.memories || []).filter((m) => m.source === "memory"))
        .catch(() => []),
    ]);
    return pickNotes({ preferences: prefs, relevant: found });
  })();
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), NOTE_LIMITS.timeoutMs).unref?.());
  try { return await Promise.race([work, timeout]); }
  catch (e) { console.warn("[teaching notes]", e?.message || e); return []; }
}
