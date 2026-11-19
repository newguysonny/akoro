/**
 * modules/capability-requests/routes.js
 * Structured intake for missing platform capabilities (tool executors /
 * learning components) + admin triage.
 * Mounted at /api/capability-requests.
 *   POST /            authenticated — file a request (learner or agent)
 *   GET  /            admin        — triage list with open count
 *   PATCH /:id        admin        — set status
 */

import { Router } from "express";
import { body, validationResult } from "express-validator";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const SOURCES   = ["executor", "component", "other"];
const STATUSES  = ["new", "triaged", "planned", "shipped", "declined"];

// ─── POST /api/capability-requests — file a request ─────────────────────────
router.post("/",
  [
    body("intent").trim().isLength({ min: 1, max: 300 }),
    body("missing_capability").trim().isLength({ min: 1, max: 2000 }),
    body("source").optional().isIn(SOURCES),
    body("closest_match").optional().trim().isLength({ max: 1000 }),
    body("description").optional().trim().isLength({ max: 5000 }),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty())
      return res.status(422).json({ success: false, message: "intent and missing_capability are required" });

    const { source = "other", intent, missing_capability, closest_match, description } = req.body;
    const { error } = await db.from("capability_requests").insert({
      user_id:            req.user?.id ?? null,
      user_role:          req.user?.role ?? null,
      source,
      intent,
      missing_capability,
      closest_match:      closest_match || null,
      description:        description || null,
    });
    if (error) {
      console.error("[capability-requests] insert failed:", error.message);
      return res.status(500).json({ success: false, message: "Could not file the request. Please try again." });
    }
    return res.status(201).json({ success: true });
  }
);

// ─── GET /api/capability-requests — admin triage ────────────────────────────
router.get("/", ...adminOnly, async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

  let q = db.from("capability_requests").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status && status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, message: error.message });

  // Open count for the header badge (new + triaged).
  const { count: open } = await db.from("capability_requests")
    .select("id", { count: "exact", head: true }).in("status", ["new", "triaged"]);

  return res.json({ success: true, data: data ?? [], open: open ?? 0 });
});

// ─── PATCH /api/capability-requests/:id — set status ────────────────────────
router.patch("/:id", ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status))
    return res.status(400).json({ success: false, message: "status must be one of: " + STATUSES.join(", ") });

  const { data, error } = await db.from("capability_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.id).select("id, status, user_id, intent").maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data)  return res.status(404).json({ success: false, message: "Request not found" });

  // Closing the loop: when a request ships, tell the requester their agent can
  // now use the new capability. Fire-and-forget so triage never blocks on it.
  if (status === "shipped" && data.user_id) {
    try {
      await db.from("notifications").insert({
        user_id:    data.user_id,
        type:       "capability_request",
        title:      "Your feature request is ready",
        content:    `Akoro built "${data.intent}". Your agent can now do this — try it again!`,
        is_read:    false,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("[capability-requests] notify failed:", err?.message ?? err);
    }
  }

  return res.json({ success: true, data: { id: data.id, status: data.status } });
});

export default router;
