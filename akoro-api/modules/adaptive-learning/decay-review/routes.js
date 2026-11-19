/**
 * decay-review/routes.js — the Decay Review over HTTP (Phase 8), the
 * learner's own reviews only.
 *
 *   GET  /api/adaptive/decay-reviews                 open reviews
 *   POST /api/adaptive/decay-reviews { topic, subject?, notificationId? }   start (the Review tap)
 *   GET  /api/adaptive/decay-reviews/:id             one review (state, check, recall round, outcome)
 *   POST /api/adaptive/decay-reviews/:id/hint        the next hint (cue → partial)
 *   POST /api/adaptive/decay-reviews/:id/answer { answer }   one recall answer, server-scored
 *   POST /api/adaptive/decay-reviews/:id/abandon     the learner left it
 */
import { Router } from "express";
import { decayReview } from "./wiring.js";
import { getOrCreateStudentAgent, getAgentKnowledgeBySubject, getTopicsBySubject } from "../agents/student/knowledge.js";
import { decayEngine } from "../agents/student/decayEngine.js";

const router = Router();
const isId = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const handle = (fn) => async (req, res) => {
  try { res.json({ success: true, ...(await fn(req)) }); }
  catch (e) { res.status(e.status || 500).json({ success: false, error: e.status ? e.message : "Something went wrong with the review." }); if (!e.status) console.warn("[decay-review]", e.message); }
};
const idOf = (req) => { if (!isId(req.params.id)) throw Object.assign(new Error("Review not found"), { status: 404 }); return req.params.id; };

router.get("/", handle(async (req) => ({ reviews: await decayReview().listOpen(req.user.id) })));
router.post("/", handle(async (req) => ({ review: await decayReview().start({
  learnerId: req.user.id, topic: req.body?.topic, subject: req.body?.subject || null,
  notificationId: isId(req.body?.notificationId) ? req.body.notificationId : null,
}) })));
router.get("/:id", handle(async (req) => ({ review: await decayReview().view({ workflowId: idOf(req), learnerId: req.user.id }) })));
router.post("/:id/hint", handle(async (req) => ({ review: await decayReview().hint({ workflowId: idOf(req), learnerId: req.user.id }) })));
router.post("/:id/answer", handle(async (req) => {
  const { view, result } = await decayReview().answer({ workflowId: idOf(req), learnerId: req.user.id, answer: String(req.body?.answer || "") });
  return { review: view, result };
}));
router.post("/:id/abandon", handle(async (req) => ({ review: await decayReview().abandon({ workflowId: idOf(req), learnerId: req.user.id }) })));

/**
 * The knowledge-health (decay) routes, mounted by chat.js at /api/adaptive/chat
 * + /decay — the original v3.1 surface. They read the authenticated learner's
 * own student agent; the :studentId segment is vestigial, as it was inline.
 *
 *   GET  /decay/status/:studentId
 *   GET  /decay/alerts/:studentId
 *   GET  /decay/subjects/:studentId
 *   GET  /decay/topics/:studentId/:subject
 *   POST /decay/acknowledge/:notifId
 *   POST /decay/run
 */
export const decayRoutes = Router();

// GET /decay/status/:studentId — full knowledge health dashboard
decayRoutes.get("/status/:studentId", async (req, res) => {
  try {
    const agent     = await getOrCreateStudentAgent(req.user.id);
    const dashboard = await decayEngine.getKnowledgeDashboard(req.user.id, agent.id);
    res.json({ success: true, agentId: agent.id, dashboard });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/alerts/:studentId — unread decay notifications + subtopic alerts
decayRoutes.get("/alerts/:studentId", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const studentId = req.user.id;

    // Original topic-level notifications
    const notifications = await decayEngine.getUnreadNotifications(
      studentId, Number(limit)
    );

    // Subtopic-level alerts from knowledge_confidence table
    const subtopicAlerts = await decayEngine.getSubtopicAlerts(studentId);

    // Merge: subtopic alerts take priority, deduplicate by sessionId
    const seenSessions = new Set();
    const alerts = [];

    for (const a of subtopicAlerts) {
      // Only dedupe by a REAL sessionId — subtopic alerts without a session
      // (session_id null) are distinct rows and must all be kept, else they
      // all collapse onto the single `null` key.
      if (a.sessionId && seenSessions.has(a.sessionId)) continue;
      if (a.sessionId) seenSessions.add(a.sessionId);
      alerts.push(a);
    }

    // Add topic-level notifications not already covered by subtopic alerts
    for (const n of notifications) {
      const sessionMatch = subtopicAlerts.find(a =>
        a.topic === n.topic && a.subject === n.subject
      );
      if (!sessionMatch) {
        alerts.push({
          id:              n.id,
          sessionId:       n.session_id || null,
          topic:           n.topic,
          subtopic:        n.subtopic || n.topic,
          subject:         n.subject,
          confidence:      Math.round((n.confidence ?? 0.5) * 100),
          prevConfidence:  Math.round((n.prev_confidence ?? 0.7) * 100),
          daysSince:       n.days_since_review || 0,
          misconceptions:  n.misconceptions || [],
        });
      }
    }

    res.json({
      success: true,
      alerts,                       // ← frontend uses this shape
      notifications,                // keep for backward compat
      count: alerts.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/subjects/:studentId — all subjects + confidence summary
decayRoutes.get("/subjects/:studentId", async (req, res) => {
  try {
    const agent    = await getOrCreateStudentAgent(req.user.id);
    const subjects = await getAgentKnowledgeBySubject(agent.id);
    res.json({ success: true, subjects, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/topics/:studentId/:subject — topics in a subject with health
decayRoutes.get("/topics/:studentId/:subject", async (req, res) => {
  try {
    const agent  = await getOrCreateStudentAgent(req.user.id);
    const topics = await getTopicsBySubject(agent.id, req.params.subject);
    res.json({ success: true, subject: req.params.subject, topics, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/acknowledge/:notifId — mark notification as read
decayRoutes.post("/acknowledge/:notifId", async (req, res) => {
  try {
    // A notification UUID is not authorization. The decay engine scopes the
    // update to the authenticated learner so one learner cannot acknowledge
    // another learner's alert.
    const acknowledged = await decayEngine.markNotificationRead(req.params.notifId, req.user.id);
    res.json({ success: true, acknowledged, notificationId: req.params.notifId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/run — manually trigger decay check for a student (admin/dev use)
decayRoutes.post("/run", async (req, res) => {
  try {
    const runAll = req.body?.all === true;
    if (runAll) {
      // Full scheduler across every agent — admin only.
      if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const result = await decayEngine.runDecayScheduler(null);
      return res.json({ success: true, ...result });
    }
    // Otherwise run decay for the authenticated caller's own agent.
    const agent       = await getOrCreateStudentAgent(req.user.id);
    const alertTopics = await decayEngine.applyDecay(agent.id);
    res.json({ success: true, agentId: agent.id, alertTopics, count: alertTopics.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
