/**
 * workflows/routes.js — the event stream over HTTP (Grand Plan §7.9.6).
 *
 *   GET /api/workflows/:id/events?after=N    replay (owner only, learner-visible events)
 *   GET /api/workflows/:id/stream?after=N    SSE: the gap after N, `caught_up`, then live
 *   GET /api/workflows/study-prep/:sessionId the session's workflow id (made on first ask
 *                                             for a session from before the engine)
 *   POST /api/workflows/admin/backfill-study-prep?limit=  admin: backfill older sessions
 *   GET /api/workflows/dashboard         the learner's open runs as dashboard descriptors
 *                                        + the "needs you" list (Phase 11, Phase 18 item 2)
 *   GET /api/workflows/dashboard/:id     one run's descriptor (owner only) — what ?workflow= opens
 *   GET /api/workflows/needs-you         the "needs you" list (an instructor gets theirs)
 *   GET|PUT /api/workflows/:id/model     the run's model pick (Scenario K; Study Prep and Teaching only)
 * Live events also reach the learner's Socket.IO room as `workflow_event`.
 */
import { Router } from "express";

import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { createWorkflowEngine } from "./engine.js";
import { makeSupabaseWorkflowStore } from "./store.js";
import { forLearner, toEnvelope } from "./envelope.js";
import { workflowBus } from "./bus.js";
import { streamWorkflowEvents } from "./stream.js";
import { makeDashboardApi } from "./dashboardApi.js";
import { makeNeedsYouSources } from "./needsYouSources.js";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let _engine = null;
const engine = () => (_engine ||= createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }));
let _dashboard = null;
const dashboard = () => (_dashboard ||= makeDashboardApi({ engine: engine(), sources: makeNeedsYouSources({ db, engine: engine() }) }));
const afterOf = (v) => { const n = Number.parseInt(v, 10); return Number.isInteger(n) && n >= -1 ? n : -1; };

async function owned(req, res) {
  if (!UUID.test(req.params.id)) { res.status(422).json({ success: false, error: "id is invalid" }); return null; }
  const instance = await engine().get(req.params.id, req.user.id);
  if (!instance) { res.status(404).json({ success: false, error: "That workflow was not found" }); return null; }
  return instance;
}
const listFor = (instance) => async (after) => (await engine().events(instance.id, { after, limit: 500 })).map((r) => toEnvelope(r, instance));

router.get("/study-prep/:sessionId", authenticateToken, async (req, res, next) => {
  try {
    if (!UUID.test(req.params.sessionId)) return res.status(422).json({ success: false, error: "id is invalid" });
    const { ensureStudyPrepWorkflow } = await import("../adaptive-learning/study-prep/wiring.js");
    const workflowId = await ensureStudyPrepWorkflow(req.params.sessionId, req.user.id);
    if (!workflowId) return res.status(404).json({ success: false, error: "That session was not found" });
    return res.json({ success: true, workflowId });
  } catch (e) { return next(e); }
});

router.get("/dashboard", authenticateToken, async (req, res, next) => {
  try {
    return res.json({ success: true, ...await dashboard().forLearner(req.user.id) });
  } catch (e) { return next(e); }
});

router.get("/dashboard/:id", authenticateToken, async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(422).json({ success: false, error: "id is invalid" });
    const workflow = await dashboard().one(req.user.id, req.params.id);
    if (!workflow) return res.status(404).json({ success: false, error: "That workflow was not found" });
    return res.json({ success: true, workflow });
  } catch (e) { return next(e); }
});

router.get("/needs-you", authenticateToken, async (req, res, next) => {
  try {
    return res.json({ success: true, ...await dashboard().needsYouFor(req.user) });
  } catch (e) { return next(e); }
});

router.post("/admin/backfill-study-prep", authenticateToken, requireRole(["admin"]), async (req, res, next) => {
  try {
    const { backfillStudyPrepWorkflows } = await import("../adaptive-learning/study-prep/wiring.js");
    return res.json({ success: true, ...await backfillStudyPrepWorkflows({ limit: req.query.limit }) });
  } catch (e) { return next(e); }
});

router.get("/:id/events", authenticateToken, async (req, res, next) => {
  try {
    const instance = await owned(req, res);
    if (!instance) return null;
    const events = (await listFor(instance)(afterOf(req.query.after))).map(forLearner).filter(Boolean);
    const last = events.length ? events[events.length - 1].sequence : afterOf(req.query.after);
    return res.json({ success: true, workflow: { id: instance.id, type: instance.workflow_type, state: instance.state, status: instance.status }, events, last });
  } catch (e) { return next(e); }
});

// GET /:id/model — the run's saved model pick; PUT /:id/model { modelId } —
// the Teaching / Study Prep composer's pick (null = the default): saved on the
// run, applies from its next decision, a model.changed event when it changes.
router.get("/:id/model", authenticateToken, async (req, res, next) => {
  try {
    const instance = await owned(req, res);
    if (!instance) return null;
    return res.json({ success: true, modelSelection: instance.model_selection || {} });
  } catch (e) { return next(e); }
});

router.put("/:id/model", authenticateToken, async (req, res, next) => {
  try {
    const instance = await owned(req, res);
    if (!instance) return null;
    const { modelPicks, PICKED_WORKFLOWS } = await import("./modelPicks.js");
    if (!PICKED_WORKFLOWS.includes(instance.workflow_type)) return res.status(409).json({ success: false, code: "model_locked", error: "This workflow's models are fixed" });
    const result = await (await modelPicks()).saveWorkflowPick({ learnerId: req.user.id, workflowId: instance, modelId: req.body?.modelId ?? null });
    if (!result) return res.status(409).json({ success: false, code: "workflow_moved", error: "That workflow changed meanwhile — try again" });
    return res.json({ success: true, ...result });
  } catch (e) {
    if (e?.code && e.status) return res.status(e.status).json({ success: false, code: e.code, error: e.message });
    return next(e);
  }
});

router.get("/:id/stream", authenticateToken, async (req, res, next) => {
  let instance;
  try { instance = await owned(req, res); } catch (e) { return next(e); }
  if (!instance) return null;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const send = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ping = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n"); }, 20_000);
  const stop = streamWorkflowEvents({
    list: listFor(instance), after: afterOf(req.query.after ?? req.headers["last-event-id"]), send,
    // ?developer=1 (the app's developer view): the owner also gets the live-only developer notes.
    filter: req.query.developer === "1" ? (env) => (env.live ? env : forLearner(env)) : forLearner,
    subscribe: (fn) => { const key = `wf:${instance.id}`; workflowBus.on(key, fn); return () => workflowBus.off(key, fn); },
  });
  req.on("close", () => { clearInterval(ping); stop(); });
  return null;
});

export default router;
