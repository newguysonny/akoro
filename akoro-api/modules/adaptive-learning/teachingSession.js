/**
 * modules/adaptive-learning/teachingSession.js
 *
 * Phase engine + endpoints for the "human teaches Student AI Agent" flow.
 *
 * Three participants:
 *   Human learner  — teaches (role:"user" on frontend)
 *   Nexus (agent)  — being taught (fetched from user_agents by studentId)
 *   NaNa Esumai    — coaches human teaching quality
 *   Sargeant       — assessment gate between subtopics
 *
 * Live-session endpoints (start / message / assess / summary) moved to WebSocket.
 * Remaining REST endpoints:
 *   POST /api/adaptive/teaching/configure          → AI generates subtopics + objectives
 *   GET  /api/adaptive/sessions                    → student's past sessions list
 *   GET  /api/adaptive/sessions/:sessionId/history → faded block history for continuation
 */

import { Router }          from "express";
import db                    from "../../db.js";
import { NaNaEsumai }        from "./agents/nana-esumai/guide.js";
import { authenticateToken } from "../auth/routes.js";

const router = Router();
const nana   = new NaNaEsumai();

async function loadSessionState(sessionId) {
  const { data, error } = await db.schema("edu")
    .from("adaptive_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error || !data) throw new Error("Session not found: " + sessionId);
  return data;
}

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 1: POST /teaching/configure
   Modal step 1 — AI generates subtopics + objectives.
   No DB write. User reviews + edits before /start.
═══════════════════════════════════════════════════════════════ */
router.post("/configure", authenticateToken, async (req, res) => {
  try {
    const { topic, subject } = req.body;
    if (!topic?.trim() || !subject?.trim())
      return res.status(400).json({ error: "topic and subject are required" });

    const subtopics = await nana.generateSubtopics(topic, subject);

    const objectivesArr = await Promise.all(
      subtopics.map(st => nana.generateObjectives(st, topic, subject))
    );
    const objectives = {};
    subtopics.forEach((st, i) => { objectives[st] = objectivesArr[i]; });

    res.json({ success: true, topic, subject, subtopics, objectives });
  } catch (err) {
    console.error("[teaching/configure]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoints 2-6 (start / message / /:sessionId / /:sessionId/assess / summary)
// moved to WebSocket — see modules/adaptive-learning/websocket.js.
// Only /configure, /sessions, and /sessions/:sessionId/history remain here.

/* ═══════════════════════════════════════════════════════════════
   GET /sessions
   Returns all past adaptive sessions for the student.
   Used by Agent tab → Sessions sub-tab.
═══════════════════════════════════════════════════════════════ */
router.get("/sessions", authenticateToken, async (req, res) => {
  try {
    const studentId = req.user?.id || req.query.studentId;
    if (!studentId) return res.status(400).json({ error: "studentId required" });

    const { data: rows, error } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("id, topic, subject, status, subtopics, objectives, updated_at, completed_at, block_history")
      .eq("student_id", studentId)
      .in("status", ["active", "complete"])
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) throw new Error(error.message);

    // Enrich with per-subtopic confidence data
    const { data: confRows } = await db.schema("edu")
      .from("knowledge_confidence")
      .select("topic, subtopic, confidence, assess_count, misconceptions")
      .eq("student_id", studentId)
      .catch(() => ({ data: [] }));

    const confByTopic = {};
    for (const c of confRows || []) {
      if (!confByTopic[c.topic]) confByTopic[c.topic] = [];
      confByTopic[c.topic].push(c);
    }

    const SUBJECTS = { science:"science", maths:"maths", english:"english",
      biology:"science", chemistry:"science", physics:"science",
      history:"english", geography:"english" };

    const sessions = (rows || []).map((s, i) => {
      const subtopics    = JSON.parse(s.subtopics || "[]");
      const topicConf    = confByTopic[s.topic] || [];
      const avgConf      = topicConf.length
        ? Math.round(topicConf.reduce((sum, c) => sum + c.confidence, 0) / topicConf.length)
        : 0;
      const totalAssess  = topicConf.reduce((sum, c) => sum + (c.assess_count || 0), 0);
      const hasHistory   = Array.isArray(s.block_history) && s.block_history.length > 0;
      const completedAt  = s.completed_at || s.updated_at;
      const daysSince    = Math.max(0, Math.round(
        (Date.now() - new Date(completedAt).getTime()) / 86_400_000
      ));

      return {
        // SessionCard shape
        id:             s.id,
        type:           "agent",
        status:         s.status,
        title:          s.topic,
        topic:          s.topic,
        subject:        SUBJECTS[s.subject?.toLowerCase()] || s.subject || "science",
        avatar:         `https://i.pravatar.cc/150?img=${(i % 30) + 10}`,
        tutor:          "AI Agent",
        level:          "Adaptive",
        startsAt:       completedAt,
        time:           new Date(completedAt).toLocaleTimeString("en-NG", { hour:"2-digit", minute:"2-digit" }),
        nextSession:    daysSince === 0 ? "Today" : daysSince === 1 ? "Yesterday" : `${daysSince}d ago`,
        topics:         subtopics.length || 1,
        revisions:      totalAssess,
        reviews:        topicConf.filter(c => c.confidence >= 70).length,
        progress:       avgConf,
        unread:         0,
        priority:       "medium",
        scheduleBucket: "later",
        // Continuation context
        hasHistory,
        avgConfidence:  avgConf,
        subtopicCount:  subtopics.length,
        subtopicList:   subtopics,
        misconceptions: topicConf.flatMap(c => c.misconceptions || []).slice(0, 3),
        daysSince,
      };
    });

    res.json({ success: true, sessions, total: sessions.length });

  } catch (err) {
    console.error("[adaptive/sessions]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ENDPOINT 8: GET /adaptive/sessions/:sessionId/history
   Returns faded block history for a continuation session.
   Called when "Continue Teaching" CTA is tapped in SessionSheet.
═══════════════════════════════════════════════════════════════ */
router.get("/sessions/:sessionId/history", authenticateToken, async (req, res) => {
  try {
    const session = await loadSessionState(req.params.sessionId);

    const completedAt = session.completed_at || session.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));

    let historyBlocks = [];
    if (Array.isArray(session.block_history) && session.block_history.length > 0) {
      historyBlocks = [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...session.block_history.map(b => ({ ...b, faded: true })),
      ];
    }

    const subtopics  = JSON.parse(session.subtopics  || "[]");
    const objectives = JSON.parse(session.objectives || "{}");

    res.json({
      success:       true,
      historyBlocks,
      topic:         session.topic,
      subject:       session.subject,
      subtopics,
      objectives,
      daysSince,
      status:        session.status,
      hasHistory:    historyBlocks.length > 0,
    });

  } catch (err) {
    console.error("[adaptive/sessions/history]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
