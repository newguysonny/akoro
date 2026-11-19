// =============================================================
// agents/student/decayEngine.js
// Decay & Memory Engine — standalone, one file.
//
// Responsibilities:
//   1. Calculate confidence decay per topic over time
//   2. Detect topics that need review
//   3. Generate decay session payloads (subject + topic focused)
//   4. Push notifications via WebSocket
//   5. Reinforce confidence on successful review
//   6. Run scheduled decay checks (called by cron)
// =============================================================

import db from "../../../../db.js";
import { embed } from "./knowledge.js";

// The app's one database client (metered like every other query; it used to
// create a second, unmetered client of its own). Resolved per call, so tests
// can point db.js at an in-memory store.
const supabase = {
  schema: (...a) => db.schema(...a),
  from: (...a) => db.from(...a),
  rpc: (...a) => db.rpc(...a),
};
import { openai } from "../../../../lib/aiModel.js";
import { buildDecayMustKnowPrompt } from "../../../agent-context/index.js";
import { retainedConfidence, afterReview, outcomeForScore, topicHealth, conceptName, RETENTION } from "./retention.js";

// =============================================================
// DECAY CONFIGURATION
// =============================================================

export const DECAY_CONFIG = {
  // Base decay per day (10% default)
  baseDecayRate: 0.10,

  // Decay slows as mastery increases
  masteryMultiplier: {
    0: 1.00,  // 0–20%  confidence → full decay speed
    1: 0.85,  // 21–40%
    2: 0.70,  // 41–60%
    3: 0.55,  // 61–80%
    4: 0.40,  // 81–100% → slowest decay
  },

  // Confidence thresholds for priority levels
  priorityThresholds: {
    critical: 0.35,  // < 35%  — teach NOW
    high:     0.55,  // < 55%  — teach soon
    medium:   0.72,  // < 72%  — review this week
    low:      1.00,  // 72%+   — healthy
  },

  // Days between reviews per priority level
  reviewIntervals: {
    critical: 1,
    high:     3,
    medium:   7,
    low:      14,
  },

  // Confidence gain per review
  reinforcementRate: {
    correct:   0.20,  // +20% on correct recall
    partial:   0.10,  // +10% on partial recall
    incorrect: 0.02,  // +2%  — at least reviewed it
  },

  // Minimum confidence floor
  minConfidence: 0.05,
};

// =============================================================
// CORE DECAY MATH
// =============================================================

/**
 * Calculate current confidence after time decay.
 * Decay slows as mastery level increases.
 */
export function calculateDecayedConfidence(confidence, daysSinceReview, decayRate) {
  const masteryBucket = Math.min(4, Math.floor(confidence * 5));
  const multiplier    = DECAY_CONFIG.masteryMultiplier[masteryBucket] || 1.0;
  const effectiveRate = decayRate * multiplier;
  const decayAmount   = effectiveRate * daysSinceReview;
  return Math.max(
    DECAY_CONFIG.minConfidence,
    Math.min(0.98, confidence - decayAmount)
  );
}

/**
 * Determine priority from confidence level.
 */
export function getPriority(confidence) {
  const t = DECAY_CONFIG.priorityThresholds;
  if (confidence < t.critical) return "critical";
  if (confidence < t.high)     return "high";
  if (confidence < t.medium)   return "medium";
  return "low";
}

/**
 * Calculate when the next review is due.
 */
