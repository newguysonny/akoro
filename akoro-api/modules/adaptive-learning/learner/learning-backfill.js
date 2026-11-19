/**
 * adaptive-learning/learner/learning-backfill.js — Phase 4a slice 4 (§7.8.1, D37):
 * the one-off backfill. History that lived only in teaching sessions' JSON
 * (adaptive_sessions.teaching_evidence) and in exam-prep runs goes through
 * the ONE recorder (recordLearningEvent, source "backfill"), so breakthroughs
 * and the anonymous pattern (D36) start with history, not empty.
 *
 *   teachingSessionEvents(session)        PURE: a session row → recorder inputs
 *   examPrepRunEvents(run, attempts)      PURE: a run + its attempts → recorder inputs
 *   backfillLearningEvidence({ learnerId?, sessionIds?, runIds?, before?, limit?, dryRun? })
 *     → { sessions, runs, events, recorded, skipped: { reason: n } }
 *
 * Idempotent: every event's session + turn reference is derived from the
 * source row (backfill:teaching:<id> / backfill:exam-prep:<runId>, p<i> / a<n>),
 * and the recorder writes each (learner, session, turn, concept) once — a
 * re-run adds no evidence row and no struggle attempt.
 *
 * Mapping (mirrors what the live paths record today):
 *   teaching  a must-know part left with an unresolved misconception →
 *             misconception_detected (checked: it opens a struggle); a part
 *             verified → demonstrated_understanding, ledger only (not_checked).
 *             A repair can't be told apart afterwards, so none is invented.
 *   exam prep each scored attempt → assessment_result when it reached the
 *             run's pass mark, else partial_understanding — ledger only, the
 *             same rows Study Prep writes live (study-prep/store.js).
 *
 * `before` (default: when live recording started) keeps rows the live
 * recorder already covers out of the backfill.
 */
import db from "../../../db.js";

/** Live recording (slice 1) began here; rows updated later were recorded as they happened. */
export const LIVE_RECORDING_SINCE = "2026-11-06T00:00:00Z";
export const BACKFILL_SOURCE = "backfill";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const label = (part) => clip(typeof part === "string" ? part : (part?.name || part?.title || part?.label || part?.concept || ""), 160);
const n01 = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(1, Number(n))) : null);

/** PURE: one teaching session row → the recorder inputs it stands for. */
export function teachingSessionEvents(session) {
  const learnerId = session?.student_id;
  const concepts = Array.isArray(session?.teaching_evidence?.concepts) ? session.teaching_evidence.concepts : [];
  if (!learnerId || !session?.id || !concepts.length) return [];
  const topic = clip(session.topic, 160);
  const parts = Array.isArray(session.subtopics) ? session.subtopics : [];
  const observedAt = session.completed_at || session.updated_at || session.created_at || null;
  const sessionRef = `backfill:teaching:${session.id}`;
  const out = [];
  concepts.forEach((c, i) => {
    if (!c || typeof c !== "object" || !(Number(c.attempts) > 0)) return;
    const part = label(parts[i]) || null;
    const base = { learnerId, subject: clip(session.subject, 80) || null, topics: [part, topic].filter(Boolean), source: BACKFILL_SOURCE,
      sessionRef, observedAt, details: { backfill: "teaching_evidence", adaptiveSessionId: session.id, part, mustKnowIndex: i } };
    if (c.unresolvedMisconception === true) {
      out.push({ ...base, kind: "misconception_detected", turnRef: `p${i}:misconception_detected`, quality: null, checked: true,
        summary: `Backfill (teaching): a misconception about ${part || topic} was left unresolved` });
    }
    if (c.masteryStatus === "verified") {
      out.push({ ...base, kind: "demonstrated_understanding", turnRef: `p${i}:verified`, quality: n01(c.learnerMastery), checked: false,
        summary: `Backfill (teaching): ${part || topic} was taught and verified` });
    }
  });
  return out;
}

