/**
 * teaching-session/context.js — restores a teaching session's context before
 * the orchestrator is created: continuation (previous transcript + position)
 * and decay review (the tail of the last lesson on the topic).
 *
 * Extracted from the WebSocket shell (2026-10-03) into the study-prep
 * service pattern. Every loader degrades to empty context on failure — a
 * missing history must never fail a session start.
 */
import db from "../../../db.js";
import { isMissingColumn } from "./lifecycle.js";

// How much of a prior transcript a new session row carries forward. Without
// the carry, a continuation's row held only its OWN turns — continue once and
// you saw the previous lesson faded; continue AGAIN and the first lesson was
// gone. The tail is kept (newest blocks always included) so chains stay
// bounded no matter how many times a learner continues.
export const CARRY_BLOCK_CAP = 80;

export function carryForward(priorBlocks, openingBlocks) {
  if (!Array.isArray(priorBlocks) || !priorBlocks.length) return openingBlocks;
  const carry = priorBlocks
    .filter(b => b && typeof b === "object" && b.type !== "system-divider")
    .map(b => ({ ...b, faded: true }));
  return [...carry.slice(-CARRY_BLOCK_CAP), ...openingBlocks];
}

/**
 * Continuation: load the previous session's transcript + position.
 * Ownership belongs in this query (the id comes from the browser), never in
 * client-side navigation state. Returns everything the socket handler and the
 * orchestrator need: faded UI blocks, raw agent-memory blocks, resume
 * position and the compact teaching evidence.
 */
export async function loadContinuationContext({ studentId, prevSessionId }) {
  const empty = { historyBlocks: [], priorBlocks: [], resumeFrom: null, resumeTeachingEvidence: null };
  if (!studentId || !prevSessionId) return empty;
  try {
    let { data: prevSession, error: continuationError } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history, updated_at, completed_at, current_subtopic_idx, current_phase, teaching_evidence")
      .eq("id", prevSessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    // Compatibility with API/schema caches while the migration rolls
    // out. This does not weaken ownership filtering.
    if (continuationError && isMissingColumn(continuationError, "teaching_evidence")) {
      ({ data: prevSession, error: continuationError } = await db.schema("edu")
        .from("adaptive_sessions")
        .select("block_history, updated_at, completed_at, current_subtopic_idx, current_phase")
        .eq("id", prevSessionId)
        .eq("student_id", studentId)
        .maybeSingle());
    }
    if (continuationError) throw continuationError;
    if (!prevSession) return empty;

    // The position, not just the transcript. Loading only the words
    // meant a continuation showed the previous lesson greyed out and
    // then began teaching subtopic 1 again.
    const savedPhase = String(prevSession.current_phase || "1").toUpperCase().replace(/^PHASE_/, "");
    const resumeFrom = {
      subtopicIdx: Number(prevSession.current_subtopic_idx) || 0,
      phase: savedPhase === "MASTERY" ? "MASTERY" : `PHASE_${savedPhase}`,
    };
    const resumeTeachingEvidence = prevSession.teaching_evidence || null;

    let historyBlocks = [];
    let priorBlocks = [];
    if (prevSession?.block_history?.length) {
      const completedAt = prevSession.completed_at || prevSession.updated_at;
      const daysSince   = Math.max(0, Math.round(
        (Date.now() - new Date(completedAt).getTime()) / 86_400_000
      ));
      historyBlocks = [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...prevSession.block_history.map(b => ({ ...b, faded: true })),
      ];
      // The transcript shown faded above is also the agent's memory:
      // without this the continuation looked connected but the agent
      // itself had forgotten every word of the previous lesson.
      priorBlocks = Array.isArray(prevSession.block_history)
        ? prevSession.block_history
        : [];
    }
    return { historyBlocks, priorBlocks, resumeFrom, resumeTeachingEvidence };
  } catch (e) {
    console.warn("[teaching-session] history load failed:", e.message);
    return empty;
  }
}

/**
 * Decay review: the tail of the most recent lesson on this topic becomes the
 * agent's conversational memory, and the modal shows it faded. A review
 * resumes the relationship, not just the topic health. Failure here degrades
 * to a context-less review, never a failed session start.
 */
export async function loadDecayPriorLesson({ studentId, topic }) {
  const empty = { historyBlocks: [], priorBlocks: [] };
  if (!studentId || !topic) return empty;
  try {
    const { data: priorRow } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history, updated_at, completed_at")
      .eq("student_id", studentId)
      .ilike("topic", topic)
      .in("status", ["active", "complete"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!Array.isArray(priorRow?.block_history) || !priorRow.block_history.length) return empty;
    const tail = priorRow.block_history
      .filter(b => b && typeof b === "object" && b.type !== "system-divider")
      .slice(-10);
    const completedAt = priorRow.completed_at || priorRow.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));
    return {
      priorBlocks: tail,
      historyBlocks: [
        { type: "system-divider", label: `Last lesson · ${daysSince} days ago` },
        ...tail.map(b => ({ ...b, faded: true })),
      ],
    };
  } catch (e) {
    console.warn("[teaching-session] decay prior-lesson load failed:", e.message);
    return empty;
  }
}
