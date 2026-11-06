/**
 * teaching-session/workflowRoutes.js — a direct teaching session as a workflow
 * (Grand Plan §13.1, §15 "Teaching", Scenario A; Phase 11).
 *
 *   POST /api/teaching/workflows        { topic, subject?, mode?, focus? }
 *        → 201 { workflowId, workflow } — a teaching workflow (entry `direct`)
 *          waiting on the learner (state `scheduled`). The app calls this, then
 *          opens the teaching modal with the workflowId; the socket's
 *          start_adaptive_session binds the live session to it (the same path
 *          a Study Prep hand-off already takes). An open direct session on the
 *          same topic is returned instead of a second one (200, created: false).
 *   GET  /api/teaching/workflows/:id    → { workflow } (the owner's only; 404 otherwise)
 *   POST /api/teaching/workflows/:id/resume
 *        → { workflow, open } — what the modal opens: start_adaptive_session
 *          with the workflowId, as a continuation of its saved row when it has one.
 *          A finished session is 409.
 *
 * The learner is the authenticated user, never the body (§15). The modal owns
 * no state: the workflow is what the dashboard, the needs-you list and the
 * deep link (?workflow=) read.
 */
import { Router } from "express";
import { OPEN_TEACHING_STATES, teachingView } from "./workflow.js";
import { normaliseMode, TEACHING_MODES } from "./policy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOCUS = 6;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const sameTopic = (a, b) => clip(a, 160).toLowerCase() === clip(b, 160).toLowerCase();

/** PURE: the body → { topic, subject, mode, focus } | { error } */
export function directSessionInput(body = {}) {
  const topic = clip(body.topic, 160);
  if (topic.length < 2) return { error: "topic is required" };
  if (body.mode != null && !TEACHING_MODES.includes(body.mode)) return { error: `mode must be one of ${TEACHING_MODES.join(", ")}` };
  if (body.focus != null && !Array.isArray(body.focus)) return { error: "focus must be a list" };
  const focus = [...new Set((body.focus || []).map((f) => clip(f, 120)).filter(Boolean))].slice(0, MAX_FOCUS);
  return { topic, subject: clip(body.subject, 80) || null, mode: normaliseMode(body.mode), focus };
}

/**
 * engine(): the workflow engine (createWorkflowEngine); authenticate: the auth
 * middleware; enabled(): the WORKFLOW_ENGINE_ENABLED flag; now(): ISO clock.
 */
export function createTeachingWorkflowsRouter({ engine, authenticate, enabled = () => true, now = () => new Date().toISOString() }) {
  const router = Router();
  const on = (_req, res, next) => (enabled() ? next() : res.status(503).json({ success: false, code: "workflows_off", error: "Teaching workflows are switched off here" }));

  async function ownTeaching(req, res) {
    if (!UUID.test(req.params.id)) { res.status(422).json({ success: false, error: "id is invalid" }); return null; }
    const instance = await engine().get(req.params.id, req.user.id);
    if (!instance || instance.workflow_type !== "teaching") { res.status(404).json({ success: false, error: "That teaching session was not found" }); return null; }
    return instance;
  }

  router.post("/", authenticate, on, async (req, res, next) => {
    try {
      const input = directSessionInput(req.body || {});
      if (input.error) return res.status(422).json({ success: false, error: input.error });
      const learnerId = req.user.id;
      // One open direct session per topic: a double tap, a second device, or
      // starting again before teaching anything reopens the same one.
      const open = (await engine().listForLearner(learnerId, { active: true }))
        .find((r) => r.workflow_type === "teaching" && r.entry_mode === "direct" && OPEN_TEACHING_STATES.includes(r.state) && sameTopic(r.metadata?.topic, input.topic));
      if (open) return res.json({ success: true, created: false, workflowId: open.id, workflow: teachingView(open) });
      const { instance, created } = await engine().create({
        workflowType: "teaching", learnerId, entryMode: "direct", state: "scheduled",
        idempotencyKey: typeof req.body?.idempotencyKey === "string" && /^[\w:.-]{8,80}$/.test(req.body.idempotencyKey) ? `direct:${req.body.idempotencyKey}` : null,
        metadata: { topic: input.topic, subject: input.subject, focus: input.focus, teachingMode: input.mode, createdFrom: "dashboard", scheduledAt: now() },
      });
      if (created) {
        await engine().appendEvent(instance.id, { event_type: "workflow.created", actor: "learner", visibility: "learner",
          payload: { label: "Teaching session", topic: input.topic, focus: input.focus, entryMode: "direct", narrative: `Teaching session on ${input.topic}` } }).catch(() => null);
      }
      return res.status(created ? 201 : 200).json({ success: true, created, workflowId: instance.id, workflow: teachingView(instance) });
    } catch (e) { return next(e); }
  });

  router.get("/:id", authenticate, on, async (req, res, next) => {
    try {
      const instance = await ownTeaching(req, res);
      if (!instance) return null;
      return res.json({ success: true, workflow: teachingView(instance) });
    } catch (e) { return next(e); }
  });

  router.post("/:id/resume", authenticate, on, async (req, res, next) => {
    try {
      const instance = await ownTeaching(req, res);
      if (!instance) return null;
      if (!OPEN_TEACHING_STATES.includes(instance.state)) {
        return res.status(409).json({ success: false, code: "workflow_ended", error: `That teaching session is ${instance.status}`, workflow: teachingView(instance) });
      }
      const view = teachingView(instance);
      const m = instance.metadata || {};
      return res.json({ success: true, workflow: view, open: {
        surface: "teaching_modal", workflowId: instance.id, topic: view.topic, subject: view.subject,
        mode: view.adaptiveSessionId ? "continuation" : "fresh", sessionId: view.adaptiveSessionId || null,
        teachingMode: normaliseMode(m.teachingMode),
      } });
    } catch (e) { return next(e); }
  });

  return router;
}
