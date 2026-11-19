/**
 * modules/agent-proposals/routes.js — the Full Autonomy proposal inbox.
 *
 * The background cycle PROPOSES (writes rows, nothing else). Only the
 * learner's APPROVAL executes — and it executes through the EXACT tool
 * functions the unified chat uses (executeChatTool), so there is one
 * execution path and no forked write path. docs/learner-full-autonomy-
 * plan.md §5 (approval) and §7 (guardrails).
 *
 *   GET    /                — pending (+recently decided) proposals
 *   POST   /:id/approve     — claim-first, then execute via the tool
 *   POST   /:id/dismiss     — with an optional taste reason the next
 *                             cycle's prompt reads ("wrong time", …)
 *
 * The one inbox (chat suggestions + planner proposals, Grand Plan §7.16.8):
 *   GET    /inbox                — all three sources, newest first, duplicates shown once
 *   POST   /inbox/:ref/accept    — ref "s:<id>" | "p:<id>" | "i:<id>"; does what the kind says
 *   POST   /inbox/:ref/dismiss   — { reason } kept for any source
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/index.js";
import { loadInbox, parseRef, approveProposal, dismissProposal, acceptChatSuggestion, dismissChatSuggestion, acceptInboxIdea, dismissInboxIdea, DISMISS_REASONS } from "./inbox.js";

const router = Router();
const edu = () => db.schema("edu");
const now = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m) => res.status(400).json({ success: false, error: m });

const PENDING = "proposed";

/* Lazily expire stale pending proposals (7-day TTL, same as drafts). */
async function expireStaleProposals(userId) {
  await edu().from("agent_proposals")
    .update({ status: "expired", decided_at: now() })
    .eq("user_id", userId)
    .eq("status", PENDING)
    .lt("expires_at", now());
}

/* GET / — pending first, then decisions from the last 7 days (context). */
router.get("/", authenticateToken, asyncHandler(async (req, res) => {
  await expireStaleProposals(req.user.id);
  const { data, error } = await edu().from("agent_proposals")
    .select("*")
    .eq("user_id", req.user.id)
    .in("status", ["proposed", "executed", "failed", "dismissed"])
    .gte("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return res.status(503).json({ success: false, error: "Could not load proposals" });
  const rows = data || [];
  rows.sort((a, b) => (a.status === PENDING ? 0 : 1) - (b.status === PENDING ? 0 : 1));
  ok(res, rows, { pending: rows.filter((r) => r.status === PENDING).length });
}));

const sendError = (res, e, fallback) => {
  const status = e?.status || 500;
  if (status >= 500) console.error("[agent-proposals]", e?.message);
  return res.status(status).json({ success: false, error: status >= 500 && !e?.status ? fallback : e.message });
};

/* GET /inbox — the learner's open suggestions from chat and from the planner. */
router.get("/inbox", authenticateToken, asyncHandler(async (req, res) => {
  try {
    const items = await loadInbox(req.user.id);
    ok(res, items, { count: items.length, reasons: DISMISS_REASONS });
  } catch (e) { sendError(res, e, "Could not load your suggestions"); }
}));

router.post("/inbox/:ref/accept", authenticateToken, asyncHandler(async (req, res) => {
  const ref = parseRef(req.params.ref);
  if (!ref) return bad(res, "Unknown suggestion.");
  try {
    ok(res, ref.source === "chat" ? await acceptChatSuggestion(req.user.id, ref.id)
      : ref.source === "idea" ? await acceptInboxIdea(req.user.id, ref.id)
      : await approveProposal(req.user.id, ref.id));
  } catch (e) { sendError(res, e, "Could not accept the suggestion"); }
}));

router.post("/inbox/:ref/dismiss", authenticateToken, asyncHandler(async (req, res) => {
  const ref = parseRef(req.params.ref);
  if (!ref) return bad(res, "Unknown suggestion.");
  try {
    if (ref.source === "chat") { const s = await dismissChatSuggestion(req.user.id, ref.id, req.body?.reason); return ok(res, { dismissed: true, reason: s.dismiss_reason }); }
    if (ref.source === "idea") { return ok(res, await dismissInboxIdea(req.user.id, ref.id, req.body?.reason)); }
    ok(res, await dismissProposal(req.user.id, ref.id, req.body?.reason));
  } catch (e) { sendError(res, e, "Could not dismiss the suggestion"); }
}));

/* POST /:id/approve — the ONE door from proposal to reality (inbox.js). */
router.post("/:id/approve", authenticateToken, asyncHandler(async (req, res) => {
  try { ok(res, await approveProposal(req.user.id, req.params.id)); }
  catch (e) { sendError(res, e, "Could not approve the proposal"); }
}));

/* POST /:id/dismiss — with an optional taste reason the next cycle reads. */
router.post("/:id/dismiss", authenticateToken, asyncHandler(async (req, res) => {
  try { ok(res, await dismissProposal(req.user.id, req.params.id, req.body?.reason)); }
  catch (e) { sendError(res, e, "Could not dismiss the proposal"); }
}));

export default router;
