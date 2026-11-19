/**
 * Bounded, learner-owned read projections used by unified Agent Chat.
 *
 * These functions deliberately do not expose raw transcripts, scratchpads,
 * account/contact/security data, private gateway payloads, teacher material, or
 * unrestricted database records. They are projections for the authenticated
 * learner, not generic data-export helpers.
 */
import db from "../../../db.js";
import {
  getAgentKnowledgeBySubject,
  getTopicsBySubject,
  retrieveStudentKnowledge,
} from "../agents/student/knowledge.js";
import { getAgentPairProfile } from "../agents/registry.js";
import { getAgentPreferences } from "../../learner-state/index.js";
import { getLearnerAutonomy } from "./learner-autonomy.js";
import { publicMemory } from "../../../lib/conversationContextValidation.js";

const isEnabled = (key) => String(process.env[key] || "").toLowerCase() === "true";
// Default-ON kill-switch keys (peer-consult pattern): absent env means enabled.
const isEnabledByDefault = (key) => String(process.env[key] ?? "true").toLowerCase() !== "false";
const text = (value, maximum) => typeof value === "string"
  ? value.replace(/[\r\n\x00]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
  : "";
const fraction = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const percent = (value) => Math.round(fraction(value) * 100);
const optionalSubject = (value) => text(value, 180) || null;

function confidenceBand(value) {
  const score = fraction(value);
  if (score < 0.35) return "needs_attention";
  if (score < 0.55) return "building";
  if (score < 0.72) return "developing";
  if (score < 0.88) return "secure";
  return "strong";
}

function dueStatus(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "not_scheduled";
  return new Date(value).getTime() <= Date.now() ? "due" : "scheduled";
}

async function learnerAgentId(learnerId) {
  const { data, error } = await db.schema("edu").from("student_agents")
    .select("id").eq("student_id", learnerId).maybeSingle();
  if (error) throw new Error("Learner knowledge is unavailable");
  return data?.id || null;
}

async function learnerKnowledgeSubjects(learnerId) {
  const agentId = await learnerAgentId(learnerId);
  if (!agentId) return { agentId: null, subjects: [] };
  return { agentId, subjects: await getAgentKnowledgeBySubject(agentId) };
}

function publicKnowledgeSubject(row) {
  return {
    subject: text(row?.subject, 180) || "General",
    topicCount: Math.max(0, Number(row?.topic_count) || 0),
    confidence: percent(row?.avg_confidence),
    confidenceBand: confidenceBand(row?.avg_confidence),
    reviewDueAt: row?.earliest_review_due || null,
    reviewStatus: dueStatus(row?.earliest_review_due),
    priorityCounts: {
      critical: Math.max(0, Number(row?.critical_count) || 0),
      high: Math.max(0, Number(row?.high_count) || 0),
      medium: Math.max(0, Number(row?.medium_count) || 0),
    },
    lastActivityAt: row?.last_activity || null,
  };
}

function publicKnowledgeTopic(row) {
  return {
    topic: text(row?.topic, 180),
    subject: text(row?.subject, 180) || "General",
    confidence: percent(row?.confidence),
    confidenceBand: confidenceBand(row?.confidence),
    health: text(row?.health_status, 40) || confidenceBand(row?.confidence),
    reviewDueAt: row?.next_review_due || null,
    reviewStatus: dueStatus(row?.next_review_due),
    lastReviewedAt: row?.last_seen_at || null,
  };
}

/** Cross-subject projection for “How is my study going?” requests. */
export async function getLearningOverview(learnerId) {
  const [enrollmentsResult, tasksResult, knowledge] = await Promise.all([
    db.from("enrollments")
      .select("progress, courses!inner(title, subject, slug)", { count: "exact" })
      .eq("user_id", learnerId).eq("status", "active")
      .order("enrolled_at", { ascending: false }).limit(8),
    db.from("tasks")
      .select("title, priority, due_at, created_at", { count: "exact" })
      .eq("creator_id", learnerId).eq("status", "pending")
      .order("due_at", { ascending: true, nullsFirst: false }).limit(8),
    learnerKnowledgeSubjects(learnerId),
  ]);
  if (enrollmentsResult.error || tasksResult.error) throw new Error("Learning overview is unavailable");

  const courses = (enrollmentsResult.data || []).map((row) => ({
    title: text(row.courses?.title, 180),
    subject: text(row.courses?.subject, 180) || null,
    progress: Math.max(0, Math.min(100, Number(row.progress) || 0)),
    slug: text(row.courses?.slug, 180) || null,   // the chat links the course (chat-materials.js)
  }));
  const subjects = knowledge.subjects.map(publicKnowledgeSubject).slice(0, 8);
  const focus = subjects
    .filter((subject) => subject.confidenceBand === "needs_attention" || subject.confidenceBand === "building" || subject.reviewStatus === "due")
    .slice(0, 4);
  const tasks = (tasksResult.data || []).map((row) => ({
    title: text(row.title, 180),
    priority: text(row.priority, 20) || "medium",
    dueAt: row.due_at || null,
  }));
  const recommendedNext = focus[0]
    ? { type: "review", subject: focus[0].subject, reason: focus[0].reviewStatus === "due" ? "recorded review is due" : "lower recorded confidence" }
    : tasks[0]
      ? { type: "task", title: tasks[0].title, reason: "pending learner task" }
      : courses[0]
        ? { type: "continue_course", title: courses[0].title, reason: "active course" }
        : null;

  return {
    courses,
    courseCount: Number(enrollmentsResult.count ?? courses.length),
    pendingTasks: tasks,
    pendingTaskCount: Number(tasksResult.count ?? tasks.length),
    knowledgeSubjects: subjects,
    recommendedNext,
  };
}

/** Subject/topic health without any saved note or content body. */
export async function getKnowledgeMap(learnerId, input = {}) {
  const subject = optionalSubject(input.subject);
  const { agentId, subjects } = await learnerKnowledgeSubjects(learnerId);
  if (!agentId) return { subjects: [], topics: [], message: "No recorded study knowledge yet." };
  const allSubjects = subjects.map(publicKnowledgeSubject).filter((item) => !subject || item.subject.toLocaleLowerCase("en-US") === subject.toLocaleLowerCase("en-US"));
  // The stored subject names (matched case-insensitively above), not the raw
  // input — "biology" found the Biology row but fetched its topics with
  // "biology" and got none.
  const requested = allSubjects.map((item) => item.subject).slice(0, 6);
  const topicSets = await Promise.all(requested.map((name) => getTopicsBySubject(agentId, name)));
  const topics = topicSets.flat().map(publicKnowledgeTopic)
    .sort((left, right) => left.confidence - right.confidence)
    .slice(0, 18);
  return { subjects: allSubjects.slice(0, 8), topics, filteredBySubject: subject };
}

/** Small hybrid search over only the learner's personal saved study knowledge. */
export async function searchMyStudyKnowledge(learnerId, input = {}) {
  const query = text(input.query, 300);
  const subject = optionalSubject(input.subject);
  if (query.length < 3) return { error: "Please provide at least three characters to search your study knowledge." };
  const matches = await retrieveStudentKnowledge(learnerId, query, 6, subject);
  return {
    query,
    subject,
    matches: (matches || []).map((row) => ({
      topic: text(row.topic, 180),
      subject: text(row.subject, 180) || "General",
      source: text(row.source, 40) || "study record",
      confidence: percent(row.confidence),
      excerpt: text(row.content, 700),
    })).filter((item) => item.excerpt).slice(0, 6),
  };
}

/** Feature-gated qualitative concept tracker projection. */
export async function getConceptTrackerSummary(learnerId, input = {}) {
  if (!isEnabled("AKORO_CONCEPT_TRACKER_ENABLED")) {
    return { enabled: false, concepts: [], resumePoints: [], message: "Concept tracking is not enabled for this learner." };
  }
  const subject = optionalSubject(input.subject);
  let conceptsQuery = db.schema("edu").from("learner_concept_tracker")
    .select("concept_id, learning_status, resume_point, updated_at, concept_catalog!inner(title, subject, topic_key)")
    .eq("learner_id", learnerId)
    // Approved concepts only, as the tool promises (not pending review or retired).
    .eq("concept_catalog.status", "approved")
    .order("updated_at", { ascending: false }).limit(16);
  if (subject) conceptsQuery = conceptsQuery.ilike("concept_catalog.subject", subject);
  const { data: concepts, error } = await conceptsQuery;
  if (error) throw new Error("Concept tracker is unavailable");
  const ids = (concepts || []).map((row) => row.concept_id).filter(Boolean);
  let notesByConcept = new Map();
  if (ids.length) {
    const { data: notes, error: notesError } = await db.schema("edu").from("learner_concept_confusion_notes")
      .select("concept_id, note, created_at")
      .eq("learner_id", learnerId).in("concept_id", ids)
      .order("created_at", { ascending: false }).limit(32);
    if (notesError) throw new Error("Concept tracker is unavailable");
    notesByConcept = new Map();
    for (const note of notes || []) if (!notesByConcept.has(note.concept_id)) notesByConcept.set(note.concept_id, note);
  }
  const publicConcepts = (concepts || []).map((row) => ({
    title: text(row.concept_catalog?.title, 180),
    subject: text(row.concept_catalog?.subject, 180) || "General",
    topic: text(row.concept_catalog?.topic_key, 180) || null,
    status: text(row.learning_status, 40) || "not_started",
    resumePoint: text(row.resume_point, 420) || null,
    confusionNote: text(notesByConcept.get(row.concept_id)?.note, 420) || null,
    updatedAt: row.updated_at || null,
  }));
  const statusCounts = publicConcepts.reduce((counts, concept) => {
    counts[concept.status] = (counts[concept.status] || 0) + 1;
    return counts;
  }, {});
  return { enabled: true, filteredBySubject: subject, concepts: publicConcepts, statusCounts };
}

/** Feature-gated and privacy-minimised study-signal projection. */
export async function getLearningInsightsSummary(learnerId) {
  if (!isEnabled("AKORO_LEARNER_INSIGHTS_ENABLED")) {
    return { enabled: false, profile: null, episodes: [], message: "Learning insights are not enabled for this learner." };
  }
  const [profileResult, episodesResult] = await Promise.all([
    db.schema("edu").from("learner_teaching_profiles")
      .select("evidence_count, profile_confidence, reasoning_style, pacing_recommendation, policy_version, expires_at")
      .eq("learner_id", learnerId).maybeSingle(),
    db.schema("edu").from("learner_learning_episodes")
      .select("kind, summary, occurred_at")
      .eq("learner_id", learnerId).order("occurred_at", { ascending: false }).limit(6),
  ]);
  if (profileResult.error || episodesResult.error) throw new Error("Learning insights are unavailable");
  const profile = profileResult.data;
  const expired = profile?.expires_at && new Date(profile.expires_at).getTime() <= Date.now();
  const confidence = fraction(profile?.profile_confidence);
  const confidenceLabel = !profile || expired || confidence === 0 ? "not_available"
    : confidence < 0.34 ? "emerging" : confidence < 0.67 ? "limited" : "established";
  return {
    enabled: true,
    profile: profile && !expired ? {
      evidenceCount: Math.max(0, Number(profile.evidence_count) || 0),
      confidenceLabel,
      observedReasoningStyle: text(profile.reasoning_style, 40) || "not_observed",
      pacingRecommendation: text(profile.pacing_recommendation, 40) || "unknown",
      expiresAt: profile.expires_at || null,
      policyVersion: text(profile.policy_version, 80),
    } : null,
    profileStatus: !profile ? "not_yet_available" : expired ? "expired" : "available",
    episodes: (episodesResult.data || []).map((row) => ({
      kind: text(row.kind, 60),
      summary: text(row.summary, 420),
      occurredAt: row.occurred_at || null,
    })).filter((item) => item.summary),
  };
}

/** Existing learner-owned generated-practice and workflow status, no answer keys. */
export async function getExamPrepStatus(learnerId) {
  if (!isEnabledByDefault("AKORO_EXAM_PREP_CONFIDENCE_ENABLED")) {
    return { enabled: false, runs: [], workflows: [], message: "Generated exam-style practice is not enabled for this learner." };
  }
  const [runsResult, workflowsResult] = await Promise.all([
    db.schema("edu").from("learner_exam_prep_runs")
      .select("id, topic, subject, exam_board, question_provenance, question_count, pass_threshold, max_attempts, current_attempt, last_score, status, completed_at, updated_at")
      .eq("learner_id", learnerId).order("updated_at", { ascending: false }).limit(10),
    isEnabledByDefault("AKORO_ADAPTIVE_WORKFLOWS_ENABLED")
      ? db.schema("edu").from("adaptive_workflow_runs")
        .select("id, workflow_type, topic, subject, exam_board, current_attempt, last_score, state, updated_at, completed_at")
        .eq("learner_id", learnerId).order("updated_at", { ascending: false }).limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (runsResult.error || workflowsResult.error) throw new Error("Exam-prep status is unavailable");
  return {
    enabled: true,
    questionProvenance: "generated_exam_style",
    runs: (runsResult.data || []).map((row) => ({
      id: row.id,
      topic: text(row.topic, 180),
      subject: text(row.subject, 180),
      examBoard: text(row.exam_board, 80),
      questionCount: Math.max(0, Number(row.question_count) || 0),
      currentAttempt: Math.max(1, Number(row.current_attempt) || 1),
      maxAttempts: Math.max(1, Number(row.max_attempts) || 1),
      score: row.last_score == null ? null : percent(row.last_score),
      passThreshold: percent(row.pass_threshold),
      status: text(row.status, 40),
      updatedAt: row.updated_at || null,
      completedAt: row.completed_at || null,
    })),
    workflows: (workflowsResult.data || []).map((row) => ({
      id: row.id,
      type: text(row.workflow_type, 40),
      topic: text(row.topic, 180),
      subject: text(row.subject, 180),
      state: text(row.state, 40),
      currentAttempt: Math.max(1, Number(row.current_attempt) || 1),
      score: row.last_score == null ? null : percent(row.last_score),
      updatedAt: row.updated_at || null,
    })),
  };
}

/** Learner-clearable compact memory only; never an internal scratchpad or transcript export. */
export async function getChatMemory(learnerId, { conversationId = null } = {}) {
  // Same default as the gate that offers the tool (chat.js): ON unless set to
  // false. The strict check here meant the tool was offered, then always said
  // "not enabled".
  if (!isEnabledByDefault("AKORO_AGENT_CHAT_DURABLE_CONTEXT_ENABLED")) {
    return { enabled: false, memories: [], conversationSummary: null, message: "Durable Agent Chat memory is not enabled for this learner." };
  }
  const memoriesResult = await db.schema("edu").from("learner_agent_memories")
    .select("id, kind, content, subject, topic, created_at, updated_at")
    .eq("user_id", learnerId).eq("status", "active")
    .order("updated_at", { ascending: false }).limit(8);
  if (memoriesResult.error) throw new Error("Agent memory is unavailable");
  let conversationSummary = null;
  if (conversationId) {
    const { data, error } = await db.schema("edu").from("learner_agent_conversation_summaries")
      .select("summary, updated_at")
      .eq("chat_session_id", conversationId).eq("user_id", learnerId).maybeSingle();
    if (error) throw new Error("Agent memory is unavailable");
    if (data?.summary) conversationSummary = { summary: text(data.summary, 1_200), updatedAt: data.updated_at || null };
  }
  return {
    enabled: true,
    conversationSummary,
    // Drop what publicMemory refuses (unknown kind, empty) BEFORE adding the
    // dates — spreading a null left bare {createdAt, updatedAt} stubs.
    memories: (memoriesResult.data || [])
      .map((row) => { const m = publicMemory(row); return m ? { ...m, createdAt: row.created_at || null, updatedAt: row.updated_at || null } : null; })
      .filter(Boolean),
    learnerControls: ["Memories and conversation summaries can be cleared in your Agent Chat controls."],
  };
}

/** Selected learning guide only—never a private account/settings dump. */
export async function getAgentPreferenceSummary(learnerId) {
  const preferences = await getAgentPreferences(learnerId);
  const profile = await getAgentPairProfile(preferences.guide_pair_id, learnerId).catch(() => null);
  return {
    selectedGuide: profile ? {
      name: text(profile.name, 120) || "Learning guide",
      style: text(profile.style, 80) || null,
      description: text(profile.description, 320) || null,
      bestFor: Array.isArray(profile.bestFor) ? profile.bestFor.map((item) => text(item, 80)).filter(Boolean).slice(0, 6) : [],
    } : { name: "Akoro learning guide", style: null, description: null, bestFor: [] },
  };
}

/** The learner's visible Online/Offline choice and its limited effect. */
export async function getAutonomyStatus(learnerId) {
  const autonomy = await getLearnerAutonomy(learnerId);
  return {
    online: autonomy.enabled,
    status: autonomy.enabled ? "online_opted_in" : "offline",
    behaviour: autonomy.enabled
      ? "At a precise due time, the agent may send one proactive chat to help you begin. It does not complete or change tasks."
      : "The agent will not initiate due-task chats while Offline.",
  };
}
