// =============================================================
// agents/student/knowledgeRead.js — the read models over edu.agent_knowledge
// and the session-delta history. No embeddings: these are simple reads (or a
// topic-level health summary) used by dashboards, decay review and chat.
// =============================================================

import { supabase } from "./supabase.js";

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
