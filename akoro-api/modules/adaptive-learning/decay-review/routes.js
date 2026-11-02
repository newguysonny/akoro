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

export default router;
