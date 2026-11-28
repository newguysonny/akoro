/**
 * teaching-session/finalCheck.js — the end-of-session verdict (2026-11-28,
 * Matt's direction): the per-turn evidence scores STEER the conversation
 * (moves, meters, the gate), but they no longer decide whether the learner
 * has learned. When every part has been taught to the per-turn bar, the
 * session does not complete — it runs this Final check: NaNa asks one
 * question per part, the protégé answers ONLY from what it was taught this
 * session, Sergeant judges (assessment.js, unchanged). Each part lands
 * HELD or GAP. A gap loops back: the learner re-teaches that part in the
 * chat, the part is re-checked once, and only then does the session
 * complete — with any surviving gap recorded honestly on the result.
 *
 * State lives on orchestrator.session.finalCheck (live-session state, like
 * the mid-session check cards); the client renders it from `final_check`
 * socket snapshots (the Final check strip above the material strip).
 * Kill switch: AKORO_FINAL_CHECK=off restores the old completion path.
 */
import { MAX_ASSESSMENT_CONCEPTS, runTeachingAssessment } from "./assessment.js";

// The protégé answers the check from its notes — the learner's teaching
// messages. The mid-session check reads only the recent ones (it checks
// what was just taught), but the Final check judges the WHOLE session:
// with the recent-only window, a long session's earliest parts fall out of
// the notes and their answers come back as honest "not from my notes"
// guesses — correct answers marked as gaps (seen live 2026-11-28: parts
// 1–3 of 8 gapped on affirmed-correct answers in a 23-message session).
// The verdict therefore reads the full teaching history.
export const FINAL_CHECK_NOTES_LIMIT = 80;

export const finalCheckEnabled = () => {
  const v = String(process.env.AKORO_FINAL_CHECK || "on").toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
};

/** A fresh check over every part: all rows waiting, nothing judged yet. */
export function createFinalCheck(parts = []) {
  return {
    status: "running", // running | open | reteach | passed | settled
    reteachIndex: null,
    items: parts.map((concept, index) => ({
      index,
      concept: String(concept || ""),
      status: "waiting", // waiting | asking | held | gap | reteaching
      outcome: null, // the assessment's raw outcome (correct | wrong | guessed | guessed_right)
      question: null,
      answer: null,
      note: null,
      rechecks: 0,
    })),
  };
}

const findItem = (fc, concept) => fc.items.find(
  (i) => i.concept.toLowerCase() === String(concept || "").toLowerCase(),
);

/** Client-safe snapshot (the strip renders exactly this). */
export function finalCheckSnapshot(session) {
  const fc = session?.finalCheck;
  if (!fc || !Array.isArray(fc.items)) return null;
  return {
    status: fc.status,
    reteachIndex: fc.reteachIndex ?? null,
    held: fc.items.filter((i) => i.status === "held").length,
    gaps: fc.items.filter((i) => i.status === "gap" || i.status === "reteaching").length,
    total: fc.items.length,
    items: fc.items.map((i) => ({
      index: i.index,
      concept: i.concept,
      status: i.status,
      outcome: i.outcome || null,
      question: i.question || null,
      answer: i.answer || null,
      note: i.note || null,
      rechecks: i.rechecks || 0,
    })),
  };
}

/**
 * Merge one judged batch (assessment.js items) into the check. A part is
 * HELD only when the protégé's answer was correct AND from its notes — a
 * guess never counts (the assessment's own outcome rule). Applying a result
 * to a part that was already a gap counts as that part's re-check.
 */
export function applyAssessmentItems(fc, marked = [], recheckIndexes = new Set()) {
  let applied = 0;
  for (const m of marked) {
    const item = findItem(fc, m.concept);
    if (!item) continue;
    applied += 1;
    if (recheckIndexes.has(item.index)) item.rechecks = (item.rechecks || 0) + 1;
    item.status = m.outcome === "correct" ? "held" : "gap";
    item.outcome = m.outcome || null;
    item.question = m.question ? String(m.question).slice(0, 300) : null;
    item.answer = m.answer ? String(m.answer).slice(0, 400) : null;
    item.note = m.note ? String(m.note).slice(0, 200) : null;
  }
  return applied;
}

