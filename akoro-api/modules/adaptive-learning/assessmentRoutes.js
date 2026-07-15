/**
 * assessmentRoutes.js
 *
 * REST surface for reviewing proctored assessments (read-only). The live exam
 * runs over the WebSocket gateway; these endpoints back the results history
 * and the instructor review view.
 *
 *   GET /assessments              — caller's own assessment history
 *   GET /assessments/review       — flagged/terminated sessions (instructor)
 *   GET /assessments/:id          — full detail (transcript + proctoring)
 */

import { Router } from "express";
import db from "../../db.js";
import { authenticateToken } from "../auth/routes.js";

const router = Router();

// Staff (non-student) roles may view the review queue and other students'
// assessment detail. Students may only see their own.
const STAFF_ROLES = new Set(["instructor", "teacher", "admin"]);
const isStaff = (req) => STAFF_ROLES.has(req.user?.role);

const SUMMARY_COLS =
  "id, student_id, topic, subject, status, assessment_score, cheat_probability, " +
  "final_verdict, identity_verified, started_at, completed_at";

/* ── Caller's own assessment history ─────────────────────────── */
router.get("/assessments", authenticateToken, async (req, res) => {
  try {
    const studentId = req.user?.id;
    if (!studentId) return res.status(400).json({ error: "auth required" });

    const { data, error } = await db.schema("edu")
      .from("assessment_sessions")
      .select(SUMMARY_COLS)
      .eq("student_id", studentId)
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    res.json({ success: true, assessments: (data || []).map(_summary) });
  } catch (err) {
    console.error("[GET /assessments]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Instructor review queue: flagged / terminated first ─────── */
router.get("/assessments/review", authenticateToken, async (req, res) => {
  try {
    if (!isStaff(req)) return res.status(403).json({ error: "Staff access only" });
    const { status, verdict, limit = 50 } = req.query;
    let q = db.schema("edu").from("assessment_sessions").select(SUMMARY_COLS);

    if (verdict) q = q.eq("final_verdict", verdict);
    else q = q.in("final_verdict", ["flagged", "terminated"]);   // default queue
    if (status) q = q.eq("status", status);

    const { data, error } = await q
      .order("cheat_probability", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(Math.min(Number(limit) || 50, 200));
    if (error) throw new Error(error.message);

    res.json({ success: true, assessments: (data || []).map(_summary) });
  } catch (err) {
    console.error("[GET /assessments/review]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ── Full detail (transcript + proctoring evidence) ──────────── */
router.get("/assessments/:id", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await db.schema("edu")
      .from("assessment_sessions")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "not found" });
    // Only the candidate themselves or staff may see the transcript + the
    // stored reference face photo + proctoring evidence.
    if (data.student_id !== req.user.id && !isStaff(req))
      return res.status(403).json({ error: "Not authorized to view this assessment" });

    res.json({
      success: true,
      assessment: {
        ..._summary(data),
        verdictDetail:     data.verdict_detail,
        referenceImageUrl: data.reference_image_url,
        blockHistory:      data.block_history || [],
        questions:         data.questions || [],
        cheatEvents:       data.cheat_events || [],
        proctoringSignals: data.proctoring_signals || {},
      },
    });
  } catch (err) {
    console.error("[GET /assessments/:id]", err.message);
    res.status(500).json({ error: err.message });
  }
});

function _summary(s) {
  return {
    id:               s.id,
    studentId:        s.student_id,
    topic:            s.topic,
    subject:          s.subject,
    status:           s.status,
    score:            s.assessment_score,
    cheatProbability: s.cheat_probability,
    verdict:          s.final_verdict,
    identityVerified: s.identity_verified,
    startedAt:        s.started_at,
    completedAt:      s.completed_at,
  };
}

export default router;
