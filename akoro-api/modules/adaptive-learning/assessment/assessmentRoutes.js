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
import db from "../../../db.js";
import { authenticateToken } from "../../auth/routes.js";
import { getSyllabusGrounding } from "../teaching/syllabus.js";

const router = Router();

// Staff (non-student) roles may view the review queue and other students'
// assessment detail. Students may only see their own.
const STAFF_ROLES = new Set(["instructor", "teacher", "admin"]);
const isStaff = (req) => STAFF_ROLES.has(req.user?.role);

const SUMMARY_COLS =
  "id, student_id, topic, subject, status, assessment_score, cheat_probability, " +
  "final_verdict, identity_verified, started_at, completed_at";

/* ── After-school assessment: today's subjects & activities ──────
 * Auto-syncs the student's class timetable + what was actually taught today
 * (classwork logs) into a list of assessable topics, enriched with syllabus
 * objectives (RAG). Each option feeds the proctored assessment gateway. */
router.get("/assessment/today", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    // Map the login to a school student record → class/section/school.
    const { data: student } = await db.schema("mgmt").from("students")
      .select("id, first_name, class_id, section_id, school_id, classes(name), sections(name)")
      .eq("user_id", userId).eq("status", "active").maybeSingle();

    if (!student?.class_id)
      return res.json({ success: true, enrolled: false, options: [], message: "No school class linked to your account." });

    // Today (school local day). 1 = Monday … 7 = Sunday, matching timetable_slots.
    const now = new Date();
    const todayISO = now.toISOString().slice(0, 10);
    const dow = ((now.getUTCDay() + 6) % 7) + 1;

    const [{ data: logs }, { data: slots }] = await Promise.all([
      // What was actually taught today.
      db.schema("mgmt").from("classwork_logs")
        .select("subject_id, topic, notes, subjects(name)")
        .eq("class_id", student.class_id).eq("log_date", todayISO),
      // What was scheduled today (fallback when nothing was logged).
      db.schema("mgmt").from("timetable_slots")
        .select("subject_id, subjects(name)")
        .eq("class_id", student.class_id).eq("day_of_week", dow),
    ]);

    // Prefer logged classwork (real topics); fall back to scheduled subjects.
    const options = [];
    const seen = new Set();
    for (const l of (logs || [])) {
      if (!l.topic) continue;
      const key = `${l.subject_id}|${l.topic}`.toLowerCase();
      if (seen.has(key)) continue; seen.add(key);
      options.push({ subject: l.subjects?.name || "Subject", subject_id: l.subject_id, topic: l.topic, notes: l.notes || null, source: "classwork" });
    }
    if (!options.length) {
      const subjSeen = new Set();
      for (const s of (slots || [])) {
        if (!s.subject_id || subjSeen.has(s.subject_id)) continue; subjSeen.add(s.subject_id);
        options.push({ subject: s.subjects?.name || "Subject", subject_id: s.subject_id, topic: null, notes: null, source: "timetable" });
      }
    }

    // Enrich each option with syllabus objectives (RAG) — best-effort, capped.
    await Promise.all(options.slice(0, 8).map(async (o) => {
      const q = `${o.subject} ${o.topic || ""}`.trim();
      const { refs } = await getSyllabusGrounding(q, { limit: 2 }).catch(() => ({ refs: [] }));
      o.syllabus = refs;
    }));

    res.json({
      success: true, enrolled: true,
      student: { name: student.first_name, class: student.classes?.name, section: student.sections?.name },
      date: todayISO,
      options,
    });
  } catch (err) {
    console.error("[GET /assessment/today]", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
