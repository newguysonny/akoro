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
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";
import { executeChatTool } from "../adaptive-learning/chat.js";

const router = Router();
const edu = () => db.schema("edu");
const now = () => new Date().toISOString();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok  = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const bad = (res, m) => res.status(400).json({ success: false, error: m });

const PENDING = "proposed";
const DISMISS_REASONS = ["not_useful", "wrong_time", "too_much", "already_doing", "other"];

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

/* POST /:id/approve — the ONE door from proposal to reality.
   Claim-first (status flip guarded on 'proposed') so a double-tap or a
   replay executes at most once, then run the existing tool 1:1. */
router.post("/:id/approve", authenticateToken, asyncHandler(async (req, res) => {
  const { data: claimed, error: claimError } = await edu().from("agent_proposals")
    .update({ status: "approved", decided_at: now() })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .eq("status", PENDING)
    .select("*")
    .single();
  if (claimError) return res.status(503).json({ success: false, error: "Could not approve the proposal" });
  if (!claimed) return res.status(404).json({ success: false, error: "This proposal was already decided or has expired." });

  const kind = claimed.kind;
  const payload = claimed.payload || {};
  try {
    let ref = null;
    let detail = null;
    if (kind === "task" || kind === "practice") {
      // The chat's own create_task — validation, autonomy scheduling, and
      // the task:created socket broadcast all ride along for free.
      const result = await executeChatTool("create_task",
        { priority: "medium", ...payload }, req.user.id, { role: "student", channel: "proposal" });
      if (result?.needsClarification || result?.error) throw new Error(result.question || result.error || "The task could not be created.");
      ref = result?.taskId ?? null;
      detail = { taskId: ref, title: result?.title ?? claimed.title };
    } else if (kind === "session") {
      // The chat's own schedule_chat_follow_up — durable, idempotent, and
      // delivered by the existing worker.
      const result = await executeChatTool("schedule_chat_follow_up",
        payload, req.user.id, { role: "student", channel: "proposal" });
      if (result?.needsClarification || result?.error) throw new Error(result.question || result.error || "The check-in could not be scheduled.");
      ref = result?.followUpId ?? result?.id ?? null;
      detail = { followUpId: ref, scheduledAt: result?.scheduledAt ?? payload?.scheduledAt ?? null };
    } else if (kind === "goal") {
      // Goals have no chat tool (they post-date it) — the approval path is
      // the goals API's own insert, marked agent-sourced (HITL provenance).
      const { data: goal, error: goalError } = await edu().from("learner_goals")
        .insert({
          user_id: req.user.id,
          title: String(payload?.title || claimed.title).slice(0, 120),
          category: payload?.category || null,
          target_date: payload?.target_date || null,
          source: "agent",
        })
        .select("*")
        .single();
      if (goalError) throw new Error("Could not save the goal.");
      ref = goal.id;
      detail = { goalId: ref, title: goal.title };
    } else {
      throw new Error(`"${kind}" proposals are not executable yet — dismiss it or start it yourself from its tab.`);
    }

    const { data: done, error: doneError } = await edu().from("agent_proposals")
      .update({ status: "executed", executed_ref: ref, decided_at: now() })
      .eq("id", claimed.id)
      .eq("status", "approved")
      .select("id")
      .single();
    if (doneError || !done) throw new Error("Could not record the approval.");

    return ok(res, { executed: true, kind, ...detail });
  } catch (execError) {
    // The claim is released to a visible FAILED state — never back to
    // proposed (a broken payload would just fail again), never silent.
    await edu().from("agent_proposals")
      .update({ status: "failed", decision_note: String(execError.message).slice(0, 300), decided_at: now() })
      .eq("id", claimed.id)
      .eq("status", "approved");
    return bad(res, execError.message || "Could not execute the proposal.");
  }
}));

/* POST /:id/dismiss — with an optional taste reason the next cycle reads. */
router.post("/:id/dismiss", authenticateToken, asyncHandler(async (req, res) => {
  const reason = DISMISS_REASONS.includes(req.body?.reason) ? req.body.reason : "other";
  const { data, error } = await edu().from("agent_proposals")
    .update({ status: "dismissed", decision_note: reason, decided_at: now() })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .eq("status", PENDING)
    .select("id")
    .single();
  if (error) return res.status(503).json({ success: false, error: "Could not dismiss the proposal" });
  if (!data) return res.status(404).json({ success: false, error: "This proposal was already decided or has expired." });
  ok(res, { dismissed: true, reason });
}));

export default router;
