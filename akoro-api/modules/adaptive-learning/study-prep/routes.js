/**
 * study-prep REST surface (Master Plan §4.9). The existing exam-prep surface
 * is unchanged; these are the minimal additive session endpoints, all
 * envelope-compliant: { success: true, … } or { success: false, code, error }
 * with a stable machine-readable code on every 4xx and 500 only for genuine
 * faults. Money-adjacent pauses surface as 402 insufficient_balance.
 */

import express from "express";

import { HarnessRejection } from "./harness.js";
import { studyPrepEnabled, getHarness, runStudyPrepPlanningStep, startStudyPrepSession } from "./wiring.js";
import { supabaseStore } from "./store.js";
import { publicEvent } from "./events.js";
import { pauseCopy } from "./narration.js";

const router = express.Router();
const fail = (res, status, code, error) => res.status(status).json({ success: false, code, error });
const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

function rejection(res, error) {
  if (error instanceof HarnessRejection || error?.code) {
    return fail(res, error.httpStatus || 400, error.code || "invalid_state_transition", error.message);
  }
  console.error("[study-prep]", error?.message || error);
  return fail(res, 500, "study_prep_fault", "Study-prep could not complete this action");
}

const guard = (res) => {
  if (!studyPrepEnabled()) {
    fail(res, 409, "study_prep_disabled", "Study-prep sessions are not enabled for this learner");
    return false;
  }
  return true;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const paramId = (res, value, label) => (UUID.test(value || "") ? value : (fail(res, 422, "tool_schema_invalid", `Invalid ${label}`), null));

// POST /study-prep/sessions — create + one planning agent step. No generation, no spend.
router.post("/sessions", async (req, res) => {
  if (!guard(res)) return;
  try {
    const goal = text(req.body?.goal, 300);
    const subject = text(req.body?.subject, 180);
    const classLevel = text(req.body?.classLevel || "JSS1", 40);
    const examBoard = text(req.body?.examBoard || "WAEC", 80).toUpperCase();
    if (goal.length < 3 || subject.length < 2) return fail(res, 422, "tool_schema_invalid", "A goal (3+ chars) and subject are required");
    const view = await startStudyPrepSession({ learnerId: req.user.id, goal, subject, classLevel, examBoard });
    return res.status(201).json(shapeView(view));
  } catch (error) { return rejection(res, error); }
});

// GET /study-prep/sessions — restore the learner's active session (or null).
router.get("/sessions", async (req, res) => {
  if (!guard(res)) return;
  try {
    const active = await getActiveSessionView(req.user.id);
    return res.json(active ? shapeView(active) : { success: true, session: null });
  } catch (error) { return rejection(res, error); }
});

// GET /study-prep/sessions/:id — the single learner-visible session view.
router.get("/sessions/:id", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const view = await getHarness().getSessionView({ sessionId: id, learnerId: req.user.id });
    return res.json(shapeView(view));
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/plan — replan (runs a planning step in replanning).
router.post("/sessions/:id/plan", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const harness = getHarness();
    const session = await harness.getSessionView({ sessionId: id, learnerId: req.user.id });
    if (session.session.status === "topic_active") {
      const replanned = await harness.proposePlan({
        sessionId: id, learnerId: req.user.id, topicIds: (req.body?.topics || []).map((topic) => text(topic, 120)),
        intent: "Replanning the remaining topics with the learner.",
      }).catch(() => null);
      if (!replanned) return fail(res, 409, "invalid_state_transition", "The session cannot be replanned from its current state");
    }
    const view = await runStudyPrepPlanningStep({ sessionId: id, learnerId: req.user.id });
    return res.json(shapeView(view));
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/confirm — the learner approves the plan card.
router.post("/sessions/:id/confirm", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().confirmPlan({ sessionId: id, learnerId: req.user.id });
    return res.json({ success: true, session: result.session, topics: result.topics });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/adjust — drop topics before confirming.
router.post("/sessions/:id/adjust", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const drop = Array.isArray(req.body?.drop) ? req.body.drop.map((topic) => text(topic, 120)).slice(0, 12) : [];
    const result = await getHarness().adjustPlan({ sessionId: id, learnerId: req.user.id, dropTopicIds: drop });
    return res.json({ success: true, session: result.session, plan: result.plan, estimate: result.estimate });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/topics/:topicId/practice — generate (diagnostic|retest).
router.post("/sessions/:id/topics/:topicId/practice", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  const topicId = paramId(res, req.params.topicId, "topic id");
  if (!id || !topicId) return;
  try {
    const mode = req.body?.mode === "retest" ? "retest" : "diagnostic";
    const result = await getHarness().startTopicPractice({
      sessionId: id, learnerId: req.user.id, topicId, mode,
      intent: null, // learner-initiated: the harness narrates, no agent intent
    });
    return res.status(201).json({
      success: true, session: result.session, topic: result.topic,
      run: result.run, attempt: result.attempt,
    });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/topics/:topicId/submit — answers; the engine scores.
router.post("/sessions/:id/topics/:topicId/submit", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  const topicId = paramId(res, req.params.topicId, "topic id");
  if (!id || !topicId) return;
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers.slice(0, 10) : [];
    const result = await getHarness().submitPractice({ sessionId: id, learnerId: req.user.id, topicId, answers });
    return res.json({
      success: true, session: result.session, topic: result.topic, outcome: result.outcome,
      score: result.result.score, correct: result.result.correct, total: result.result.total, passed: result.result.passed,
    });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/topics/:topicId/teach-back-done — the human gate.
router.post("/sessions/:id/topics/:topicId/teach-back-done", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  const topicId = paramId(res, req.params.topicId, "topic id");
  if (!id || !topicId) return;
  try {
    const result = await getHarness().confirmTeachBack({ sessionId: id, learnerId: req.user.id, topicId });
    return res.json({ success: true, session: result.session, topic: result.topic });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/next — sessionNext: what happens now.
router.post("/sessions/:id/next", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const next = await getHarness().sessionNext({ sessionId: id, learnerId: req.user.id });
    return res.json({ success: true, ...shapeNext(next) });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/{advance,defer,retry-deferred,flag,conclude,pause,resume,cancel}
router.post("/sessions/:id/advance", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().advanceTopic({ sessionId: id, learnerId: req.user.id, intent: null });
    return res.json({ success: true, session: result.session, topic: result.topic });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/defer", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().deferTopic({
      sessionId: id, learnerId: req.user.id,
      topicId: paramId(res, req.body?.topicId, "topic id") || undefined,
      reasonCode: text(req.body?.reasonCode, 80) || "attempt_cap_reached",
    });
    return res.json({ success: true, session: result.session, topic: result.topic });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/retry-deferred", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().retryDeferredTopic({
      sessionId: id, learnerId: req.user.id, topicId: paramId(res, req.body?.topicId, "topic id") || undefined,
    });
    return res.json({ success: true, session: result.session, topic: result.topic });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/conclude", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().concludeSession({ sessionId: id, learnerId: req.user.id, intent: null });
    return res.json({ success: true, session: result.session, summary: result.summary });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/pause", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().pauseSession({ sessionId: id, learnerId: req.user.id });
    return res.json({ success: true, session: result.session, pauseMessage: pauseCopy(result.session.pausedReason) });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/resume", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().resumeSession({ sessionId: id, learnerId: req.user.id });
    return res.json({ success: true, session: result.session });
  } catch (error) { return rejection(res, error); }
});

router.post("/sessions/:id/cancel", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().cancelSession({ sessionId: id, learnerId: req.user.id });
    return res.json({ success: true, session: result.session });
  } catch (error) { return rejection(res, error); }
});

// ── helpers ────────────────────────────────────────────────────────────────

/** The learner's active session view, or null when none exists. */
async function getActiveSessionView(learnerId) {
  const active = await supabaseStore.findActiveSessionsList(learnerId);
  const id = active?.data?.[0]?.id;
  if (!id) return null;
  return getHarness().getSessionView({ sessionId: id, learnerId });
}

// ── shaping ────────────────────────────────────────────────────────────────

function shapeView(view) {
  return {
    success: true,
    session: view.session, topics: view.topics,
    events: (view.events || []).map(publicEvent),
    loop: view.loop || undefined,
  };
}

function shapeNext(next) {
  return {
    session: next.session, topics: next.topics, step: next.step, activeTopic: next.activeTopic,
    pauseMessage: next.session.status === "paused" ? pauseCopy(next.session.pausedReason) : undefined,
  };
}

export default router;
