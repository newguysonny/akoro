// modules/admin/agent-ratings.js
//
// The Evals page's human side (Grand Plan Phase 18 item 4): how learners rate
// the agent's replies, per surface, and the worst-rated turns with the verdict
// the code computed for the same turn beside the human label. Admin only.
// No learner identity leaves this route: texts are scrubbed (anonymise.js) and
// rows carry no user id.

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { labelKeyFor, rateBySurface, worstFirst } from "../agent-ratings/index.js";
import { scrubText } from "../agent-contract/index.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sinceOf = (q) => new Date(Date.now() - Math.min(365, Math.max(1, parseInt(q.days, 10) || 30)) * 86_400_000).toISOString();
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** GET /api/admin/agent-ratings/summary?days=30 — up/down and the up-rate per surface. */
router.get("/agent-ratings/summary", adminOnly, asyncHandler(async (req, res) => {
  const since = sinceOf(req.query);
  const { data, error } = await db.schema("edu").from("agent_message_ratings")
    .select("surface, rating").gte("updated_at", since).limit(20_000);
  if (error) return res.status(503).json({ success: false, error: "Ratings are unavailable (migration 2026-agent-reply-ratings pending?)" });
  res.json({ success: true, since, surfaces: rateBySurface(data || []) });
}));

/** GET /api/admin/agent-ratings/worst?days=30&surface=agent_chat&limit=20 — the worst-rated turns. */
router.get("/agent-ratings/worst", adminOnly, asyncHandler(async (req, res) => {
  const since = sinceOf(req.query);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  let q = db.schema("edu").from("agent_message_ratings")
    .select("surface, message_id, rating, reason, updated_at").eq("rating", "down").gte("updated_at", since)
    .order("updated_at", { ascending: false }).limit(200);
  if (req.query.surface) q = q.eq("surface", String(req.query.surface));
  const { data: rows, error } = await q;
  if (error) return res.status(503).json({ success: false, error: "Ratings are unavailable (migration 2026-agent-reply-ratings pending?)" });
  const list = rows || [];

  // The code's verdict for the same turn, through the episode's label key.
  const keyOf = new Map(list.map((r) => [r.message_id, labelKeyFor(r.surface, r.message_id)]));
  const keys = [...new Set([...keyOf.values()].filter(Boolean))];
  const verdicts = new Map();
  if (keys.length) {
    const { data: eps } = await db.schema("edu").from("agent_episodes").select("id, label_key, verdict, failure_class").in("label_key", keys);
    for (const e of eps || []) verdicts.set(e.label_key, e);
  }
  // What was said: the reply, or the workflow event that was rated.
  const chatIds = list.filter((r) => r.surface === "agent_chat").map((r) => r.message_id);
  const eventIds = list.filter((r) => r.surface === "workflow_summary").map((r) => r.message_id);
  const texts = new Map();
  if (chatIds.length) {
    const { data } = await db.from("chat_messages").select("id, text").in("id", chatIds);
    for (const m of data || []) texts.set(m.id, m.text);
  }
  if (eventIds.length) {
    const { data } = await db.schema("edu").from("workflow_events").select("id, event_type, payload").in("id", eventIds);
    for (const e of data || []) texts.set(e.id, `${e.event_type}${e.payload?.summary ? ` — ${e.payload.summary}` : ""}`);
  }

  const turns = worstFirst(list.map((r) => {
    const ep = verdicts.get(keyOf.get(r.message_id));
    return {
      surface: r.surface, message_id: r.message_id, rating: r.rating,
      reason: r.reason ? clip(scrubText(r.reason), 280) : null,
      excerpt: clip(scrubText(texts.get(r.message_id) || ""), 400) || null,
      verdict: ep?.verdict ?? null, failure_class: ep?.failure_class ?? null, episode_id: ep?.id ?? null,
      updated_at: r.updated_at,
    };
  })).slice(0, limit);
  res.json({ success: true, since, turns });
}));

export default router;
