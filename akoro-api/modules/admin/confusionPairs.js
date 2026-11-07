/**
 * modules/admin/confusionPairs.js — §7.15.1 admin review of commonly confused
 * pairs: a wrong option that 5+ learners picked for the same concept
 * (edu.learning_confusion_pairs). Anonymous counts only — never who.
 *
 *   GET   /api/admin/confusion-pairs[?status=open|content_fixed|noted|ignored&subject=]
 *         → { pairs: [{ subject, concept, confusedWith, times, learners, lastSeen, status, note, reviewedAt }] }
 *   PATCH /api/admin/confusion-pairs   { subject, concept, confusedWith, status, note? }
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { REVIEW_STATUSES, mergePairs } from "./confusionPairsCore.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.get("/confusion-pairs", adminOnly, asyncHandler(async (req, res) => {
  const status = REVIEW_STATUSES.includes(req.query.status) ? req.query.status : null;
  const [{ data: pairs, error }, { data: reviews, error: rErr }] = await Promise.all([
    db.schema("edu").from("learning_confusion_pairs").select("*").limit(500),
    db.schema("edu").from("confusion_pair_reviews").select("*").limit(2000),
  ]);
  if (error) return res.status(503).json({ success: false, message: `Confusion pairs aren't available: ${error.message}` });
  res.json({ success: true, data: { pairs: mergePairs(pairs || [], rErr ? [] : reviews || [], { status, subject: req.query.subject ? clip(req.query.subject, 120) : null }) } });
}));

router.patch("/confusion-pairs", adminOnly, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const status = String(b.status || "");
  if (!REVIEW_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status: one of ${REVIEW_STATUSES.join(", ")}` });
  const confusedWith = clip(b.confusedWith, 300);
  if (!confusedWith) return res.status(400).json({ success: false, message: "confusedWith is required" });
  const row = { subject: clip(b.subject, 120), concept: clip(b.concept, 200), confused_with: confusedWith, status,
    note: b.note == null ? null : clip(b.note, 500) || null, reviewed_by: req.user?.id || null, reviewed_at: new Date().toISOString() };
  const { data, error } = await db.schema("edu").from("confusion_pair_reviews").upsert(row, { onConflict: "subject,concept,confused_with" }).select("*").single();
  if (error) return res.status(503).json({ success: false, message: error.message });
  res.json({ success: true, data: { status: data.status, note: data.note, reviewedAt: data.reviewed_at } });
}));

export default router;
