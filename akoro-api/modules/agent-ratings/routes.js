/**
 * agent-ratings/routes.js — the learner's thumbs up / down on their own
 * agent messages (Phase 18 item 4). Mounted at /api/adaptive/ratings behind
 * authenticateToken (adaptive-learning/index.js).
 *
 *   GET    /?surface=agent_chat&ids=<uuid>,<uuid>   the learner's own ratings
 *   PUT    /:surface/:messageId  { rating: up|down, reason? }
 *   DELETE /:surface/:messageId
 *
 * The rating is stored for the evals and joined to the episode as a human
 * label; it is never part of any prompt.
 */
import { Router } from "express";
import { isMessageId, isSurface, normaliseRating } from "./ratings.js";
import { clearRating, listOwnRatings, ownsMessage, setRating } from "./store.js";

const router = Router();

const target = (req, res) => {
  const { surface, messageId } = req.params;
  if (!isSurface(surface)) { res.status(422).json({ success: false, error: "surface must be agent_chat or workflow_summary" }); return null; }
  if (!isMessageId(messageId)) { res.status(422).json({ success: false, error: "messageId is invalid" }); return null; }
  return { surface, messageId: messageId.toLowerCase() };
};

router.get("/", async (req, res) => {
  try {
    const surface = String(req.query.surface || "agent_chat");
    if (!isSurface(surface)) return res.status(422).json({ success: false, error: "surface must be agent_chat or workflow_summary" });
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim().toLowerCase()).filter(isMessageId).slice(0, 100);
    const rows = await listOwnRatings({ userId: req.user.id, surface, messageIds: ids });
    return res.json({ success: true, ratings: rows });
  } catch (e) {
    console.error("[ratings GET]", e?.message || e);
    return res.status(500).json({ success: false, error: "Ratings are unavailable" });
  }
});

router.put("/:surface/:messageId", async (req, res) => {
  const t = target(req, res);
  if (!t) return undefined;
  const input = normaliseRating(req.body);
  if (input.error) return res.status(422).json({ success: false, error: input.error });
  try {
    if (!(await ownsMessage({ userId: req.user.id, ...t }))) return res.status(404).json({ success: false, error: "Message not found" });
    const out = await setRating({ user: req.user, ...t, ...input });
    return res.json({ success: true, rating: out.rating });
  } catch (e) {
    console.error("[ratings PUT]", e?.message || e);
    return res.status(500).json({ success: false, error: "Could not save the rating" });
  }
});

router.delete("/:surface/:messageId", async (req, res) => {
  const t = target(req, res);
  if (!t) return undefined;
  try {
    if (!(await ownsMessage({ userId: req.user.id, ...t }))) return res.status(404).json({ success: false, error: "Message not found" });
    await clearRating({ user: req.user, ...t });
    return res.json({ success: true, cleared: true });
  } catch (e) {
    console.error("[ratings DELETE]", e?.message || e);
    return res.status(500).json({ success: false, error: "Could not clear the rating" });
  }
});

export default router;
