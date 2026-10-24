/**
 * study-prep REST surface (Master Plan §4.9). The existing exam-prep surface
 * is unchanged; these are the minimal additive session endpoints, all
 * envelope-compliant: { success: true, … } or { success: false, code, error }
 * with a stable machine-readable code on every 4xx and 500 only for genuine
 * faults. Money-adjacent pauses surface as 402 insufficient_balance.
 */

import express from "express";

import { HarnessRejection } from "./harness.js";
import { afterLearnerAction, resumeHeldWake, sayNothingToCheck, studyPrepEnabled, getHarness, runStudyPrepPlanningStep, startStudyPrepSession, teachingForTopic, teachingHandoff, wakeStudyPrep } from "./wiring.js";
import { randomUUID } from "node:crypto";
import db from "../../../db.js";
import { isTester } from "../../verify/policy.js";
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

// 8-4-4-4-12. (It once required 13 in the last group, so every /:id route
// answered 422 for every real session and topic id.)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const paramId = (res, value, label) => (UUID.test(value || "") ? value : (fail(res, 422, "tool_schema_invalid", `Invalid ${label}`), null));
// The chat the card is in (optional): the agent's wake posts its message there.
const chatOf = (req) => (UUID.test(req.body?.conversationId || "") ? req.body.conversationId : null);
// The agent wakes on what the learner just did — after the response, never holding it.
const wake = (req, id, action, facts = {}) => afterLearnerAction({ sessionId: id, learnerId: req.user.id, action, conversationId: chatOf(req), facts });

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
    return res.json(active ? shapeView(await withTeaching(active)) : { success: true, session: null });
  } catch (error) { return rejection(res, error); }
});

