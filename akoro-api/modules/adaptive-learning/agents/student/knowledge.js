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

// Lazy: a barrel re-export must not build the client (or throw) in a test env.
let _supabase = null;
const supabase = new Proxy({}, { get(_, p) {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY);
  const v = _supabase[p];
  return typeof v === "function" ? v.bind(_supabase) : v;
} });

import { openai } from "../../../../lib/aiModel.js";
import { mergeKnowledge } from "./mergeKnowledge.js";

// ── Embed helper ──────────────────────────────────────────────
export async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.substring(0, 8000),
  });
  return res.data[0].embedding;
}

/**
 * embed(), but a failure (provider down, out of credit, breaker open) is null
 * instead of a dead teaching turn. A null query vector makes the match_* RPCs
 * rank on their lexical arm alone; a null stored vector with embedded_at null
 * is what lib/embeddingSweeper.js fills in once the provider is back.
 */
/**
 * A search's query vector: embedOrNull with a time limit (lib/searchEmbedding.js),
 * so a slow or cold provider costs a search its vector arm, not the learner's wait.
 */
export async function embedQueryOrNull(text) {
  const { embedForSearch } = await import("../../../../lib/searchEmbedding.js");
  return embedForSearch(String(text ?? "").slice(0, 8000), { feature: "knowledge_search" });
}

