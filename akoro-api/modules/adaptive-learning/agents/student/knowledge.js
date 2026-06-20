// =============================================================
// agents/student/knowledge.js  v3.1
// All knowledge DB operations.
// Updated: subject/topic grouping, confidence per topic,
//          decay-aware retrieval, session delta tracking.
//
// Three RAG sources:
//   1. Agent knowledge     — what agent has been taught
//   2. Student knowledge   — student's personal notes/topics
//   3. Teacher chunks      — teacher's training material (optional)
// =============================================================

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Embed helper ──────────────────────────────────────────────
export async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.substring(0, 8000),
  });
  return res.data[0].embedding;
}

// =============================================================
// STUDENT AGENT CRUD
// =============================================================

export async function getOrCreateStudentAgent(studentId) {
  const { data: existing } = await supabase
    .schema("edu").from("student_agents")
    .select("*")
    .eq("student_id", studentId)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .schema("edu").from("student_agents")
    .insert({
      student_id:      studentId,
      name:            "My Learning Agent",
      level:           1,
      total_sessions:  0,
      total_turns:     0,
      knowledge_score: 0,
      subjects_learned: [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function incrementAgentStats(agentId, { turnsAdded, knowledgeAdded, xpEarned, subject }) {
  const { data: current } = await supabase
    .schema("edu").from("student_agents")
    .select("total_sessions, total_turns, knowledge_score, level, subjects_learned")
    .eq("id", agentId)
    .single();

  if (!current) return;

  const newScore    = (current.knowledge_score || 0) + (knowledgeAdded || 0);
  const newTurns    = (current.total_turns    || 0) + (turnsAdded     || 0);
  const newSessions = (current.total_sessions || 0) + 1;
  const newLevel    = Math.max(1, Math.floor(newScore / 50) + 1);

  // Track subjects learned
  const subjectsLearned = current.subjects_learned || [];
  if (subject && !subjectsLearned.includes(subject)) {
    subjectsLearned.push(subject);
  }

  await supabase
    .schema("edu").from("student_agents")
    .update({
      total_sessions:   newSessions,
      total_turns:      newTurns,
      knowledge_score:  newScore,
      level:            newLevel,
      subjects_learned: subjectsLearned,
      updated_at:       new Date(),
    })
    .eq("id", agentId);
}

// =============================================================
// RAG SOURCE 1: AGENT KNOWLEDGE
// Now grouped by subject + topic, with confidence per topic
// =============================================================

export async function retrieveAgentKnowledge(agentId, query, limit = 6) {
  const embedding = await embed(query);

  const { data, error } = await supabase.rpc("match_agent_knowledge", {
    p_agent_id:        agentId,
    p_query_embedding: embedding,
    p_match_count:     limit,
  });

  if (error) throw error;
  return data || [];
}

/**
 * Retrieve agent knowledge filtered by subject.
 * Used in decay review sessions to focus on one subject.
 */
export async function retrieveAgentKnowledgeBySubject(agentId, subject, query, limit = 8) {
  const embedding = await embed(query);

  // First try subject-filtered similarity search
  const { data: bySubject } = await supabase
    .schema("edu").from("agent_knowledge")
    .select("id, topic, subject, content, chunk_type, confidence, times_seen")
    .eq("agent_id", agentId)
    .eq("subject", subject)
    .order("confidence", { ascending: true }) // surface weakest first
    .limit(limit);

  return bySubject || [];
}

/**
 * Retrieve agent knowledge filtered by subject AND topic.
 * Used in decay review sessions for laser-focused context.
 */
export async function retrieveAgentKnowledgeByTopic(agentId, subject, topic, limit = 6) {
  const { data } = await supabase
    .schema("edu").from("agent_knowledge")
    .select("id, topic, subject, content, chunk_type, confidence, times_seen, last_seen_at")
    .eq("agent_id", agentId)
    .eq("subject", subject)
    .ilike("topic", `%${topic}%`)
    .order("last_seen_at", { ascending: true }) // oldest first
    .limit(limit);

  return data || [];
}

/**
 * Save new knowledge to agent's knowledge base.
 * v3.1: now includes subject field + confidence + decay fields.
 */
export async function saveAgentKnowledge({
  agentId,
  studentId,
  sessionId,
  subject,
  topic,
  content,
  chunkType  = "taught",
  confidence = 0.50,
}) {
  // Check for existing knowledge on this subject+topic
  const { data: existing } = await supabase
    .schema("edu").from("agent_knowledge")
    .select("id, times_seen, confidence, decay_rate")
    .eq("agent_id", agentId)
    .eq("subject", subject || "general")
    .ilike("topic", topic)
    .single();

  const embedding = await embed(content + " " + topic);

  if (existing) {
    // Reinforce: confidence goes up, decay_rate improves slightly
    const newConf      = Math.min(0.98, existing.confidence + 0.05);
    const newDecayRate = Math.max(0.04, (existing.decay_rate || 0.10) * 0.95);

    const { getPriority, getNextReviewDate } = await import("./decayEngine.js");
    const newPriority  = getPriority(newConf);
    const nextDue      = getNextReviewDate(newConf, newPriority);

    await supabase
      .schema("edu").from("agent_knowledge")
      .update({
        content,
        confidence:      newConf,
        times_seen:      existing.times_seen + 1,
        last_seen_at:    new Date(),
        chunk_type:      chunkType,
        decay_rate:      newDecayRate,
        priority:        newPriority,
        next_review_due: nextDue,
        embedding,
        updated_at:      new Date(),
      })
      .eq("id", existing.id);

    return { action: "reinforced", id: existing.id, newConfidence: newConf };
  }

  // New knowledge — set initial decay schedule
  const { getPriority, getNextReviewDate } = await import("./decayEngine.js");
  const priority = getPriority(confidence);
  const nextDue  = getNextReviewDate(confidence, priority);

  const { data, error } = await supabase
    .schema("edu").from("agent_knowledge")
    .insert({
      agent_id:        agentId,
      student_id:      studentId,
      session_id:      sessionId,
      subject:         subject || "general",
      topic,
      content,
      chunk_type:      chunkType,
      confidence,
      decay_rate:      0.10,
      priority,
      next_review_due: nextDue,
      embedding,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { action: "saved", id: data.id, newConfidence: confidence };
}

export async function batchSaveAgentKnowledge(chunks) {
  let saved = 0;
  for (const chunk of chunks) {
    try {
      await saveAgentKnowledge(chunk);
      saved++;
    } catch (e) {
      console.warn("[AgentKnowledge] Failed to save chunk:", e.message);
    }
  }
  return saved;
}

// =============================================================
// KNOWLEDGE GROUPED BY SUBJECT (for dashboard + decay UI)
// =============================================================

/**
 * Get all agent knowledge grouped by subject.
 * Returns summary with confidence per subject + topic list.
 */
export async function getAgentKnowledgeBySubject(agentId) {
  const { data, error } = await supabase
    .schema("edu").from("agent_knowledge_by_subject")
    .select("*")
    .eq("agent_id", agentId)
    .order("avg_confidence", { ascending: true });

  if (error) return [];
  return data || [];
}

/**
 * Get all topics for a given subject, with health status.
 */
export async function getTopicsBySubject(agentId, subject) {
  const { data, error } = await supabase
    .schema("edu").from("agent_topic_health")
    .select("*")
    .eq("agent_id", agentId)
    .eq("subject", subject)
    .order("confidence", { ascending: true });

  if (error) return [];
  return data || [];
}

// =============================================================
// RAG SOURCE 2: STUDENT PERSONAL KNOWLEDGE
// =============================================================

export async function retrieveStudentKnowledge(studentId, query, limit = 5) {
  const embedding = await embed(query);

  const { data, error } = await supabase.rpc("match_student_knowledge", {
    p_student_id:      studentId,
    p_query_embedding: embedding,
    p_match_count:     limit,
  });

  if (error) throw error;
  return data || [];
}

export async function saveStudentKnowledge({
  studentId,
  agentId,
  topic,
  subject,
  content,
  source     = "session",
  confidence = 0.60,
  tags       = [],
}) {
  const embedding = await embed(content + " " + topic);

  const { error } = await supabase
    .schema("edu").from("student_knowledge")
    .upsert(
      {
        student_id:  studentId,
        agent_id:    agentId,
        topic,
        subject:     subject || "general",
        content,
        source,
        confidence,
        tags,
        embedding,
        updated_at:  new Date(),
      },
      { onConflict: "student_id,topic" }
    );

  if (error) throw error;
}

// =============================================================
// RAG SOURCE 3: TEACHER TRAINING CHUNKS
// =============================================================

export async function retrieveTeacherChunks(teacherId, query, limit = 4) {
  if (!teacherId) return [];

  const embedding = await embed(query);

  const { data, error } = await supabase.rpc("match_training_chunks", {
    p_teacher_id:      teacherId,
    p_query_embedding: embedding,
    p_match_count:     limit,
  });

  if (error) { console.warn("[TeacherChunks]", error.message); return []; }
  return data || [];
}

// =============================================================
// COMBINED RAG — all 3 sources + subject/topic filter
// =============================================================

export async function retrieveCombinedContext({
  agentId,
  studentId,
  teacherId    = null,
  query,
  subject      = null,  // v3.1: optional subject filter
  topic        = null,  // v3.1: optional topic filter
  agentLimit   = 6,
  studentLimit = 4,
  teacherLimit = 3,
}) {
  // Choose retrieval strategy based on whether subject/topic provided
  const agentChunksPromise = (subject && topic)
    ? retrieveAgentKnowledgeByTopic(agentId, subject, topic, agentLimit)
    : subject
    ? retrieveAgentKnowledgeBySubject(agentId, subject, query, agentLimit)
    : retrieveAgentKnowledge(agentId, query, agentLimit);

  const [agentChunks, studentChunks, teacherChunks] = await Promise.all([
    agentChunksPromise,
    retrieveStudentKnowledge(studentId, query, studentLimit),
    retrieveTeacherChunks(teacherId, query, teacherLimit),
  ]);

  const sections = [];

  if (agentChunks.length > 0) {
    const label = (subject && topic)
      ? `## What I know about ${subject} — ${topic}:`
      : subject
      ? `## What I know about ${subject}:`
      : `## What I already know (from our sessions):`;

    sections.push(
      label + "\n" +
      agentChunks
        .map((c, i) => `[${i + 1}] (${c.chunk_type || "taught"}, ${Math.round((c.confidence || 0.5) * 100)}% confident) ${c.topic}: ${c.content}`)
        .join("\n\n")
    );
  }

  if (studentChunks.length > 0) {
    sections.push(
      `## What this student has studied:\n` +
      studentChunks
        .map((c, i) => `[${i + 1}] (${c.source}) ${c.topic}: ${c.content}`)
        .join("\n\n")
    );
  }

  if (teacherChunks.length > 0) {
    sections.push(
      `## Relevant material from the teacher's lessons:\n` +
      teacherChunks
        .map((c, i) => `[${i + 1}] (${c.chunk_type}) ${c.chunk_text}`)
        .join("\n\n")
    );
  }

  return {
    contextString: sections.join("\n\n---\n\n"),
    agentChunks,
    studentChunks,
    teacherChunks,
    totalChunks: agentChunks.length + studentChunks.length + teacherChunks.length,
  };
}

// =============================================================
// SESSION KNOWLEDGE DELTA
// =============================================================

export async function createSessionDelta({
  sessionId,
  agentId,
  studentId,
  teacherAgentId = null,
  topic,
  subject,
  understandingStart,
}) {
  const { data, error } = await supabase
    .schema("edu").from("session_knowledge_delta")
    .insert({
      session_id:          sessionId,
      agent_id:            agentId,
      student_id:          studentId,
      teacher_agent_id:    teacherAgentId,
      topic,
      subject,
      understanding_start: understandingStart,
      started_at:          new Date(),
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function finalizeSessionDelta({
  sessionId,
  understandingEnd,
  conceptsLearned,
  misconceptionsCleared,
  agentKnowledgeAdded,
  studentKnowledgeRefs,
  teacherChunksUsed,
  totalTurns,
  durationSec,
  xpEarned,
}) {
  await supabase
    .schema("edu").from("session_knowledge_delta")
    .update({
      understanding_end:      understandingEnd,
      understanding_delta:    understandingEnd,
      concepts_learned:       conceptsLearned       || [],
      misconceptions_cleared: misconceptionsCleared || [],
      agent_knowledge_added:  agentKnowledgeAdded,
      student_knowledge_refs: studentKnowledgeRefs,
      teacher_chunks_used:    teacherChunksUsed,
      total_turns:            totalTurns,
      session_duration_sec:   durationSec,
      xp_earned:              xpEarned,
      completed_at:           new Date(),
    })
    .eq("session_id", sessionId);
}

export async function getAgentGrowthHistory(agentId, limit = 20) {
  const { data, error } = await supabase
    .schema("edu").from("session_knowledge_delta")
    .select("*")
    .eq("agent_id", agentId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

export async function getAgentIntelligence(agentId) {
  const { data } = await supabase
    .schema("edu").from("agent_intelligence_growth")
    .select("*")
    .eq("agent_id", agentId)
    .single();

  return data || null;
}
