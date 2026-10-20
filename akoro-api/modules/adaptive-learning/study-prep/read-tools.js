/**
 * study-prep read tools (Master Plan §4.2): the agent's controlled access to
 * dynamic truth. Every tool is read-only, bounded, and never exposes raw
 * chat, transcripts, scratchpads or answer keys (house pattern from
 * learner-chat-read-tools.js). db-backed; handlers are injected into the
 * registry so the agent loop stays testable.
 */

import db from "../../../db.js";
import { resolveTopics, prerequisiteEdges } from "./syllabus-resolver.js";

const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);
const round4 = (value) => Math.round(Number(value || 0) * 10_000) / 10_000;

/** learner.get_state — 0–1 mastery per topic, knowledge_confidence fallback (S4 §6). */
export async function getLearnerState({ learnerId, subject, topicIds = null }) {
  const pattern = `%${String(subject || "").trim()}%`;
  const [confidence, conceptState] = await Promise.all([
    db.schema("edu").from("knowledge_confidence")
      .select("topic, subject, confidence, misconceptions")
      .eq("student_id", learnerId).ilike("subject", pattern)
      .order("last_assessed", { ascending: false }).limit(60),
    // Embedded read through the concept_catalog FK: mastery 0–1 per concept,
    // mapped onto topic slugs so the agent reasons in the same ids as the plan.
    db.schema("edu").from("learner_concept_state")
      .select("mastery, concept:concept_catalog(title, subject, topic_key)")
      .eq("learner_id", learnerId).limit(100),
  ]);
  if (confidence.error) throw confidence.error;
  if (conceptState.error) throw conceptState.error;
  const state = {};
  const record = (id, value) => {
    const key = String(id || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    if (!key) return;
    const rounded = round4(Math.max(0, Math.min(1, Number(value || 0))));
    state[key] = state[key] == null ? rounded : Math.max(state[key], rounded);
  };
  for (const row of conceptState.data || []) {
    const concept = Array.isArray(row.concept) ? row.concept[0] : row.concept;
    if (!concept) continue;
    if (pattern !== "%%" && !String(concept.subject || "").toLowerCase().includes(String(subject || "").trim().toLowerCase())) continue;
    record(concept.topic_key || concept.title, row.mastery);
  }
  // knowledge_confidence is 0–100 → 0–1 fallback (S4 §6 scale conversion).
  for (const row of confidence.data || []) {
    record(row.topic, Math.max(0, Math.min(100, Number(row.confidence || 0))) / 100);
  }
  if (topicIds) {
    const allowed = new Set(topicIds);
    for (const key of Object.keys(state)) if (!allowed.has(key)) delete state[key];
  }
  return {
    scale: "0-1 mastery estimate from recorded evidence; a missing topic means no evidence yet",
    topics: state,
    misconceptions: (confidence.data || []).flatMap((row) => Array.isArray(row.misconceptions) ? row.misconceptions.slice(0, 3) : []).slice(0, 8),
  };
}

/** learner.get_history — bounded, factual prior attempts (S4 §6). */
export async function getLearnerHistory({ learnerId, subject, limit = 10 }) {
  const { data, error } = await db.schema("edu").from("learner_exam_prep_runs")
    .select("topic, subject, status, last_score, max_attempts, current_attempt, updated_at")
    .eq("learner_id", learnerId).ilike("subject", `%${String(subject || "").trim()}%`)
    .order("updated_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 10, 20)));
  if (error) throw error;
  return {
    runs: (data || []).map((row) => ({
      topic: text(row.topic, 180), status: row.status, score: row.last_score == null ? null : round4(row.last_score),
      attempts: `${Number(row.current_attempt || 1)} of ${Number(row.max_attempts || 3)}`, at: row.updated_at,
    })),
  };
}

/** learner.get_relevant_memory — targeted retrieval, never a history dump (S3). */
export async function getRelevantMemory({ learnerId, subject, limit = 8 }) {
  // Scoped to the subject's concepts — it used to return any subject's evidence.
  let conceptIds = null;
  if (String(subject || "").trim()) {
    const { data: concepts, error: conceptError } = await db.schema("edu").from("concept_catalog")
      .select("id").ilike("subject", `%${String(subject).trim()}%`).limit(500);
    if (conceptError) throw conceptError;
    conceptIds = (concepts || []).map((c) => c.id);
    if (!conceptIds.length) return { memories: [] };
  }
  let query = db.schema("edu").from("learner_concept_evidence")
    .select("observation_kind, response_quality, evidence_summary, observed_at, concept_id")
    .eq("learner_id", learnerId);
  if (conceptIds) query = query.in("concept_id", conceptIds);
  const { data, error } = await query.order("observed_at", { ascending: false }).limit(Math.max(1, Math.min(Number(limit) || 8, 20)));
  if (error) throw error;
  return {
    memories: (data || []).map((row) => ({
      kind: row.observation_kind, quality: round4(row.response_quality),
      summary: text(row.evidence_summary, 240), at: row.observed_at,
    })),
  };
}

/** concept.get_prerequisites — approved prerequisite edges only. */
export async function getPrerequisites({ subject }) {
  return { edges: await prerequisiteEdges({ subject }) };
}

/** syllabus.resolve — the approved topic list the plan must come from. */
export async function resolveSyllabusTool({ subject, classLevel, exam }) {
  const topics = await resolveTopics({ subject, classLevel, exam });
  if (!topics.length) {
    return { subject, classLevel, topics: [], found: false, next: "No syllabus exists for this subject and class on Akoro. Call syllabus.generate to draft an outline, then propose a plan from its topics." };
  }
  return { subject, classLevel, found: true, topics: topics.map((topic) => ({ id: topic.id, label: topic.label })) };
}

/** session.get_state — the agent sees the same state the harness does (S5 §6.1). */
export function makeSessionStateReader(harness) {
  return async ({ learnerId, sessionId }) => {
    const view = await harness.getSessionView({ sessionId, learnerId, eventLimit: 20 });
    // The active topic's teaching session, if one was handed over (Phase 6): offered, waiting or under way.
    const active = view.topics.find((t) => t.status === "active");
    const teaching = active && view.session.workflowId
      ? await import("./wiring.js").then((w) => w.teachingForTopic(view.session.workflowId, active.id)).catch(() => null)
      : null;
    return {
      session: {
        id: view.session.id, status: view.session.status, goal: view.session.goal,
        subject: view.session.subject, pausedReason: view.session.pausedReason,
        toolCallsUsed: view.session.toolCallsUsed,
      },
      topics: view.topics.map((topic) => ({
        id: topic.id, label: topic.label, syllabusTopicId: topic.syllabusTopicId, position: topic.position,
        status: topic.status, attemptsUsed: topic.attemptsUsed, learnerConfirmedReady: topic.learnerConfirmedReady,
        // The topic's last Agent Check, as marked (never the questions' answers).
        ...(topic.checkResult ? { lastCheck: { correct: topic.checkResult.correct, total: topic.checkResult.total, guessed: topic.checkResult.guessed, gaps: (topic.checkResult.gaps || []).slice(0, 4) } } : {}),
        ...(topic.checkBattleId && !topic.checkScoredAt ? { checkRunning: true } : {}),
        ...(teaching && active?.id === topic.id ? { teachingSession: { state: teaching.state, focus: teaching.focus, progress: teaching.progress, autoApproveAt: teaching.autoApproveAt } } : {}),
      })),
      ...(view.session.estimate && harness.budgetFor ? { coins: await harness.budgetFor({ id: view.session.id, estimate: view.session.estimate }).catch(() => undefined) } : {}),
      recentEvents: view.events.map((event) => ({
        sequence: event.sequence, eventType: event.event_type, action: event.action || null,
        narrative: event.narrative || null,
      })),
    };
  };
}