/**
 * Run the check over the given concepts, in the assessment's own batch
 * size, reporting progress after each batch so the strip fills in live.
 * `assess` is injectable (tests); production is runTeachingAssessment.
 */
export async function runFinalCheckConcepts({ orchestrator, concepts = [], assess = runTeachingAssessment, onProgress = null }) {
  const fc = orchestrator?.session?.finalCheck;
  if (!fc) return { judged: 0 };
  // The batches judge disjoint parts and never read each other's results —
  // run them in parallel (latency work, 2026-11-28: serial batches made the
  // completing turn wait for three rounds of assessment calls; now ~one).
  const batches = [];
  for (let i = 0; i < concepts.length; i += MAX_ASSESSMENT_CONCEPTS) batches.push(concepts.slice(i, i + MAX_ASSESSMENT_CONCEPTS));
  const runBatch = async (batch) => {
    const prevStatus = new Map();
    for (const concept of batch) {
      const item = findItem(fc, concept);
      if (item && item.status !== "held") { prevStatus.set(item.index, item.status); item.status = "asking"; }
    }
    onProgress?.(finalCheckSnapshot(orchestrator.session));
    try {
      const result = await assess({ orchestrator, concepts: batch, notesLimit: FINAL_CHECK_NOTES_LIMIT });
      // A result applied to a part that was already judged a gap (or is
      // mid-re-teach) is that part's re-check — counted from the status the
      // part carried INTO this run, before "asking" overwrote it.
      const recheckIndexes = new Set(
        [...prevStatus.entries()].filter(([, s]) => s === "gap" || s === "reteaching").map(([idx]) => idx),
      );
      return applyAssessmentItems(fc, result?.items || [], recheckIndexes);
    } catch (e) {
      // A failed batch judges nothing: its parts go back to the status they
      // had rather than sitting at "asking" forever.
      for (const concept of batch) {
        const item = findItem(fc, concept);
        if (item && item.status === "asking") item.status = prevStatus.get(item.index) || "waiting";
      }
      console.warn("[final-check] batch failed:", e?.message || e);
      return 0;
    } finally {
      onProgress?.(finalCheckSnapshot(orchestrator.session));
    }
  };
  const counts = await Promise.all(batches.map(runBatch));
  return { judged: counts.reduce((a, b) => a + b, 0) };
}

/**
 * passed  — every part held.
 * settled — every part is held or a gap that has had its re-check; the
 *           session may complete with the surviving gaps recorded.
 * open    — a part is still undecided (waiting / asking / reteaching) or a
 *           gap has not had its re-teach + re-check yet.
 */
export function finalCheckResolution(fc) {
  if (!fc?.items?.length) return "open";
  if (fc.items.every((i) => i.status === "held")) return "passed";
  const undecided = fc.items.some((i) => i.status === "waiting" || i.status === "asking" || i.status === "reteaching");
  const actionable = fc.items.some((i) => i.status === "gap" && (i.rechecks || 0) < 1);
  if (!undecided && !actionable) return "settled";
  return "open";
}

/** The learner tapped Re-teach on a gap: that part goes back into teaching. */
export function beginFinalCheckReteach(fc, index) {
  const item = fc?.items?.find((i) => i.index === index);
  if (!fc || !item || item.status !== "gap") return false;
  item.status = "reteaching";
  fc.status = "reteach";
  fc.reteachIndex = index;
  return true;
}

/** A re-teach landed (the part met the per-turn bar again): ready to re-check. */
export function finalCheckReteachReady(fc) {
  if (!fc || fc.status !== "reteach" || !Number.isInteger(fc.reteachIndex)) return null;
  return fc.items.find((i) => i.index === fc.reteachIndex) || null;
}

export function finishFinalCheck(fc, resolution) {
  fc.status = resolution === "passed" ? "passed" : "settled";
  fc.reteachIndex = null;
  return fc;
}
