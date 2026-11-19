/**
 * adaptive-learning/strategies/outcomes.js — Phase 4a slice 3 (§7.7, §7.7.1
 * step 6, D37): how a strategy turned out, stored once per use with its
 * version, so breakthroughs know WHAT WORKED and the anonymous pattern (D36)
 * can rank strategies.
 *
 *   recordStrategyOutcome({ learnerId, strategyId, outcome, workflow, sessionRef,
 *                           turnRef?, conceptId? | subject+topic, struggleType?,
 *                           scoreBefore?, scoreAfter?, source?, details? })
 *     → { recorded: true, id, duplicate } | { recorded: false, reason }
 *   outcomeRefusal(input)          PURE: why an outcome may not be recorded
 *   strategyThatWorked({ learnerId, conceptId, sessionRef })
 *     → the strategy credited when a struggle resolves in that session, or null
 *
 * Rules: the strategy must be in the library and allowed in the workflow it
 * ran in; the outcome one of STRATEGY_OUTCOMES; a struggle type (if given)
 * from the taxonomy. Idempotent per learner + session + turn + strategy (a
 * replay adds nothing). A strategy that ran is added to strategies_tried on
 * the learner's open struggles for that concept. Never throws.
 */
import db from "../../../db.js";
import { LIBRARY_VERSION, STRATEGY_OUTCOMES, STRATEGY_WORKFLOWS, getStrategy } from "./library.js";
import { struggleType as struggleTypeDef } from "../../../lib/struggleTypes.js";

const E = () => db.schema("edu");
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, n) : null; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));

/** PURE: null when the outcome may be recorded, else the reason. */
export function outcomeRefusal({ learnerId, strategyId, outcome, workflow, sessionRef, struggleType = null } = {}) {
  if (!learnerId) return "no_learner";
  const s = getStrategy(strategyId);
  if (!s) return "unknown_strategy";
  if (!STRATEGY_OUTCOMES.includes(outcome)) return "unknown_outcome";
  if (!STRATEGY_WORKFLOWS.includes(workflow)) return "unknown_workflow";
  if (!s.workflows.includes(workflow)) return "strategy_not_permitted";
  if (!clip(sessionRef, 180)) return "no_reference";
  if (struggleType && !struggleTypeDef(struggleType)) return "unknown_struggle_type";
  return null;
}

export async function recordStrategyOutcome({
  learnerId, strategyId, outcome, workflow, sessionRef, turnRef = "outcome",
  conceptId = null, subject = null, topic = null, struggleType = null,
  scoreBefore = null, scoreAfter = null, source = "live", details = {},
} = {}) {
  const why = outcomeRefusal({ learnerId, strategyId, outcome, workflow, sessionRef, struggleType });
  if (why) return { recorded: false, reason: why };
  const s = getStrategy(strategyId);
  try {
    let concept = conceptId;
    if (!concept && topic) {
      const { resolveConceptId } = await import("../learner/learning-events.js");
      concept = await resolveConceptId({ subject, topic });
    }
    const row = {
      learner_id: learnerId, concept_id: concept || null, subject: clip(subject, 120), topic_label: clip(topic, 200),
      strategy_id: s.id, strategy_version: s.version, library_version: LIBRARY_VERSION,
      workflow, outcome, struggle_type: struggleType || null,
      score_before: num(scoreBefore), score_after: num(scoreAfter),
      session_ref: clip(sessionRef, 180), turn_ref: clip(turnRef, 180) || "outcome",
      source: source === "backfill" ? "backfill" : "live",
      details: details && typeof details === "object" && !Array.isArray(details) ? details : {},
    };
    const { data, error } = await E().from("learning_strategy_outcomes")
      .upsert(row, { onConflict: "learner_id,session_ref,turn_ref,strategy_id", ignoreDuplicates: true }).select("id");
    if (error) {
      console.warn("[strategy-outcomes] not recorded:", error.message);
      return { recorded: false, reason: "write_failed", detail: String(error.message || "").slice(0, 200) };
    }
    const id = data?.[0]?.id || null;
    if (id) await noteTried({ learnerId, conceptId: concept || null, struggleType, strategyId: s.id });
    return { recorded: true, id, duplicate: !id, conceptId: concept || null, strategyVersion: s.version };
  } catch (e) {
    console.warn("[strategy-outcomes] failed:", e?.message || e);
    return { recorded: false, reason: "error" };
  }
}

