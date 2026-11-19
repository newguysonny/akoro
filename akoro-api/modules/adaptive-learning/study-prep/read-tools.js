/**
 * study-prep read tools (Master Plan §4.2): the agent's controlled access to
 * dynamic truth. Every tool is read-only, bounded, and never exposes raw
 * chat, transcripts, scratchpads or answer keys (house pattern from
 * learner-chat-read-tools.js). db-backed; handlers are injected into the
 * registry so the agent loop stays testable.
 */

import db from "../../../db.js";
import { resolveTopics, prerequisiteEdges } from "./syllabus-resolver.js";
import { toUnitScore } from "./education-engine.js";
import { misconceptionTitles } from "../learner/learner-model.js";

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
      .select("mastery, misconception_active, concept:concept_catalog(title, subject, topic_key)")
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
  const inSubject = [];
  for (const row of conceptState.data || []) {
    const concept = Array.isArray(row.concept) ? row.concept[0] : row.concept;
    if (!concept) continue;
    if (pattern !== "%%" && !String(concept.subject || "").toLowerCase().includes(String(subject || "").trim().toLowerCase())) continue;
    inSubject.push(row);
    // Scale guard: concept mastery is 0–1; anything else is refused, not clamped.
    const mastery = toUnitScore(row.mastery);
    if (mastery != null) record(concept.topic_key || concept.title, mastery);
  }
  // knowledge_confidence is 0–100 → 0–1 fallback (S4 §6 scale conversion).
  for (const row of confidence.data || []) {
    record(row.topic, toUnitScore(Math.max(0, Math.min(100, Number(row.confidence || 0))), { scale: "percent" }));
  }
  if (topicIds) {
    const allowed = new Set(topicIds);
    for (const key of Object.keys(state)) if (!allowed.has(key)) delete state[key];
  }
  return {
    scale: "0-1 mastery estimate from recorded evidence; a missing topic means no evidence yet",
    topics: state,
    // Phase 10: the learner model's active misconceptions first (central
    // learner_concept_state); the legacy knowledge_confidence lists only fill
    // what it does not cover yet.
    misconceptions: (() => {
      const central = misconceptionTitles(inSubject);
      const legacy = (confidence.data || []).flatMap((row) => Array.isArray(row.misconceptions) ? row.misconceptions.slice(0, 3) : []);
      return [...central, ...legacy.filter((item) => !central.includes(item))].slice(0, 8);
    })(),
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
        status: topic.status, ...(topic.state && topic.state !== topic.status ? { state: topic.state } : {}), attemptsUsed: topic.attemptsUsed, learnerConfirmedReady: topic.learnerConfirmedReady,
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

// ── topic.related_covered (2026-11-07) ──────────────────────────────────────
const STOP = new Set(["the", "and", "of", "in", "a", "an", "to", "for", "on", "its", "their", "with", "by", "from", "introduction", "basic", "part", "simple"]);
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.replace(/(ies|es|s)$/, "")));

/**
 * PURE: the topics the learner has ALREADY covered that connect to `topic` —
 * its prerequisites (approved edges, one and two steps back) and topics that
 * share its key ideas — with how well each is held, and the prerequisites they
 * have not covered yet.
 *   covered: [{ label, mastery 0–1 }]   edges: [{ before, after, beforeLabel }]
 */
export function relatedCoveredFrom({ topic, covered = [], edges = [] }) {
  const key = slug(topic);
  const direct = edges.filter((e) => e.after === key);
  const twoBack = edges.filter((e) => direct.some((d) => d.before === e.after));
  const prereq = new Map([...direct, ...twoBack].map((e) => [e.before, e.beforeLabel || e.before]));
  const mine = words(topic);
  const out = [];
  const seen = new Set();
  for (const c of covered) {
    const k = slug(c.label);
    if (!k || k === key || seen.has(k)) continue;
    const shared = [...words(c.label)].filter((w) => mine.has(w));
    const relation = prereq.has(k) ? "prerequisite" : shared.length ? "shares_ideas" : null;
    if (!relation) continue;
    seen.add(k);
    const mastery = round4(Math.max(0, Math.min(1, Number(c.mastery) || 0)));
    out.push({ topic: c.label, relation, mastery, held: mastery >= 0.7 ? "well" : mastery >= 0.4 ? "partly" : "weakly", ...(shared.length && relation !== "prerequisite" ? { sharedIdeas: shared.slice(0, 3) } : {}) });
  }
  out.sort((a, b) => (a.relation === b.relation ? b.mastery - a.mastery : a.relation === "prerequisite" ? -1 : 1));
  const coveredKeys = new Set(covered.map((c) => slug(c.label)));
  const notCovered = [...prereq.entries()].filter(([k]) => !coveredKeys.has(k)).map(([, label]) => label);
  return {
    topic, related: out.slice(0, 8), prerequisitesNotCovered: notCovered.slice(0, 6),
    next: out.some((r) => r.relation === "prerequisite" && r.held === "weakly") || notCovered.length
      ? "A prerequisite is weak or not covered: start one step lower (a short warm-up or that topic first)."
      : out.length ? "Build on what they already hold: open by connecting to the strongest related topic." : "Nothing related covered yet: start from the basics and check prior class knowledge lightly.",
  };
}

/** topic.related_covered — what this learner already covered that connects to a topic. */
export async function getRelatedCovered({ learnerId, subject, topic }) {
  const pattern = `%${String(subject || "").trim()}%`;
  const [state, confidence, edges] = await Promise.all([
    db.schema("edu").from("learner_concept_state")
      .select("mastery, concept:concept_catalog(title, subject, topic_key)").eq("learner_id", learnerId).limit(200),
    db.schema("edu").from("knowledge_confidence").select("topic, subject, confidence").eq("student_id", learnerId).ilike("subject", pattern).limit(100),
    prerequisiteEdges({ subject }).catch(() => []),
  ]);
  const sub = String(subject || "").trim().toLowerCase();
  const covered = [
    ...((state.data || []).filter((r) => r.concept && (!sub || String(r.concept.subject || "").toLowerCase().includes(sub))).map((r) => ({ label: r.concept.title || r.concept.topic_key, mastery: r.mastery }))),
    ...((confidence.data || []).map((r) => ({ label: r.topic, mastery: Number(r.confidence) > 1 ? Number(r.confidence) / 100 : r.confidence }))),
  ].filter((c) => c.label);
  return relatedCoveredFrom({ topic, covered, edges });
}