export function getNextReviewDate(confidence, priority) {
  const days = DECAY_CONFIG.reviewIntervals[priority] ||
               DECAY_CONFIG.reviewIntervals.low;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// =============================================================
// DECAY ENGINE CLASS
// =============================================================

export class DecayEngine {
  constructor(wsManager = null) {
    this.wsManager = wsManager; // Socket.io instance — set after construction
  }

  setWsManager(io) {
    this.wsManager = io;
  }

  // ── Apply live decay to every concept an agent knows (D44) ──
  /**
   * Each concept (agent_knowledge row: topic + subtopic) is recomputed from
   * its last review on the slow forgetting curve (retention.js) — never from
   * last night's decayed value, which made forgetting accelerate. Updates
   * confidence, priority, next_review_due.
   *
   * Returns one entry per TOPIC that has a faded concept (high / critical, or
   * whose priority just worsened), with the topic's health from all of its
   * concepts and the faded ones named.
   */
  async applyDecay(agentId) {
    const { data: rows, error } = await supabase
      .schema("edu").from("agent_knowledge")
      .select("*")
      .eq("agent_id", agentId);

    if (error || !rows?.length) return [];

    const now = Date.now();
    const ORDER = { low: 0, medium: 1, high: 2, critical: 3 };
    const fadedKeys = new Set();

    for (const row of rows) {
      const base = row.learned_at || row.last_seen_at;
      if (!base) continue;
      const daysSince = Math.max(0, (now - new Date(base).getTime()) / 86_400_000);
      const prevConf = Number(row.confidence ?? 0.5);
      const newConf = retainedConfidence({
        learned: row.learned_confidence ?? prevConf, daysSince, stabilityDays: row.stability_days ?? RETENTION.initialStabilityDays,
      });
      const prevPrio = row.priority || "low";
      const newPrio = getPriority(newConf);
      row.days_since_review = Math.round(daysSince);
      if (Math.abs(newConf - prevConf) < 0.005 && newPrio === prevPrio) continue;   // nothing to record

      row.confidence = newConf;
      row.priority = newPrio;
      await supabase
        .schema("edu").from("agent_knowledge")
        .update({ confidence: newConf, priority: newPrio, next_review_due: getNextReviewDate(newConf, newPrio), updated_at: new Date() })
        .eq("id", row.id);

      await supabase.schema("edu").from("decay_events").insert({
        agent_id:          agentId,
        student_id:        row.student_id,
        subject:           row.subject,
        topic:             row.topic,
        event_type:        "decay_calculated",
        confidence_before: prevConf,
        confidence_after:  newConf,
        days_since_review: Math.round(daysSince),
        decay_amount:      prevConf - newConf,
        metadata:          { concept: conceptName(row), stability_days: row.stability_days ?? RETENTION.initialStabilityDays, priority_before: prevPrio, priority_after: newPrio },
      });

      if ((ORDER[newPrio] || 0) > (ORDER[prevPrio] || 0) || newConf < DECAY_CONFIG.priorityThresholds.high) {
        fadedKeys.add(`${row.topic.toLowerCase()}`);
      }
    }

    // One entry per topic with a faded concept; its health comes from ALL of
    // the topic's concepts (a learner can forget one, not the whole topic).
    const byTopic = new Map();
    for (const row of rows) {
      const key = row.topic.toLowerCase();
      if (!fadedKeys.has(key)) continue;
      if (!byTopic.has(key)) byTopic.set(key, []);
      byTopic.get(key).push(row);
    }
    return [...byTopic.values()].map((topicRows) => {
      const health = topicHealth(topicRows);
      return {
        student_id:        topicRows[0].student_id,
        subject:           topicRows[0].subject,
        topic:             topicRows[0].topic,
        confidence:        health.confidence,
        priority:          health.priority,
        concepts:          health.faded,
        days_since_review: Math.max(...topicRows.map((r) => r.days_since_review || 0)),
        stability_days:    Math.min(...topicRows.map((r) => Number(r.stability_days) || RETENTION.initialStabilityDays)),
      };
    });
  }

  // ── Find topics that need review ─────────────────────────────
  async findTopicsNeedingReview(agentId, limit = 10) {
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
  async getKnowledgeHealthBySubject(agentId) {
    const { data, error } = await supabase
      .schema("edu").from("agent_knowledge_by_subject")
      .select("*")
      .eq("agent_id", agentId)
      .order("avg_confidence", { ascending: true });

    if (error) return [];
    return data || [];
  }

  // ── Generate a decay review session payload ──────────────────
  /**
   * A review of one topic, built from its concepts (D44): the faded concepts
   * come first in the lesson, then the rest weakest-first. No model call is
   * needed when the topic has concepts; only a topic with none falls back to
   * asking for its must-know parts.
   */
  async generateDecaySession(agentId, studentId, subject, topic) {
    // Every concept row of the topic. (This used .single(), which fails once a
    // topic has more than one concept, and then silently used 0.30; and it
    // required an exact subject, which drifts between spellings.)
    const { data: rows } = await supabase
      .schema("edu").from("agent_knowledge")
      .select("*")
      .eq("agent_id", agentId)
      .ilike("topic", topic);
    const all = rows || [];
    const sameSubject = subject ? all.filter((r) => String(r.subject || "").toLowerCase() === String(subject).toLowerCase()) : [];
    const topicRows = sameSubject.length ? sameSubject : all;
    const health = topicHealth(topicRows);

    const confidence = health.confidence ?? 0.30;
    const oldest = topicRows.reduce((min, r) => {
      const t = new Date(r.learned_at || r.last_seen_at || Date.now()).getTime();
      return t < min ? t : min;
    }, Date.now());
    const daysSince = Math.round((Date.now() - oldest) / 86_400_000);
    const priority = health.priority ?? getPriority(confidence);
    const reviewCount = topicRows.reduce((n, r) => n + (Number(r.times_seen) || 0), 0);
    const stability = topicRows.length ? Math.min(...topicRows.map((r) => Number(r.stability_days) || RETENTION.initialStabilityDays)) : RETENTION.initialStabilityDays;
    const resolvedSubject = subject || topicRows[0]?.subject || null;

    // The lesson: faded concepts first, then the rest weakest-first. The
    // topic-level row (no subtopic) isn't a concept of its own.
    const named = health.concepts.filter((c) => c.concept.toLowerCase() !== String(topic).toLowerCase());
    const mustKnowParts = named.length ? named.map((c) => c.concept) : await this._getMustKnowForTopic(resolvedSubject, topic);

    return {
      sessionId:      `DECAY-${resolvedSubject}-${topic}-${Date.now()}`,
      type:           "decay_review",
      subject:        resolvedSubject,
      topic,
      title:          this._buildSessionTitle(topic, confidence),
      description:    this._buildSessionDescription(resolvedSubject, topic, confidence, daysSince),
      confidence,
      priority,
      daysSinceReview: daysSince,
      reviewCount,
      teachingGoal:   this._buildTeachingGoal(topic, confidence),
      mustKnowParts,
      fadedConcepts:  health.faded,
      concepts:       health.concepts,
      decayMetadata: {
        currentConfidence:  confidence,
        daysSinceReview:    daysSince,
        reason:             "knowledge_decay",
        reviewNeeded:       true,
        stabilityDays:      stability,
        reviewCount,
        projectedIn7Days:   retainedConfidence({ learned: confidence, daysSince: 7, stabilityDays: stability }),
      },
    };
  }

  // ── Reinforce knowledge after a review (D44) ─────────────────
  /**
   * Each concept the review actually reached moves back up and will fade
   * more slowly next time (stability grows on a good review). `conceptOutcomes`
   * ({ conceptName: "correct" | "partial" | "incorrect" }, from the session's
   * teaching evidence) decides per concept; a concept the session never
   * reached is NOT reinforced. Without it, the session score applies to every
   * concept of the topic. (This used .single(), which found nothing once a
   * topic had more than one concept — so reviews reinforced nothing.)
   */
  async reinforceKnowledge(agentId, studentId, subject, topic, performanceScore, sessionId, { conceptOutcomes = null } = {}) {
    const overall = outcomeForScore(Number(performanceScore) || 0);
    const { data: rows } = await supabase
      .schema("edu").from("agent_knowledge")
      .select("id, subtopic, topic, subject, confidence, stability_days, times_seen")
      .eq("agent_id", agentId)
      .ilike("topic", topic);
    if (!rows?.length) return null;

    const outcomes = conceptOutcomes && typeof conceptOutcomes === "object"
      ? Object.fromEntries(Object.entries(conceptOutcomes).map(([k, v]) => [String(k).trim().toLowerCase(), v]))
      : null;
    const touched = [];
    for (const row of rows) {
      const name = conceptName(row);
      const outcome = outcomes ? outcomes[name.toLowerCase()] : overall;
      if (!outcome) continue;   // not reached in this review — it keeps fading
      const prevConf = Number(row.confidence ?? 0.5);
      const next = afterReview({ current: prevConf, stabilityDays: row.stability_days ?? RETENTION.initialStabilityDays, outcome });
      const newPrio = getPriority(next.learned);
      await supabase.schema("edu").from("agent_knowledge").update({
        confidence:         next.learned,
        learned_confidence: next.learned,
        learned_at:         new Date(),
        stability_days:     next.stabilityDays,
        priority:           newPrio,
        next_review_due:    getNextReviewDate(next.learned, newPrio),
        times_seen:         (row.times_seen || 0) + 1,
        last_seen_at:       new Date(),
        updated_at:         new Date(),
      }).eq("id", row.id);
      await supabase.schema("edu").from("decay_events").insert({
        agent_id: agentId, student_id: studentId, subject: row.subject || subject, topic: row.topic,
        event_type: "reinforced", confidence_before: prevConf, confidence_after: next.learned, days_since_review: 0,
        decay_amount: -(next.learned - prevConf), session_id: sessionId,
        metadata: { concept: name, reinforcement_type: outcome, stability_days: next.stabilityDays, performance_score: performanceScore },
      });
      touched.push({ concept: name, outcome, before: prevConf, after: next.learned, stabilityDays: next.stabilityDays });
    }
    if (!touched.length) return { confidenceBefore: null, confidenceAfter: null, reinforcementType: overall, gain: 0, concepts: [] };

    const before = touched.reduce((n, c) => n + c.before, 0) / touched.length;
    const after = touched.reduce((n, c) => n + c.after, 0) / touched.length;
    const newPriority = getPriority(after);
    return {
      confidenceBefore:  before,
      confidenceAfter:   after,
      reinforcementType: overall,
      gain:              after - before,
      newPriority,
      nextReviewDue:     getNextReviewDate(after, newPriority),
      concepts:          touched,
    };
  }

  // ── Send decay alerts via WebSocket ──────────────────────────
  /**
   * One alert per topic, naming the concepts that faded (D44). A topic that
   * already has an alert the learner hasn't acted on isn't alerted again —
   * the nightly pass used to add one every night. Saved to the database, the
   * bell, and the student's socket room.
   */
  async sendDecayAlert(io, studentId, agentId, decayedTopics) {
    if (!decayedTopics?.length) return 0;
    let sent = 0;

    for (const t of decayedTopics) {
      const { data: open } = await supabase
        .schema("edu").from("decay_notifications")
        .select("id").eq("student_id", studentId).ilike("topic", t.topic).eq("is_actioned", false).limit(1);
      if (open?.length) continue;

      const concepts = (t.concepts || []).map((c) => ({ concept: c.concept, confidence: Number(c.confidence.toFixed(3)), priority: c.priority }));
      const message = this._buildAlertMessage(t.subject, t.topic, t.confidence, t.days_since_review, concepts.map((c) => c.concept));

      const { data: notif } = await supabase
        .schema("edu").from("decay_notifications")
        .insert({
          student_id: studentId,
          agent_id:   agentId,
          subject:    t.subject || "general",
          topic:      t.topic,
          confidence: t.confidence,
          priority:   t.priority,
          message,
          concepts,
        })
        .select("id")
        .single();

      try {
        await supabase.from("notifications").insert({
          user_id:    studentId,
          type:       "knowledge_decay",
          title:      `Revise ${t.topic}`,
          content:    message,
          related_id: notif?.id ?? null,
          is_read:    false,
        });
      } catch (e) {
        console.warn("[decay] bell notification insert failed:", e.message);
      }

      if (io) {
        io.to(`student:${studentId}`).emit("knowledge_decay_alert", {
          notificationId: notif?.id,
          subject:        t.subject,
          topic:          t.topic,
          confidence:     Math.round(t.confidence * 100),
          priority:       t.priority,
          daysSinceReview: t.days_since_review,
          concepts:       concepts.map((c) => ({ ...c, confidence: Math.round(c.confidence * 100) })),
          message,
          decayMetadata: {
            currentConfidence: t.confidence,
            daysSinceReview:   t.days_since_review,
            projectedIn7Days:  retainedConfidence({ learned: t.confidence, daysSince: 7, stabilityDays: t.stability_days || RETENTION.initialStabilityDays }),
          },
          sessionPayload: {
            subject:        t.subject,
            topic:          t.topic,
            type:           "decay_review",
            title:          this._buildSessionTitle(t.topic, t.confidence),
            priority:       t.priority,
          },
          timestamp: new Date().toISOString(),
        });
      }

      await supabase.schema("edu").from("decay_events").insert({
        agent_id:          agentId,
        student_id:        studentId,
        subject:           t.subject,
        topic:             t.topic,
        event_type:        "alert_sent",
        confidence_before: t.confidence,
        confidence_after:  t.confidence,
        days_since_review: t.days_since_review,
        decay_amount:      0,
        metadata:          { priority: t.priority, notification_id: notif?.id, concepts: concepts.map((c) => c.concept) },
      });
      sent++;
    }
    return sent;
  }

  // ── Scheduled decay runner ───────────────────────────────────
  /**
   * Called by a cron job (e.g. every hour or nightly).
   * Runs decay for all active agents, sends alerts.
   */
  async runDecayScheduler(io) {
    console.log("[DecayEngine] Running scheduled decay check...");

    // Get all active student agents
    const { data: agents } = await supabase
      .schema("edu").from("student_agents")
      .select("id, student_id, total_sessions")
      .gt("total_sessions", 0); // Only agents that have been used

    if (!agents?.length) {
      console.log("[DecayEngine] No active agents found.");
      return { processed: 0, alertsSent: 0 };
    }

    let processed  = 0;
    let alertsSent = 0;

    for (const agent of agents) {
      try {
        // 1. Apply decay to all topics (topic-level)
        const alertTopics = await this.applyDecay(agent.id);

        // 2. Apply decay to all subtopics (knowledge_confidence table)
        const subtopicAlerts = await this.applySubtopicDecay(agent.student_id);

        // 3. Send alerts for decayed topics
        if (alertTopics.length > 0) {
          alertsSent += await this.sendDecayAlert(io, agent.student_id, agent.id, alertTopics);
        }

        // 4. Send WebSocket alerts for decayed subtopics
        if (subtopicAlerts.length > 0 && io) {
          io.to(`student:${agent.student_id}`).emit("subtopic_decay_alert", {
            studentId: agent.student_id,
            alerts:    subtopicAlerts,
          });
          alertsSent += subtopicAlerts.length;
        }

        processed++;

        // Small delay to avoid DB overload
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        console.error(`[DecayEngine] Error processing agent ${agent.id}:`, err.message);
      }
    }

    console.log(`[DecayEngine] Done. Processed: ${processed} agents, Alerts: ${alertsSent}`);
    return { processed, alertsSent };
  }

  // ── Get unread notifications for a student ───────────────────
  async getUnreadNotifications(studentId, limit = 20) {
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
  async markNotificationRead(notificationId, studentId) {
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
  async markNotificationActioned(notificationId, sessionId, studentId) {
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
  async getKnowledgeDashboard(studentId, agentId) {
    const [subjectHealth, topicHealth, unread, recentEvents] = await Promise.all([
      this.getKnowledgeHealthBySubject(agentId),
      this.findTopicsNeedingReview(agentId, 20),
      this.getUnreadNotifications(studentId),
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

  // ── PRIVATE HELPERS ──────────────────────────────────────────

  _buildSessionTitle(topic, confidence) {
    const t = topic.charAt(0).toUpperCase() + topic.slice(1);
    if (confidence < 0.35) return `Urgent Review: ${t}`;
    if (confidence < 0.55) return `Strengthen: ${t} Fundamentals`;
    if (confidence < 0.72) return `Mastery Check: ${t}`;
    return `Reinforce: ${t}`;
  }

  _buildSessionDescription(subject, topic, confidence, daysSince) {
    const t = topic.charAt(0).toUpperCase() + topic.slice(1);
    const pct = Math.round(confidence * 100);
    if (daysSince > 7) {
      return `⚠️ It's been ${daysSince} days since your agent was taught ${t}. Knowledge has decayed to ${pct}%. Teach it again to lock this in.`;
    }
    if (confidence < 0.40) {
      return `📉 Your agent's ${t} knowledge is at ${pct}% — it's struggling with this topic. A focused session will make a big difference.`;
    }
    return `🔄 Your agent's ${t} knowledge (${pct}%) can be strengthened. Spaced repetition builds long-term retention.`;
  }

  _buildTeachingGoal(topic, confidence) {
    if (confidence < 0.40) return `Rebuild core understanding of ${topic} from scratch`;
    if (confidence < 0.65) return `Reinforce the key principles of ${topic}`;
    return `Push ${topic} knowledge from ${Math.round(confidence * 100)}% toward mastery`;
  }

  /** The alert text: which concepts are fading, in which topic (D44). Plain text, no emoji. */
  _buildAlertMessage(subject, topic, confidence, daysSince, concepts = []) {
    const cap = (v) => (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1) : "");
    const where = subject ? `${cap(subject)} — ${cap(topic)}` : cap(topic);
    const pct = Math.round((Number(confidence) || 0) * 100);
    const names = (concepts || []).filter(Boolean);
    const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    if (names.length) {
      return `Your agent is forgetting ${list} in ${where}. Teach ${names.length === 1 ? "it" : "them"} again — a short session brings ${names.length === 1 ? "it" : "them"} back (topic at ${pct}%).`;
    }
    if (confidence < DECAY_CONFIG.priorityThresholds.critical) return `Your agent is forgetting ${where} (${pct}%). Teach it again before it's lost.`;
    return `${where} needs revision (${pct}%). A short teaching session will reinforce it.`;
  }

  async _getMustKnowForTopic(subject, topic) {
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
}

// Singleton export
export const decayEngine = new DecayEngine();

// ================================================================
// SUBTOPIC-LEVEL DECAY — works against edu.knowledge_confidence
// ================================================================

/**
 * Apply Ebbinghaus decay to all subtopics in edu.knowledge_confidence.
 * Called by the daily cron job alongside applyDecay().
 * Returns array of subtopics that crossed into the alert threshold.
 */
DecayEngine.prototype.applySubtopicDecay = async function(studentId) {
  const { data: rows, error } = await supabase
    .schema("edu")
    .from("knowledge_confidence")
    .select("*")
    .eq("student_id", studentId)
    .not("last_assessed", "is", null);

  if (error || !rows?.length) return [];

  const alerts = [];

  for (const row of rows) {
    const daysSince = Math.max(
      0,
      (Date.now() - new Date(row.last_assessed).getTime()) / 86_400_000
    );
    if (daysSince < 1) continue;

    const prevConf   = row.confidence / 100;
    const decayRate  = row.decay_rate ?? DECAY_CONFIG.baseDecayRate;
    const newConf    = calculateDecayedConfidence(prevConf, daysSince, decayRate);
    const newConfPct = Math.round(newConf * 100);
    const newPrio    = getPriority(newConf);
    const nextDue    = getNextReviewDate(newConf, newPrio);

    await supabase
      .schema("edu")
      .from("knowledge_confidence")
      .update({
        prev_confidence: row.confidence,
        confidence:      newConfPct,
        next_review_due: nextDue,
        updated_at:      new Date().toISOString(),
      })
      .eq("id", row.id);

    // Alert if confidence dropped below high threshold
    const crossedThreshold =
      newConf < DECAY_CONFIG.priorityThresholds.high &&
      prevConf >= DECAY_CONFIG.priorityThresholds.high;

    if (crossedThreshold || newConf < DECAY_CONFIG.priorityThresholds.critical) {
      alerts.push({
        id:              `dec-${row.id}`,
        sessionId:       row.session_id,
        topic:           row.topic,
        subtopic:        row.subtopic,
        subject:         row.subject,
        confidence:      newConfPct,
        prevConfidence:  row.confidence,
        daysSince:       Math.round(daysSince),
        misconceptions:  row.misconceptions || [],
      });

      // Push to decay_notifications so /decay/alerts picks it up
      await supabase.schema("edu").from("decay_notifications").upsert({
        student_id:      studentId,
        subject:         row.subject,
        topic:           row.topic,
        subtopic:        row.subtopic,
        confidence:      newConf,
        prev_confidence: prevConf,
        misconceptions:  row.misconceptions || [],
        priority:        newPrio,
        status:          "unread",
        created_at:      new Date().toISOString(),
      }, { onConflict: "student_id,topic,subtopic", ignoreDuplicates: false });
    }
  }

  return alerts;
};

/**
 * Get all subtopics for a student that are below the review threshold.
 * Returns structured alert objects matching the frontend MOCK_DECAY_ALERTS shape.
 */
DecayEngine.prototype.getSubtopicAlerts = async function(studentId) {
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
};

/**
 * Update generateDecaySession to include subtopic weakness data.
 * Extends the existing method with knowledge_confidence data.
 */
const _origGenerateDecaySession = DecayEngine.prototype.generateDecaySession;
DecayEngine.prototype.generateDecaySession = async function(agentId, studentId, subject, topic) {
  const base = await _origGenerateDecaySession.call(this, agentId, studentId, subject, topic);

  // Enrich with per-subtopic confidence data.
  //
  // try/catch, NOT .catch(). A Supabase query builder is a thenable — it has
  // .then() and awaits like a promise, but it is not a Promise and has no
  // .catch method. Calling .catch() on it throws synchronously, before the
  // query is even sent, and the message names the whole chain:
  //
  //   supabase.schema(...).from(...).select(...).eq(...).eq(...).order(...)
  //     .catch is not a function
  //
  // which is what a learner saw instead of a decay re-teach session.
  let subtopicConf = null;
  try {
    const { data } = await supabase
      .schema("edu")
      .from("knowledge_confidence")
      .select("subtopic, confidence, prev_confidence, misconceptions, assess_count")
      .eq("student_id", String(studentId))
      .eq("topic", topic)
      .order("confidence", { ascending: true });
    subtopicConf = data;
  } catch (e) {
    console.warn("[decay] subtopic confidence lookup failed:", e.message);
  }

  const subtopics      = subtopicConf || [];
  const weakestSubtopic = subtopics[0] || null;

  return {
    ...base,
    subtopics,
    weakestSubtopic:      weakestSubtopic?.subtopic    || null,
    weakestConfidence:    weakestSubtopic?.confidence  || base.confidence,
    subtopicMisconceptions: weakestSubtopic?.misconceptions || [],
  };
};