/** The strategy joins strategies_tried on the learner's open struggles it was aimed at. */
async function noteTried({ learnerId, conceptId, struggleType, strategyId }) {
  if (!conceptId && !struggleType) return;
  try {
    let q = E().from("learning_struggles").select("id, strategies_tried").eq("learner_id", learnerId).eq("status", "open");
    if (conceptId) q = q.eq("concept_id", conceptId);
    if (struggleType) q = q.eq("struggle_type", struggleType);
    const { data } = await q.limit(10);
    for (const row of data || []) {
      const tried = row.strategies_tried || [];
      if (tried.includes(strategyId)) continue;
      await E().from("learning_struggles").update({ strategies_tried: [...tried, strategyId].slice(-20), updated_at: new Date().toISOString() }).eq("id", row.id);
    }
  } catch (e) { console.warn("[strategy-outcomes] strategies_tried:", e?.message || e); }
}

/**
 * The strategy to credit when a struggle resolves in this session: the latest
 * one recorded as worked (or partly) for this learner — on this concept or
 * on none in particular. Null when nothing was recorded.
 */
export async function strategyThatWorked({ learnerId, conceptId = null, sessionRef }) {
  if (!learnerId || !sessionRef) return null;
  try {
    let q = E().from("learning_strategy_outcomes").select("strategy_id, concept_id")
      .eq("learner_id", learnerId).eq("session_ref", String(sessionRef).slice(0, 180)).in("outcome", ["worked", "partial"]);
    q = conceptId && UUID.test(conceptId) ? q.or(`concept_id.eq.${conceptId},concept_id.is.null`) : q;
    const { data, error } = await q.order("created_at", { ascending: false }).limit(1);
    return !error && data?.[0] ? data[0].strategy_id : null;
  } catch { return null; }
}

/**
 * PURE: how an accepted strategy turned out, judged from the NEXT attempt
 * (§7.7.1 step 6): passed → worked; a clear gain (≥ 0.1) without passing →
 * partial; otherwise did_not_work. Scores are 0–1.
 */
export function judgeStrategyOutcome({ scoreBefore = null, scoreAfter = null, passed = false } = {}) {
  if (passed) return "worked";
  const after = num(scoreAfter);
  const before = num(scoreBefore);
  if (after != null && before != null && after - before >= 0.1) return "partial";
  return "did_not_work";
}

/** The sources whose events are an attempt that can judge a Study Prep strategy. */
const ATTEMPT_SOURCES = new Set(["study_prep", "agent_recall"]);

/**
 * The recorder calls this after every write: an accepted Study Prep strategy
 * waiting for its result (recorded as `abandoned` + details.pending when it
 * was accepted — if no attempt ever follows, that is what it was) is judged by
 * the next attempt on that topic in the same session. The update is
 * conditional on the row still being pending, so a replay judges nothing
 * twice. → [{ id, strategyId, outcome }]. Never throws.
 */
export async function settlePendingStrategyOutcomes(event) {
  if (!event?.learnerId || !ATTEMPT_SOURCES.has(event.source) || !String(event.sessionRef || "").startsWith("study_prep:")) return [];
  try {
    const { data, error } = await E().from("learning_strategy_outcomes")
      .select("id, strategy_id, concept_id, topic_label, score_before, details, outcome")
      .eq("learner_id", event.learnerId).eq("session_ref", String(event.sessionRef).slice(0, 180)).eq("outcome", "abandoned").limit(20);
    if (error) throw error;
    const topic = String(event.topic || "").trim().toLowerCase();
    const pending = (data || []).filter((r) => r.details?.pending
      && ((event.conceptId && r.concept_id === event.conceptId) || (topic && String(r.topic_label || "").trim().toLowerCase() === topic)));
    const out = [];
    for (const row of pending) {
      const outcome = judgeStrategyOutcome({ scoreBefore: row.score_before, scoreAfter: event.quality, passed: event.kind === "assessment_result" });
      const { data: settled, error: e2 } = await E().from("learning_strategy_outcomes").update({
        outcome, score_after: num(event.quality),
        details: { ...row.details, pending: false, judgedBy: `${event.sessionRef}/${event.turnRef}`.slice(0, 200), judgedAt: new Date().toISOString() },
      }).eq("id", row.id).eq("outcome", "abandoned").select("id");
      if (!e2 && settled?.length) out.push({ id: row.id, strategyId: row.strategy_id, outcome });
    }
    return out;
  } catch (e) {
    console.warn("[strategy-outcomes] settle failed:", e?.message || e);
    return [];
  }
}