export async function embedOrNull(text) {
  try {
    return await embed(text);
  } catch (err) {
    console.warn("[embed] skipped:", String(err?.message || err).slice(0, 160));
    return null;
  }
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

export async function retrieveAgentKnowledge(agentId, query, limit = 6, subject = null) {
  const embedding = await embedQueryOrNull(query);

  const { data, error } = await supabase.rpc("match_agent_knowledge", {
    p_agent_id:        agentId,
    p_query_embedding: embedding,
    p_match_count:     limit,
    p_query_text:      query,
    p_subject:         subject,
  });

  if (error) throw error;
  return data || [];
}

/**
 * Retrieve agent knowledge filtered by subject.
 * Used in decay review sessions to focus on one subject.
 */
export async function retrieveAgentKnowledgeBySubject(agentId, subject, query, limit = 8) {
  const embedding = await embedQueryOrNull(query);

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
  subtopic   = "",
  content,
  chunkType  = "taught",
  confidence = 0.50,
}) {
  // Keyed on (agent, topic, subtopic) — NOT on subject.
  //
  // The old lookup included subject, which is free text drifting between
  // "Maths" and "Mathematics": a change of spelling made the row invisible and
  // a second one was inserted beside it. It also used .single(), which returns
  // null when it matches MORE than one row, so once two existed a third was
  // created every session.
  const { data: existing } = await supabase
    .schema("edu").from("agent_knowledge")
    .select("id, times_seen, confidence, decay_rate, content, stability_days")
    .eq("agent_id", agentId).eq("topic", topic).eq("subtopic", subtopic ?? "")
    .maybeSingle();

  if (existing) {
    // Reinforce: confidence goes up, decay_rate improves slightly.
    //
    // And the CONTENT IS MERGED, not overwritten. This update used to pass the
    // new content straight through, so teaching one aspect of a topic already
    // covered deleted everything else known about it — while times_seen and
    // confidence both rose to say the opposite.
    const { content: merged } = await mergeKnowledge(existing.content, content, { userId: studentId });
    // Taught again = a review on the forgetting curve (D44): it moves back up
    // and fades more slowly from here.
    const { afterReteach } = await import("./retention.js");
    const reviewed     = afterReteach({ current: existing.confidence, stabilityDays: existing.stability_days });
    const newConf      = reviewed.learned;
    const newDecayRate = Math.max(0.04, (existing.decay_rate || 0.10) * 0.95);

    const { getPriority, getNextReviewDate } = await import("./decayEngine.js");
    const newPriority  = getPriority(newConf);
    const nextDue      = getNextReviewDate(newConf, newPriority);
    const vector       = await embedOrNull(`${merged} ${topic} ${subtopic ?? ""}`.trim());

    await supabase
      .schema("edu").from("agent_knowledge")
      .update({
        content:         merged,
        embedding:       vector,
        embedded_at:     vector ? new Date() : null,
        confidence:      newConf,
        learned_confidence: newConf,
        learned_at:      new Date(),
        stability_days:  reviewed.stabilityDays,
        times_seen:      existing.times_seen + 1,
        last_seen_at:    new Date(),
        chunk_type:      chunkType,
        decay_rate:      newDecayRate,
        priority:        newPriority,
        next_review_due: nextDue,
        updated_at:      new Date(),
      })
      .eq("id", existing.id);

    return { action: "reinforced", id: existing.id, newConfidence: newConf };
  }

  // New knowledge — set initial decay schedule
  const { getPriority, getNextReviewDate } = await import("./decayEngine.js");
  const priority = getPriority(confidence);
  const nextDue  = getNextReviewDate(confidence, priority);
  const newVector = await embedOrNull(`${content} ${topic} ${subtopic ?? ""}`.trim());

  const { data, error } = await supabase
    .schema("edu").from("agent_knowledge")
    .insert({
      agent_id:        agentId,
      student_id:      studentId,
      session_id:      sessionId,
      subject:         subject || "general",
      topic,
      subtopic:        subtopic ?? "",
      content,
      chunk_type:      chunkType,
      confidence,
      learned_confidence: confidence,
      learned_at:      new Date(),
      decay_rate:      0.10,
      priority,
      next_review_due: nextDue,
      embedding:       newVector,
      embedded_at:     newVector ? new Date() : null,
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

export async function retrieveStudentKnowledge(studentId, query, limit = 5, subject = null) {
  const embedding = await embedQueryOrNull(query);

  const { data, error } = await supabase.rpc("match_student_knowledge", {
    p_student_id:      studentId,
    p_query_embedding: embedding,
    p_match_count:     limit,
    // Hybrid: the raw query drives a full-text arm alongside the vector, fused
    // by RRF in SQL. Embeddings are weakest on exactly what study notes are
    // made of — formulae, definitions, units, names — and the lexical arm is
    // what catches those.
    p_query_text:      query,
    p_subject:         subject,
    p_exclude_tags:    ["battle-encounter"],
  });

  if (error) throw error;
  return data || [];
}

export async function saveStudentKnowledge({
  studentId,
  agentId,
  topic,
  subtopic   = "",
  subject,
  content,
  source     = "session",
  confidence = 0.60,
  tags       = [],
}) {
  // Read-then-write rather than upsert.
  //
  // The upsert this replaces declared onConflict "student_id,topic" against a
  // constraint that did not exist, so every call returned 42P10 and both
  // callers swallowed it into a console.warn. This table — the one battle
  // agents recall from — was therefore never written by a teaching session at
  // all. The constraint exists now (2026-knowledge-hierarchy.sql), but the
  // write still cannot be a blind upsert: an upsert REPLACES, and replacing is
  // the second bug this fixes.
  const key = { studentId, topic, subtopic: subtopic ?? "" };
  const { data: existing } = await supabase
    .schema("edu").from("student_knowledge")
    .select("id, content, confidence")
    .eq("student_id", key.studentId).eq("topic", key.topic).eq("subtopic", key.subtopic)
    .maybeSingle();

  if (existing) {
    const { content: merged, action } = await mergeKnowledge(existing.content, content, { userId: studentId });
    // Nothing new was said. Re-embedding identical text is a bill for no
    // change, so the row is left exactly as it is.
    if (action === "unchanged" && merged === existing.content) return { action, id: existing.id };

    const embedding = await embedOrNull(`${merged} ${topic} ${subtopic ?? ""}`.trim());
    const { error } = await supabase
      .schema("edu").from("student_knowledge")
      .update({
        content: merged, subject: subject || "general", source, tags,
        confidence: Math.min(1, Math.max(Number(existing.confidence ?? 0.5), confidence)),
        embedding, embedded_at: embedding ? new Date() : null, updated_at: new Date(),
      }).eq("id", existing.id);
    if (error) throw error;
    return { action, id: existing.id };
  }

  const embedding = await embedOrNull(`${content} ${topic} ${subtopic ?? ""}`.trim());
  const { data, error } = await supabase
    .schema("edu").from("student_knowledge")
    .insert({
      student_id: studentId, agent_id: agentId,
      topic, subtopic: subtopic ?? "", subject: subject || "general",
      content, source, confidence, tags, embedding,
      embedded_at: embedding ? new Date() : null, updated_at: new Date(),
    })
    .select("id").single();
  if (error) throw error;
  return { action: "saved", id: data?.id };
}

// =============================================================
// RAG SOURCE 3: TEACHER TRAINING CHUNKS
// =============================================================

export async function retrieveTeacherChunks(teacherId, query, limit = 4, subject = null) {
  if (!teacherId) return [];

  const embedding = await embedQueryOrNull(query);

  const { data, error } = await supabase.rpc("match_training_chunks", {
    p_teacher_id:      teacherId,
    p_query_embedding: embedding,
    p_match_count:     limit,
    p_query_text:      query,
    // training_chunks has no subject column — the ingest writes it into
    // metadata, and the RPC reads it from there.
    p_subject:         subject,
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
    : retrieveAgentKnowledge(agentId, query, agentLimit, subject);

  const [agentChunks, studentChunks, teacherChunks] = await Promise.all([
    agentChunksPromise,
    // Subject narrows every source, not just the agent's own. Retrieving a
    // Social Studies note for a Mathematics question wasted a slot in the
    // prompt and gave the model something plausible to go wrong with.
    retrieveStudentKnowledge(studentId, query, studentLimit, subject),
    retrieveTeacherChunks(teacherId, query, teacherLimit, subject),
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

/**
 * subjectMastery — how much this agent actually knows in ONE subject.
 * The agent's stored `level` is GLOBAL, so an agent made expert by Biology
 * sessions would otherwise *act* expert in Chemistry it has never been taught.
 * This scopes the expressed intelligence to the subject at hand.
 *
 * Returns { chunks, avgConfidence, topics, level } where level is a 1-10
 * subject-local level derived from breadth (topics), depth (chunks) and
 * confidence.
 */
export async function subjectMastery(agentId, subject) {
  const empty = { chunks: 0, avgConfidence: 0, topics: 0, level: 1 };
  if (!agentId || !subject) return empty;
  try {
    const { data } = await supabase.schema("edu").from("agent_knowledge")
      .select("topic, confidence")
      .eq("agent_id", agentId)
      .ilike("subject", subject)
      .limit(500);
    if (!data?.length) return empty;

    const topics = new Set(data.map((r) => (r.topic || "").toLowerCase().trim()).filter(Boolean));
    const avg = data.reduce((s, r) => s + (Number(r.confidence) || 0), 0) / data.length;
    // Breadth + depth + confidence → a 1-10 subject level.
    const breadth = Math.min(4, topics.size);                 // up to 4
    const depth   = Math.min(4, Math.floor(data.length / 6)); // up to 4
    const conf    = avg >= 0.7 ? 2 : avg >= 0.4 ? 1 : 0;      // up to 2
    return {
      chunks: data.length, avgConfidence: Math.round(avg * 100),
      topics: topics.size, level: Math.max(1, breadth + depth + conf),
    };
  } catch { return empty; }
}