// GET /study-prep/sessions/:id — the single learner-visible session view.
router.get("/sessions/:id", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const view = await getHarness().getSessionView({ sessionId: id, learnerId: req.user.id });
    return res.json(shapeView(await withTeaching(view)));
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
    wake(req, id, "confirm");
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
    const order = Array.isArray(req.body?.order) ? req.body.order.map((topic) => text(topic, 120)).slice(0, 12) : null;
    const result = await getHarness().adjustPlan({ sessionId: id, learnerId: req.user.id, dropTopicIds: drop, order });
    wake(req, id, "adjust");
    return res.json({ success: true, session: result.session, plan: result.plan, estimate: result.estimate });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/approve-more — the learner lets the plan go past its coins by a fixed amount.
router.post("/sessions/:id/approve-more", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  if (!id) return;
  try {
    const result = await getHarness().approveMoreCoins({ sessionId: id, learnerId: req.user.id });
    // The agent picks up where it stopped (a wake it held for the coins).
    resumeHeldWake({ sessionId: id, learnerId: req.user.id, conversationId: chatOf(req) });
    return res.json({ success: true, session: result.session, coins: result.coins });
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
    if (result.skipped && !result.skipped.already) sayNothingToCheck(id, result.topic?.label).catch(() => {});
    return res.status(201).json({
      success: true, session: result.session, topic: result.topic,
      run: result.run, attempt: result.attempt,
      // The Agent Check: started (its battle), or nothing to check yet (no notes, nothing charged).
      ...(result.check ? { check: result.check } : {}), ...(result.skipped ? { skipped: result.skipped } : {}),
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
    // Taught it elsewhere: the teaching session offered for it (if any) is no longer needed.
    if (result.session?.workflowId) await teachingHandoff().cancelFor({ parentId: result.session.workflowId, topicId, reason: "taught_elsewhere" }).catch(() => null);
    wake(req, id, "teach_back", { topic: result.topic?.label });
    return res.json({ success: true, session: result.session, topic: result.topic });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/topics/:topicId/teaching/approve — the learner
// confirms the teaching session offered after a missed check (Phase 6); without
// a tap it approves itself after a minute. It then waits on the dashboard.
router.post("/sessions/:id/topics/:topicId/teaching/approve", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  const topicId = paramId(res, req.params.topicId, "topic id");
  if (!id || !topicId) return;
  try {
    const view = await getHarness().getSessionView({ sessionId: id, learnerId: req.user.id, eventLimit: 1 });
    const offered = await teachingForTopic(view.session.workflowId, topicId);
    if (!offered) return fail(res, 404, "no_teaching_session", "There's no teaching session offered for that topic");
    const teaching = await teachingHandoff().approve({ workflowId: offered.workflowId, learnerId: req.user.id });
    return res.json({ success: true, teaching });
  } catch (error) { return rejection(res, error); }
});

// POST /study-prep/sessions/:id/topics/:topicId/teaching/simulate-miss — TEST ACCOUNTS ONLY
// (tester##@demo.akoro.app; anyone else gets 403). The frontend gate films the
// handoff without a real battle: it records a below-the-mark Agent Check on the
// active topic (2 of 5, with these gaps) — then everything after is the real
// path: the offer, the agent's wake on it, the card, the dashboard, the session.
router.post("/sessions/:id/topics/:topicId/teaching/simulate-miss", async (req, res) => {
  if (!guard(res)) return;
  const id = paramId(res, req.params.id, "session id");
  const topicId = paramId(res, req.params.topicId, "topic id");
  if (!id || !topicId) return;
  try {
    const { data: me } = await db.from("users").select("username, email").eq("id", req.user.id).maybeSingle();
    if (!isTester(me)) return fail(res, 403, "testers_only", "This is for test accounts only");
    const gaps = (Array.isArray(req.body?.gaps) ? req.body.gaps : ["Why water moves into a cell", "What plasmolysis is"])
      .map((g) => String(g || "").trim().slice(0, 120)).filter(Boolean).slice(0, 4);
    const harness = getHarness();
    const view = await harness.getSessionView({ sessionId: id, learnerId: req.user.id, eventLimit: 1 });
    const topic = view.topics.find((t) => t.id === topicId && t.status === "active");
    if (!topic) return fail(res, 409, "invalid_state_transition", "That topic is not active");
    const at = new Date().toISOString();
    const scored = await supabaseStore.updateTopicConditional(topic.id, "active", {
      check_battle_id: randomUUID(), check_mode: "diagnostic", check_scored_at: at, attempts_used: Number(topic.attemptsUsed || 0) + 1,
      check_result: { correct: 2, guessed: 0, wrong: 3, unknown: 0, total: 5, score: 0.4, perQuestion: [], gaps, simulated: true },
      learner_confirmed_ready: false, updated_at: at,
    });
    if (!scored) return fail(res, 409, "invalid_state_transition", "The topic moved meanwhile");
    const [row] = (await db.schema("edu").from("study_prep_sessions").select("*").eq("id", id).limit(1)).data || [];
    const teaching = await teachingHandoff().propose({ session: row, topic: { id: topic.id, label: topic.label, attemptsUsed: Number(topic.attemptsUsed || 0) + 1 }, outcome: "retest_offered", gaps });
    wakeStudyPrep({ sessionId: id, learnerId: req.user.id, trigger: "check_scored", facts: { topic: topic.label }, conversationId: chatOf(req) });
    return res.json({ success: true, simulated: true, teaching });
  } catch (error) { return rejection(res, error); }
});

// GET /study-prep/teaching-sessions — the learner's teaching sessions waiting on the dashboard.
router.get("/teaching-sessions", async (req, res) => {
  if (!guard(res)) return;
  try {
    return res.json({ success: true, sessions: await teachingHandoff().listOpen(req.user.id) });
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
    wake(req, id, "advance", { topic: result.topic?.label });
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
  // A failed lookup is a fault, not "no session" — the UI would offer a new one.
  if (active?.error) throw active.error;
  const id = active?.data?.[0]?.id;
  if (!id) return null;
  return getHarness().getSessionView({ sessionId: id, learnerId });
}

// ── shaping ────────────────────────────────────────────────────────────────

/** The active topic's teaching session (offered, waiting or under way), for the card. */
async function withTeaching(view) {
  const active = (view.topics || []).find((t) => t.status === "active");
  const teaching = active ? await teachingForTopic(view.session?.workflowId, active.id).catch(() => null) : null;
  return teaching ? { ...view, teaching } : view;
}

function shapeView(view) {
  return {
    success: true,
    session: view.session, topics: view.topics,
    events: (view.events || []).map(publicEvent),
    loop: view.loop || undefined,
    // D45: practice is the Agent Check — the card words its buttons for it.
    agentCheck: !!view.agentCheck,
    // The next Agent Check: when it starts by itself, or that it needs the learner's OK (past the estimate).
    nextCheck: view.nextCheck || undefined,
    // The coins approved for the plan and what's spent (checks + the agent's wakes).
    coins: view.coins || undefined,
    // Phase 6: the active topic's teaching session — offered (with its auto-approve time), on the dashboard, or under way.
    teaching: view.teaching || undefined,
  };
}

function shapeNext(next) {
  return {
    session: next.session, topics: next.topics, step: next.step, activeTopic: next.activeTopic,
    pauseMessage: next.session.status === "paused" ? pauseCopy(next.session.pausedReason) : undefined,
  };
}

export default router;
