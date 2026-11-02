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

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { embed } from "./knowledge.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // ── Apply live decay to all topics for an agent ─────────────
  /**
   * Run decay calculation for every topic an agent knows.
   * Updates confidence, priority, next_review_due in DB.
   * Returns topics that crossed a threshold (need notification).
   */
  async applyDecay(agentId) {
    const { data: topics, error } = await supabase
      .from("edu.agent_knowledge")
      .select("*")
      .eq("agent_id", agentId)
      .not("last_seen_at", "is", null);

    if (error || !topics?.length) return [];

    const alertTopics = [];

    for (const topic of topics) {
      const daysSince = Math.max(
        0,
        (Date.now() - new Date(topic.last_seen_at).getTime()) / 86_400_000
      );

      if (daysSince < 1) continue; // Too soon to decay

      const prevConf    = topic.confidence ?? 0.5;
      const decayRate   = topic.decay_rate   ?? DECAY_CONFIG.baseDecayRate;
      const newConf     = calculateDecayedConfidence(prevConf, daysSince, decayRate);
      const prevPrio    = topic.priority || "low";
      const newPrio     = getPriority(newConf);
      const nextDue     = getNextReviewDate(newConf, newPrio);
      const decayAmount = prevConf - newConf;

      // Update DB
      await supabase
        .from("edu.agent_knowledge")
        .update({
          confidence:      newConf,
          priority:        newPrio,
          next_review_due: nextDue,
          updated_at:      new Date(),
        })
        .eq("id", topic.id);

      // Log the decay event
      await supabase.from("edu.decay_events").insert({
        agent_id:          agentId,
        student_id:        topic.student_id,
        subject:           topic.subject,
        topic:             topic.topic,
        event_type:        "decay_calculated",
        confidence_before: prevConf,
        confidence_after:  newConf,
        days_since_review: Math.round(daysSince),
        decay_amount:      decayAmount,
        metadata:          { decay_rate: decayRate, priority_before: prevPrio, priority_after: newPrio },
      });

      // Flag if priority worsened (e.g. low → high, or high → critical)
      const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
      const pWorsened = (priorityOrder[newPrio] || 0) > (priorityOrder[prevPrio] || 0);

      if (pWorsened || newConf < DECAY_CONFIG.priorityThresholds.high) {
        alertTopics.push({
          ...topic,
          confidence:       newConf,
          priority:         newPrio,
          days_since_review: Math.round(daysSince),
          decay_amount:     decayAmount,
        });
      }
    }

    return alertTopics;
  }

  // ── Find topics that need review ─────────────────────────────
  async findTopicsNeedingReview(agentId, limit = 10) {
    const { data, error } = await supabase
      .from("edu.agent_topic_health")
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
      .from("edu.agent_knowledge_by_subject")
      .select("*")
      .eq("agent_id", agentId)
      .order("avg_confidence", { ascending: true });

    if (error) return [];
    return data || [];
  }

  // ── Generate a decay review session payload ──────────────────
  /**
   * Builds a session object that can be passed directly to
   * start_decay_session on the socket or POST /decay/session/start.
   */
  async generateDecaySession(agentId, studentId, subject, topic) {
    // Load topic health data
    const { data: topicData } = await supabase
      .from("edu.agent_knowledge")
      .select("*")
      .eq("agent_id", agentId)
      .eq("subject", subject)
      .ilike("topic", topic)
      .single();

    const confidence   = topicData?.confidence   ?? 0.30;
    const daysSince    = topicData?.last_seen_at
      ? Math.round((Date.now() - new Date(topicData.last_seen_at).getTime()) / 86_400_000)
      : 0;
    const priority     = topicData?.priority     ?? getPriority(confidence);
    const reviewCount  = topicData?.times_seen   ?? 0;
    const decayRate    = topicData?.decay_rate    ?? DECAY_CONFIG.baseDecayRate;

    // Generate a focused description
    const description  = this._buildSessionDescription(subject, topic, confidence, daysSince);
    const title        = this._buildSessionTitle(topic, confidence);

    // Load relevant teacher chunks if any
    const sessionId    = `DECAY-${subject}-${topic}-${Date.now()}`;

    return {
      sessionId,
      type:           "decay_review",     // distinct from free-teaching sessions
      subject,
      topic,
      title,
      description,
      confidence,
      priority,
      daysSinceReview: daysSince,
      reviewCount,
      decayRate,
      teachingGoal:   this._buildTeachingGoal(topic, confidence),
      mustKnowParts:  await this._getMustKnowForTopic(subject, topic),
      decayMetadata: {
        currentConfidence:  confidence,
        daysSinceReview:    daysSince,
        reason:             "knowledge_decay",
        reviewNeeded:       true,
        decayRate,
        reviewCount,
        projectedIn7Days:   Math.max(0.05, confidence - decayRate * 7),
      },
    };
  }

  // ── Reinforce knowledge after review ─────────────────────────
  /**
   * Called when a decay review session ends.
   * Boosts confidence based on how well the student taught.
   */
  async reinforceKnowledge(agentId, studentId, subject, topic, performanceScore, sessionId) {
    // performanceScore: 0–1 (from session understanding %)
    const reinforcementType =
      performanceScore >= 0.75 ? "correct" :
      performanceScore >= 0.40 ? "partial" : "incorrect";

    const { data: current } = await supabase
      .from("edu.agent_knowledge")
      .select("confidence, decay_rate, times_seen")
      .eq("agent_id", agentId)
      .eq("subject", subject)
      .ilike("topic", topic)
      .single();

    if (!current) return null;

    const prevConf      = current.confidence;
    const gain          = DECAY_CONFIG.reinforcementRate[reinforcementType];
    const newConf       = Math.min(0.98, prevConf + gain);
    const newPrio       = getPriority(newConf);
    const nextDue       = getNextReviewDate(newConf, newPrio);

    // Decay rate improves (decreases) on good reviews
    const newDecayRate  = reinforcementType === "correct"
      ? Math.max(0.04, current.decay_rate * 0.92)
      : Math.min(0.25, current.decay_rate * 1.05);

    await supabase
      .from("edu.agent_knowledge")
      .update({
        confidence:      newConf,
        priority:        newPrio,
        next_review_due: nextDue,
        decay_rate:      newDecayRate,
        times_seen:      (current.times_seen || 0) + 1,
        last_seen_at:    new Date(),
        updated_at:      new Date(),
      })
      .eq("agent_id", agentId)
      .eq("subject", subject)
      .ilike("topic", topic);

    // Log reinforcement event
    await supabase.from("edu.decay_events").insert({
      agent_id:          agentId,
      student_id:        studentId,
      subject,
      topic,
      event_type:        "reinforced",
      confidence_before: prevConf,
      confidence_after:  newConf,
      days_since_review: 0,
      decay_amount:      -(newConf - prevConf), // negative = gain
      session_id:        sessionId,
      metadata:          { reinforcement_type: reinforcementType, performance_score: performanceScore },
    });

    return {
      confidenceBefore:   prevConf,
      confidenceAfter:    newConf,
      reinforcementType,
      gain,
      newPriority:        newPrio,
      nextReviewDue:      nextDue,
    };
  }

  // ── Send decay alerts via WebSocket ──────────────────────────
  /**
   * Push a knowledge decay notification to a student's socket room.
   * Also saves the notification to DB for persistence.
   */
  async sendDecayAlert(io, studentId, agentId, decayedTopics) {
    if (!decayedTopics?.length) return;

    for (const t of decayedTopics) {
      const message = this._buildAlertMessage(t.subject, t.topic, t.confidence, t.days_since_review);

      // Save notification to DB
      const { data: notif } = await supabase
        .from("edu.decay_notifications")
        .insert({
          student_id: studentId,
          agent_id:   agentId,
          subject:    t.subject,
          topic:      t.topic,
          confidence: t.confidence,
          priority:   t.priority,
          message,
        })
        .select("id")
        .single();

      // Emit to student's socket room
      if (io) {
        io.to(`student:${studentId}`).emit("knowledge_decay_alert", {
          notificationId: notif?.id,
          subject:        t.subject,
          topic:          t.topic,
          confidence:     Math.round(t.confidence * 100),
          priority:       t.priority,
          daysSinceReview: t.days_since_review,
          message,
          decayMetadata: {
            currentConfidence: t.confidence,
            daysSinceReview:   t.days_since_review,
            projectedIn7Days:  Math.max(0.05, t.confidence - (t.decay_rate || 0.10) * 7),
          },
          // Include ready-to-use session start payload
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

      // Log alert sent
      await supabase.from("edu.decay_events").insert({
        agent_id:          agentId,
        student_id:        studentId,
        subject:           t.subject,
        topic:             t.topic,
        event_type:        "alert_sent",
        confidence_before: t.confidence,
        confidence_after:  t.confidence,
        days_since_review: t.days_since_review,
        decay_amount:      t.decay_amount || 0,
        metadata:          { priority: t.priority, notification_id: notif?.id },
      });
    }
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
      .from("edu.student_agents")
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
          await this.sendDecayAlert(io, agent.student_id, agent.id, alertTopics);
          alertsSent += alertTopics.length;
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
      .from("edu.decay_notifications")
      .select("*")
      .eq("student_id", studentId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  }

  // ── Mark notification as read ────────────────────────────────
  async markNotificationRead(notificationId) {
    await supabase
      .from("edu.decay_notifications")
      .update({ is_read: true, read_at: new Date() })
      .eq("id", notificationId);
  }

  // ── Mark notification as actioned (session started) ──────────
  async markNotificationActioned(notificationId, sessionId) {
    await supabase
      .from("edu.decay_notifications")
      .update({
        is_actioned: true,
        actioned_at: new Date(),
        session_id:  sessionId,
        is_read:     true,
        read_at:     new Date(),
      })
      .eq("id", notificationId);
  }

  // ── Get full knowledge health dashboard for a student ────────
  async getKnowledgeDashboard(studentId, agentId) {
    const [subjectHealth, topicHealth, unread, recentEvents] = await Promise.all([
      this.getKnowledgeHealthBySubject(agentId),
      this.findTopicsNeedingReview(agentId, 20),
      this.getUnreadNotifications(studentId),
      supabase
        .from("edu.decay_events")
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

  _buildAlertMessage(subject, topic, confidence, daysSince) {
    const t   = topic.charAt(0).toUpperCase() + topic.slice(1);
    const sub = subject.charAt(0).toUpperCase() + subject.slice(1);
    const pct = Math.round(confidence * 100);

    if (confidence < DECAY_CONFIG.priorityThresholds.critical) {
      return `🚨 Your agent is forgetting ${sub} — ${t}! Confidence dropped to ${pct}%. Teach it now before it's lost.`;
    }
    if (confidence < DECAY_CONFIG.priorityThresholds.high) {
      return `⚠️ ${sub} — ${t} needs revision. Agent confidence: ${pct}%. A short teaching session will reinforce this.`;
    }
    return `📚 Time to review ${sub} — ${t} with your agent (${pct}% confidence). Regular teaching keeps knowledge sharp.`;
  }

  async _getMustKnowForTopic(subject, topic) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Return 3-5 must-know concepts for this subject/topic.
JSON only: { "mustKnow": ["concept1", "concept2", ...] }`,
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

  // Enrich with per-subtopic confidence data
  const { data: subtopicConf } = await supabase
    .schema("edu")
    .from("knowledge_confidence")
    .select("subtopic, confidence, prev_confidence, misconceptions, assess_count")
    .eq("student_id", studentId)
    .eq("topic", topic)
    .order("confidence", { ascending: true })
    .catch(() => ({ data: null }));

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
