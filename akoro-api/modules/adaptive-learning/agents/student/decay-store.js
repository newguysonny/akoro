// =============================================================
// agents/student/decay-store.js
// Database queries for the decay engine (agent_knowledge,
// decay_notifications, knowledge_confidence).
// =============================================================

import db from "../../../../db.js";
import { openai } from "../../../../lib/aiModel.js";
import { buildDecayMustKnowPrompt } from "../../../agent-context/index.js";

// The app's one database client (metered like every other query; it used to
// create a second, unmetered client of its own). Resolved per call, so tests
// can point db.js at an in-memory store.
const supabase = {
  schema: (...a) => db.schema(...a),
  from: (...a) => db.from(...a),
  rpc: (...a) => db.rpc(...a),
};

// ── Find topics that need review ─────────────────────────────
export async function findTopicsNeedingReview(agentId, limit = 10) {
  const { data, error } = await supabase
    .schema("edu").from("agent_topic_health")
    .select("*")
    .eq("agent_id", agentId)
    .or("health_status.eq.critical,health_status.eq.high,next_review_due.lte." + new Date().toISOString())
    .order("confidence", { ascending: true })
    .limit(limit);

  if (error) return [];
  return data || [];
}

// ── Find decayed topics grouped by subject ───────────────────
export async function getKnowledgeHealthBySubject(agentId) {
  const { data, error } = await supabase
    .schema("edu").from("agent_knowledge_by_subject")
    .select("*")
    .eq("agent_id", agentId)
    .order("avg_confidence", { ascending: true });

  if (error) return [];
  return data || [];
}

// ── Get unread notifications for a student ───────────────────
export async function getUnreadNotifications(studentId, limit = 20) {
  const { data, error } = await supabase
    .schema("edu").from("decay_notifications")
    .select("*")
    .eq("student_id", studentId)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

// ── Mark notification as read ────────────────────────────────
// Notification ids travel through a browser and are therefore never authority
// by themselves. Scope every mutation to the authenticated learner, too.
export async function markNotificationRead(notificationId, studentId) {
  if (!notificationId || !studentId) return false;
  const { data, error } = await supabase
    .schema("edu").from("decay_notifications")
    .update({ is_read: true, read_at: new Date() })
    .eq("id", notificationId)
    .eq("student_id", studentId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// ── Mark notification as actioned (session started) ──────────
export async function markNotificationActioned(notificationId, sessionId, studentId) {
  if (!notificationId || !studentId) return false;
  const { data, error } = await supabase
    .schema("edu").from("decay_notifications")
    .update({
      is_actioned: true,
      actioned_at: new Date(),
      session_id:  sessionId,
      is_read:     true,
      read_at:     new Date(),
    })
    .eq("id", notificationId)
    .eq("student_id", studentId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// ── Get full knowledge health dashboard for a student ────────
export async function getKnowledgeDashboard(engine, studentId, agentId) {
  const [subjectHealth, topicHealth, unread, recentEvents] = await Promise.all([
    engine.getKnowledgeHealthBySubject(agentId),
    engine.findTopicsNeedingReview(agentId, 20),
    engine.getUnreadNotifications(studentId),
    supabase
      .schema("edu").from("decay_events")
      .select("subject, topic, event_type, confidence_before, confidence_after, created_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(r => r.data || []),
  ]);

  // Count by priority
  const alerts = {
    critical: topicHealth.filter(t => t.health_status === "critical").length,
    high:     topicHealth.filter(t => t.health_status === "high").length,
    medium:   topicHealth.filter(t => t.health_status === "medium").length,
  };

  return {
    subjectHealth,
    topicsNeedingReview: topicHealth,
    unreadNotifications: unread,
    recentEvents,
    alerts,
    summary: {
      totalSubjects:  subjectHealth.length,
      totalTopics:    subjectHealth.reduce((s, x) => s + (x.topic_count || 0), 0),
      avgConfidence:  subjectHealth.length > 0
        ? Math.round((subjectHealth.reduce((s, x) => s + (x.avg_confidence || 0), 0) / subjectHealth.length) * 100)
        : 0,
      topicsNeedingAttention: alerts.critical + alerts.high,
      unreadAlerts:   unread.length,
    },
  };
}

// ── Get all subtopics below the review threshold ─────────────
/**
 * Get all subtopics for a student that are below the review threshold.
 * Returns structured alert objects matching the frontend MOCK_DECAY_ALERTS shape.
 */
export async function getSubtopicAlerts(studentId) {
  const { data, error } = await supabase
    .schema("edu")
    .from("knowledge_confidence")
    .select("*")
    .eq("student_id", studentId)
    .lt("confidence", 72)   // below medium threshold
    .order("confidence", { ascending: true });

  if (error || !data?.length) return [];

  return data.map(row => ({
    id:              `dec-${row.id}`,
    sessionId:       row.session_id,
    topic:           row.topic,
    subtopic:        row.subtopic,
    subject:         row.subject,
    confidence:      Math.round(row.confidence),
    prevConfidence:  Math.round(row.prev_confidence),
    daysSince:       Math.round(
      (Date.now() - new Date(row.last_assessed).getTime()) / 86_400_000
    ),
    misconceptions:  row.misconceptions || [],
  }));
}

// ── Must-know parts for a topic with no concept rows ─────────
export async function getMustKnowForTopic(subject, topic) {
  try {
    const res = await openai.chat.completions.create({
      // Runs on a nightly cron, outside any request, so nothing sets the
      // feature for it — without this its cost is unattributable.
      __feature: "decay_engine",
      model: "gpt-4.1-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: await buildDecayMustKnowPrompt(),
        },
        { role: "user", content: `Subject: ${subject}, Topic: ${topic}` },
      ],
    });
    return JSON.parse(res.choices[0].message.content).mustKnow || [];
  } catch {
    return [topic];
  }
}
