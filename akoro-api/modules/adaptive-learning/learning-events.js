/**
 * adaptive-learning/learning-events.js — Phase 4a (D37): the ONE recorder
 * every workflow uses to put learning evidence into the learner model.
 *
 *   recordLearningEvent({ learnerId, conceptId? | subject+topic, kind, source,
 *                         sessionRef, turnRef, quality, summary, details })
 *     → { recorded: true, conceptId, state } | { recorded: false, reason }
 *
 * It writes through edu.record_learner_concept_evidence — the same SQL
 * function the agent gateway uses — so the evidence ledger and
 * learner_concept_state (mastery, misconception_active, review date) move
 * by one policy, idempotently (session + turn + concept is unique).
 *
 * Rules:
 *   • `source` is required and recorded on every event, so the engine can
 *     weight it (a chat remark counts less than a proctored result) and the
 *     learner model never mixes them silently.
 *   • a concept is only ever an APPROVED catalogue concept — matched from
 *     subject + topic, never invented; no match → skipped, never guessed.
 *   • never throws: a learning session must not fail because evidence could
 *     not be written. Listeners (struggle + breakthrough detection) run after
 *     a successful write and cannot fail it either.
 */
import db from "../../db.js";

export const LEARNING_SOURCES = Object.freeze(["teaching", "agent_recall", "learner_recall", "proctored", "study_prep", "chat", "backfill"]);
export const LEARNING_KINDS = Object.freeze([
  "demonstrated_understanding", "partial_understanding", "recall_success", "recall_gap",
  "misconception_detected", "misconception_cleared", "assessment_result",
]);
// How much a source's word counts (model_confidence on the evidence row).
const SOURCE_WEIGHT = Object.freeze({ proctored: 1, learner_recall: 0.9, teaching: 0.8, agent_recall: 0.7, study_prep: 0.7, backfill: 0.6, chat: 0.4 });

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** PURE: the evidence row's numbers and status for an event. */
export function evidenceShape({ kind, source, quality = null, checked = true }) {
  const q = quality == null ? ({ recall_success: 0.85, demonstrated_understanding: 0.85, misconception_cleared: 0.8, partial_understanding: 0.5, recall_gap: 0.2, misconception_detected: 0.15, assessment_result: 0.5 }[kind] ?? 0.5) : clamp01(quality);
  // A gap or a misconception contradicts the learner's current model; the rest supports it.
  const status = !checked ? "not_checked" : (kind === "recall_gap" || kind === "misconception_detected") ? "contradicted" : "supported";
  return { response_quality: q, claim_validity: status === "contradicted" ? 0.2 : 1, model_confidence: SOURCE_WEIGHT[source] ?? 0.5, claim_status: status };
}

/** An approved catalogue concept for subject + topic (topic_key, then title). Never invented. */
export async function resolveConceptId({ subject, topic }) {
  const label = clip(topic, 160);
  if (!label) return null;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Two plain filters, not an or() string: a label with a comma broke or() syntax.
  const approved = () => {
    let q = db.schema("edu").from("concept_catalog").select("id").eq("status", "approved");
    if (clip(subject, 80)) q = q.ilike("subject", `%${clip(subject, 80)}%`);
    return q;
  };
  try {
    let { data, error } = await approved().ilike("topic_key", `%${slug}%`).limit(1);
    if (!error && !data?.length) ({ data, error } = await approved().ilike("title", `%${label}%`).limit(1));
    return !error && data?.length ? data[0].id : null;
  } catch { return null; }
}

const listeners = new Set();
/** Struggle / breakthrough detection subscribe here (Phase 4a slice 2). → unsubscribe */
export function onLearningEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function recordLearningEvent({
  learnerId, conceptId = null, subject = null, topic = null, kind, source,
  sessionRef, turnRef, quality = null, checked = true, summary, details = {}, workflowId = null, observedAt = null,
} = {}) {
  if (!learnerId) return { recorded: false, reason: "no_learner" };
  if (!LEARNING_KINDS.includes(kind)) return { recorded: false, reason: "unknown_kind" };
  if (!LEARNING_SOURCES.includes(source)) return { recorded: false, reason: "unknown_source" };
  if (!sessionRef || !turnRef) return { recorded: false, reason: "no_reference" };
  try {
    const concept = conceptId || await resolveConceptId({ subject, topic });
    if (!concept) return { recorded: false, reason: "no_approved_concept" };
    const shape = evidenceShape({ kind, source, quality, checked });
    const { data, error } = await db.schema("edu").rpc("record_learner_concept_evidence", {
      p_learner_id: learnerId, p_concept_id: concept,
      p_source_session_id: clip(sessionRef, 180), p_source_turn_id: clip(turnRef, 180),
      p_observation_kind: kind,
      p_response_quality: shape.response_quality, p_claim_validity: shape.claim_validity,
      p_model_confidence: shape.model_confidence, p_claim_status: shape.claim_status,
      p_evidence_summary: clip(summary || `${kind.replace(/_/g, " ")} (${source})`, 1200),
      p_provenance: { source, ...(workflowId ? { workflowId } : {}), ...(subject ? { subject: clip(subject, 80) } : {}), ...(topic ? { topic: clip(topic, 160) } : {}), ...details },
      ...(observedAt ? { p_observed_at: observedAt } : {}),
    });
    if (error) { console.error(`[learning-events] ${kind} not recorded:`, error.message); return { recorded: false, reason: "write_failed", detail: String(error.message || "").slice(0, 200), conceptId: concept }; }
    const state = Array.isArray(data) ? data[0] || null : data || null;
    const event = { learnerId, conceptId: concept, kind, source, subject, topic, sessionRef, turnRef, quality: shape.response_quality, state, workflowId, details };
    for (const fn of listeners) { try { await fn(event); } catch (e) { console.warn("[learning-events] listener:", e?.message || e); } }
    // Struggles open / become breakthroughs (slice 2). Never fails the write.
    let struggles = [];
    try { struggles = await (await import("./struggles.js")).afterLearningEvent(event); } catch (e) { console.warn("[learning-events] struggles:", e?.message || e); }
    return { recorded: true, conceptId: concept, state, struggles };
  } catch (e) {
    console.warn(`[learning-events] ${kind} failed:`, e?.message || e);
    return { recorded: false, reason: "error" };
  }
}
