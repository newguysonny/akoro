/**
 * adaptive-learning/learner/learner-model.js — the READ side of the learner model
 * (Grand Plan §7.8, Phase 10). Where a workflow needs "does this learner hold
 * a misconception about X?" or "what should happen next on X?", it asks here,
 * and the answer comes from the central state the one recorder writes
 * (learning-events.js → edu.record_learner_concept_evidence →
 * learner_concept_state.misconception_active) — not from a per-session copy.
 *
 * Read-only: nothing here writes concept state (the contract test
 * learner-model-writes.contract.test.mjs enforces that for the whole repo).
 * Every function degrades to "no central answer" (null / []) on failure: a
 * lesson never fails because the learner model could not be read.
 */
import db from "../../../db.js";
import { resolveConceptId } from "./learning-events.js";
import { recommendNextAction } from "../teaching/adaptive-engine.js";

const E = () => db.schema("edu");
const STATE_COLUMNS = "concept_id, mastery, retention, misconception_active, evidence_count, last_evidence_at, next_review_due";

/** learner_concept_state rows for these concepts → Map(conceptId → row). */
export async function readConceptStates({ learnerId, conceptIds }) {
  const ids = [...new Set((conceptIds || []).filter(Boolean))];
  if (!learnerId || !ids.length) return new Map();
  try {
    const { data, error } = await E().from("learner_concept_state")
      .select(STATE_COLUMNS).eq("learner_id", learnerId).in("concept_id", ids);
    if (error) throw error;
    return new Map((data || []).map((row) => [row.concept_id, row]));
  } catch (e) {
    console.warn("[learner-model] concept state unavailable:", e?.message || e);
    return new Map();
  }
}

/**
 * The central misconception flag for each must-know part of a lesson, matched
 * the way the recorder matches them (the part first, then the lesson topic).
 * → array aligned with `parts`: true / false where the learner model has a
 * state row for the matched concept, null where it has nothing (no approved
 * concept, or no evidence yet) — the caller keeps its own value there.
 */
export async function centralMisconceptionFlags({ learnerId, subject = null, topic = null, parts = [] }) {
  const list = Array.isArray(parts) ? parts.slice(0, 12) : [];
  if (!learnerId || !list.length) return list.map(() => null);
  try {
    const topicConcept = topic ? resolveConceptId({ subject, topic }) : Promise.resolve(null);
    const conceptFor = await Promise.all(list.map(async (part) =>
      (String(part || "").trim() && await resolveConceptId({ subject, topic: part })) || await topicConcept));
    const states = await readConceptStates({ learnerId, conceptIds: conceptFor });
    return conceptFor.map((id) => (id && states.has(id) ? states.get(id).misconception_active === true : null));
  } catch (e) {
    console.warn("[learner-model] misconception flags unavailable:", e?.message || e);
    return list.map(() => null);
  }
}

/** PURE: the misconceptions an embedded learner_concept_state read holds (titles, deduped). */
export function misconceptionTitles(rows, { limit = 8 } = {}) {
  const out = [];
  for (const row of rows || []) {
    if (row?.misconception_active !== true) continue;
    const concept = Array.isArray(row.concept) ? row.concept[0] : row.concept;
    const title = String(concept?.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (title && !out.includes(title)) out.push(title);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The Adaptive Learning Engine's recommendation for one learner + concept,
 * from the central state. → { action, reason, source, conceptId,
 * misconceptionActive, hasState }
 */
export async function recommendForLearner({ learnerId, conceptId, cognitive = null, now = Date.now() }) {
  const state = (await readConceptStates({ learnerId, conceptIds: [conceptId] })).get(conceptId) || null;
  const recommendation = recommendNextAction({ conceptState: state, cognitive, now, hasHistory: Boolean(state) });
  return { ...recommendation, conceptId, misconceptionActive: state?.misconception_active === true, hasState: Boolean(state) };
}

/**
 * The learner's per-question signals (§7.15.1: tags, time to answer, confusion
 * pairs; question-signals.js), newest first, optionally for one subject /
 * topic / concept, summarised per skill and format. → { questions, bySkill,
 * byFormat, confusions, rows } — empty on failure.
 */
export async function readQuestionSignals({ learnerId, subject = null, topic = null, conceptId = null, limit = 200 } = {}) {
  const { summariseQuestionSignals } = await import("../../../lib/questionSignals.js");
  if (!learnerId) return { ...summariseQuestionSignals([]), rows: [] };
  try {
    let q = E().from("learning_question_signals")
      .select("source, session_ref, question_ref, concept_id, subject, topic_label, skill, format, tag_source, time_budget_s, time_to_answer_ms, outcome, score, confused_with, confusion_concept, created_at")
      .eq("learner_id", learnerId);
    if (conceptId) q = q.eq("concept_id", conceptId);
    if (subject) q = q.ilike("subject", String(subject).trim());
    const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.max(1, Math.min(500, limit)));
    if (error) throw error;
    const t = String(topic || "").trim().toLowerCase();
    const rows = (data || []).filter((r) => !t || String(r.topic_label || "").trim().toLowerCase() === t);
    return { ...summariseQuestionSignals(rows), rows };
  } catch (e) {
    console.warn("[learner-model] question signals unavailable:", e?.message || e);
    return { ...summariseQuestionSignals([]), rows: [] };
  }
}
