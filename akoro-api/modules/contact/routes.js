/**
 * modules/contact/routes.js
 * Public contact / partner form intake + admin inbox.
 * Mounted at /api/contact.
 *   POST   /api/contact                  public — submit a message
 *   GET    /api/contact/messages         admin  — list submissions
 *   PATCH  /api/contact/messages/:id     admin  — set status (read/archived)
 */

import { Router } from "express";
import { body, validationResult } from "express-validator";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

const router    = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const ok        = (res, data, meta = {}) => res.json({ success: true, data, ...meta });

// ─── POST /api/contact — public form submission ──────────────────────────────
router.post("/",
  [
    body("name").trim().isLength({ min: 1, max: 200 }),
    body("email").trim().isEmail().normalizeEmail(),
    body("message").trim().isLength({ min: 1, max: 5000 }),
    body("kind").optional().isIn(["contact", "partner"]),
    body("organisation").optional().trim().isLength({ max: 200 }),
    body("subject").optional().trim().isLength({ max: 200 }),
  ],
  async (req, res) => {
    if (!validationResult(req).isEmpty())
      return res.status(422).json({ success: false, message: "Please provide your name, a valid email, and a message." });

    const { kind = "contact", name, email, organisation, subject, message } = req.body;
    const { error } = await db.from("contact_messages").insert({
      kind, name, email,
      organisation: organisation || null,
      subject:      subject || null,
      message,
    });
    if (error) {
      console.error("[contact] insert failed:", error.message);
      return res.status(500).json({ success: false, message: "Could not send your message. Please try again." });
    }
    return res.status(201).json({ success: true });
  }
);

// ─── GET /api/contact/messages — admin inbox ─────────────────────────────────
router.get("/messages", ...adminOnly, async (req, res) => {
  const { status, kind } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

  let q = db.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status && status !== "all") q = q.eq("status", status);
  if (kind && kind !== "all")     q = q.eq("kind", kind);

  const { data, error } = await q;
  if (error) return res.status(500).json({ success: false, message: error.message });

  // Lightweight counts for the header badges.
  const { count: unread } = await db.from("contact_messages")
    .select("id", { count: "exact", head: true }).eq("status", "new");

  return ok(res, data ?? [], { unread: unread ?? 0 });
});

// ─── PATCH /api/contact/messages/:id — set status ────────────────────────────
router.patch("/messages/:id", ...adminOnly, async (req, res) => {
  const { status } = req.body;
  if (!["new", "read", "archived"].includes(status))
    return res.status(400).json({ success: false, message: "status must be new, read, or archived" });

  const { data, error } = await db.from("contact_messages")
    .update({ status }).eq("id", req.params.id).select("id, status").maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data)  return res.status(404).json({ success: false, message: "Message not found" });
  return ok(res, data);
});

export default router;
