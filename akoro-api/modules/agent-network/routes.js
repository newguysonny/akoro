/**
 * agent-network/routes.js — mounted at /api/agent-network (learner app).
 *
 *   POST /heartbeat                   the app is open (≈ once a minute)
 *   GET  /online-count                how many agents are online
 *   GET  /search?…filters             find agents (filters.js cleanFilters)
 *   GET  /agents/:userId              one agent, as the viewer may see it
 *   GET  /settings  PUT /settings     privacy and challenge preferences
 *   GET  /blocks  POST /blocks  DELETE /blocks/:userId
 *   POST /reports                     report an agent (also blocks it)
 *   GET  /past-questions              my past-question practice summary
 *   POST /past-questions              log practice { exam, subject, year, attempted, correct }
 *   POST /challenges                  challenge agents { opponents, kind, subject, topic, scheduled_for… }
 *   GET  /challenge-requests          open requests I may take (?subject&exam&kind&topic&mine)
 *   POST /challenge-requests          post one
 *   POST /challenge-requests/:id/accept   take a seat
 *   DELETE /challenge-requests/:id    cancel mine
 *   POST /battles/:id/rematch         the same battle again
 */
import { Router } from "express";
import { authenticateToken } from "../auth/routes.js";
import {
  heartbeat, onlineCount, searchAgents, profileFor, getSettings, saveSettings,
  blockedWith, block, unblock, report, logPastQuestions, pastQuestionSummary,
} from "./network.js";
import {
  challengeAgents, postChallengeRequest, searchChallengeRequests, acceptChallengeRequest, cancelChallengeRequest, rematch,
} from "./challenges.js";

const router = Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data) => res.json({ success: true, data });
const fail = (res, e) => {
  if ([400, 402, 403, 404, 409, 429].includes(e?.status)) return res.status(e.status).json({ success: false, error: e.message });
  throw e;
};
const wrap = (fn) => asyncHandler(async (req, res) => { try { ok(res, await fn(req)); } catch (e) { fail(res, e); } });

router.use(authenticateToken);

router.post("/heartbeat", wrap((req) => heartbeat(req.user.id, req.body?.surface)));
router.get("/online-count", wrap(async () => ({ online: await onlineCount() })));
router.get("/search", wrap((req) => searchAgents(req.user.id, req.query)));
router.get("/agents/:userId", wrap(async (req) => {
  const agent = await profileFor(req.user.id, req.params.userId);
  if (!agent) { const e = new Error("That agent isn't available."); e.status = 404; throw e; }
  return { agent };
}));
router.get("/settings", wrap((req) => getSettings(req.user.id)));
router.put("/settings", wrap((req) => saveSettings(req.user.id, req.body || {})));
router.get("/blocks", wrap(async (req) => ({ blocked: [...(await blockedWith(req.user.id))] })));
router.post("/blocks", wrap((req) => block(req.user.id, req.body?.userId)));
router.delete("/blocks/:userId", wrap((req) => unblock(req.user.id, req.params.userId)));
router.post("/reports", wrap((req) => report(req.user.id, req.body?.userId, req.body?.reason, req.body?.context || null)));
router.get("/past-questions", wrap(async (req) => ({ summary: await pastQuestionSummary(req.user.id) })));
router.post("/past-questions", wrap((req) => logPastQuestions(req.user.id, { ...req.body, source: "practice" })));

router.post("/challenges", wrap((req) => challengeAgents(req.user.id, req.body || {})));
router.get("/challenge-requests", wrap((req) => searchChallengeRequests(req.user.id, req.query)));
router.post("/challenge-requests", wrap(async (req) => ({ request: await postChallengeRequest(req.user.id, req.body || {}) })));
router.post("/challenge-requests/:id/accept", wrap((req) => acceptChallengeRequest(req.user.id, req.params.id)));
router.delete("/challenge-requests/:id", wrap((req) => cancelChallengeRequest(req.user.id, req.params.id)));
router.post("/battles/:id/rematch", wrap((req) => rematch(req.user.id, req.params.id)));

export default router;