/** PURE: one exam-prep run and its attempts → the recorder inputs. */
export function examPrepRunEvents(run, attempts = []) {
  const learnerId = run?.learner_id;
  if (!learnerId || !run?.id) return [];
  const pass = Number.isFinite(Number(run.pass_threshold)) ? Number(run.pass_threshold) : 0.7;
  const base = { learnerId, subject: clip(run.subject, 80) || null, topics: [clip(run.topic, 160)].filter(Boolean), source: BACKFILL_SOURCE,
    sessionRef: `backfill:exam-prep:${run.id}`, checked: false };
  const scored = (attempts || []).filter((a) => a && a.score != null && Number.isFinite(Number(a.score)))
    .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number));
  const rows = scored.length ? scored.map((a) => ({ n: Number(a.attempt_number), score: Number(a.score), at: a.submitted_at || a.created_at || null, kind: a.kind }))
    : (run.last_score != null && Number.isFinite(Number(run.last_score)) ? [{ n: null, score: Number(run.last_score), at: run.completed_at || run.updated_at || null, kind: null }] : []);
  return rows.map((r) => {
    const passed = r.score >= pass;
    return { ...base, kind: passed ? "assessment_result" : "partial_understanding",
      turnRef: r.n != null ? `a${r.n}:attempt` : "last:attempt", quality: n01(r.score), observedAt: r.at,
      summary: `Backfill (exam prep): ${r.kind || "attempt"} ${passed ? "passed" : "below the pass mark"}, score ${Math.round(r.score * 100)}%`,
      details: { backfill: "exam_prep_run", runId: run.id, attempt: r.n, passThreshold: pass } };
  });
}

/** One input through the recorder: the finer label first, then the broader one. */
async function recordOne(record, input) {
  const { topics, ...rest } = input;
  let last = { recorded: false, reason: "no_approved_concept" };
  for (const topic of topics.length ? topics : [null]) {
    last = await record({ ...rest, topic });
    if (last.recorded || last.reason !== "no_approved_concept") return last;
  }
  return last;
}

const PAGE = 100;

export async function backfillLearningEvidence({
  learnerId = null, sessionIds = null, runIds = null, before = LIVE_RECORDING_SINCE,
  limit = 2000, dryRun = false, teaching = true, examPrep = true, record = null, client = db,
} = {}) {
  const recorder = record || (await import("./learning-events.js")).recordLearningEvent;
  const stats = { sessions: 0, runs: 0, events: 0, recorded: 0, skipped: {} };
  const skip = (reason) => { stats.skipped[reason] = (stats.skipped[reason] || 0) + 1; };
  const E = () => client.schema("edu");
  const run = async (inputs) => {
    stats.events += inputs.length;
    if (dryRun) return;
    for (const input of inputs) {
      const r = await recordOne(recorder, input);
      if (r.recorded) stats.recorded += 1; else skip(r.reason || "not_recorded");
    }
  };

  if (teaching && !(runIds && !sessionIds)) {
    for (let from = 0; stats.sessions < limit; from += PAGE) {
      let q = E().from("adaptive_sessions").select("id, student_id, topic, subject, subtopics, teaching_evidence, created_at, updated_at, completed_at");
      if (learnerId) q = q.eq("student_id", learnerId);
      if (sessionIds) q = q.in("id", sessionIds);
      if (before) q = q.lt("updated_at", before);
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) { skip(`teaching_read_failed: ${String(error.message).slice(0, 80)}`); break; }
      for (const s of data || []) {
        if (stats.sessions >= limit) break;
        stats.sessions += 1;
        await run(teachingSessionEvents(s));
      }
      if (!data || data.length < PAGE) break;
    }
  }

  if (examPrep && !(sessionIds && !runIds)) {
    for (let from = 0; stats.runs < limit; from += PAGE) {
      let q = E().from("learner_exam_prep_runs").select("id, learner_id, topic, subject, pass_threshold, last_score, created_at, updated_at, completed_at");
      if (learnerId) q = q.eq("learner_id", learnerId);
      if (runIds) q = q.in("id", runIds);
      if (before) q = q.lt("updated_at", before);
      const { data, error } = await q.order("id").range(from, from + PAGE - 1);
      if (error) { skip(`exam_prep_read_failed: ${String(error.message).slice(0, 80)}`); break; }
      const ids = (data || []).map((r) => r.id);
      const { data: attempts } = ids.length
        ? await E().from("learner_exam_prep_attempts").select("run_id, attempt_number, kind, score, submitted_at, created_at").in("run_id", ids)
        : { data: [] };
      for (const r of data || []) {
        if (stats.runs >= limit) break;
        stats.runs += 1;
        await run(examPrepRunEvents(r, (attempts || []).filter((a) => a.run_id === r.id)));
      }
      if (!data || data.length < PAGE) break;
    }
  }
  return stats;
}
