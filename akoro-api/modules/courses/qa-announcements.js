/**
 * qa-announcements.js  —  Piabam Q&A & Announcements router
 *
 * Handles:
 *   - Q&A: list, post, get, answer, upvote, resolve, delete
 *   - Announcements: list, create, update, delete, mark-read
 *
 * Usage in app.js:
 *   import qaRouter from "./routes/qa-announcements.js";
 *   app.use("/api", qaRouter);
 */

import { Router }                         from "express";
import { body, query, validationResult }  from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { sendDirectNotification }         from "../../services/notificationService.js";
import { canManageCourse }                from "./courseAccess.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res204 = (res)                  => res.status(204).send();
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

// ─── Q&A Handlers ─────────────────────────────────────────────────────────────

const qaHandlers = {

  /**
   * GET /api/courses/:courseId/questions
   */
  listQuestions: asyncHandler(async (req, res) => {
    const { resolved, pinned, mine, limit = 20, offset = 0 } = req.query;

    let query = db
      .from("questions")
      .select(`
        id, title, content, upvotes, is_resolved, is_pinned, created_at, updated_at,
        users!questions_user_id_fkey ( id, full_name, username, avatar_url, role )
      `, { count: "exact" })
      .eq("course_id", req.params.courseId)
      .order("is_pinned", { ascending: false })
      .order("upvotes",   { ascending: false })
      .order("created_at",{ ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (resolved !== undefined) query = query.eq("is_resolved", resolved === "true");
    if (pinned   !== undefined) query = query.eq("is_pinned",   pinned   === "true");
    if (mine     === "true")    query = query.eq("user_id", req.user.id);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    // Attach answer count and user's upvote status
    const enriched = await Promise.all((data ?? []).map(async (q) => {
      const { count: ansCount } = await db
        .from("question_answers")
        .select("id", { count: "exact", head: true })
        .eq("question_id", q.id);

      const { data: upvoted } = await db
        .from("question_upvotes")
        .select("id")
        .eq("question_id", q.id)
        .eq("user_id", req.user.id)
        .single();

      return { ...q, answer_count: ansCount ?? 0, has_upvoted: !!upvoted };
    }));

    res200(res, enriched, { total: count ?? 0 });
  }),

  /**
   * POST /api/courses/:courseId/questions
   */
  postQuestion: asyncHandler(async (req, res) => {
    const { title, content } = req.body;
    const { courseId }       = req.params;

    const { data, error } = await db
      .from("questions")
      .insert({ course_id: courseId, user_id: req.user.id, title, content })
      .select(`
        id, title, content, upvotes, is_resolved, is_pinned, created_at,
        users!questions_user_id_fkey ( id, full_name, username, avatar_url )
      `)
      .single();

    if (error) throw new Error(error.message);
    res201(res, data);
  }),

  /**
   * GET /api/questions/:questionId — question + all answers
   */
  getQuestion: asyncHandler(async (req, res) => {
    const { data: question, error } = await db
      .from("questions")
      .select(`
        id, title, content, upvotes, is_resolved, is_pinned, created_at, updated_at,
        users!questions_user_id_fkey ( id, full_name, username, avatar_url, role ),
        question_answers (
          id, content, is_teacher_answer, upvotes, created_at, updated_at,
          users!question_answers_user_id_fkey ( id, full_name, username, avatar_url, role )
        )
      `)
      .eq("id", req.params.questionId)
      .single();

    if (error || !question) return res404(res, "Question not found");

    // Sort: teacher answers first, then by upvotes
    question.question_answers = (question.question_answers ?? []).sort((a, b) => {
      if (a.is_teacher_answer && !b.is_teacher_answer) return -1;
      if (!a.is_teacher_answer && b.is_teacher_answer) return  1;
      return b.upvotes - a.upvotes;
    });

    res200(res, question);
  }),

  /**
   * POST /api/questions/:questionId/answers
   */
  postAnswer: asyncHandler(async (req, res) => {
    const { content }       = req.body;
    const { questionId }    = req.params;
    const isTeacher         = ["instructor", "admin"].includes(req.user.role);

    const { data: answer, error } = await db
      .from("question_answers")
      .insert({
        question_id:       questionId,
        user_id:           req.user.id,
        content,
        is_teacher_answer: isTeacher,
      })
      .select(`
        id, content, is_teacher_answer, upvotes, created_at,
        users!question_answers_user_id_fkey ( id, full_name, username, avatar_url, role )
      `)
      .single();

    if (error) throw new Error(error.message);

    // Notify question author
    const { data: question } = await db
      .from("questions")
      .select("user_id, title, course_id, courses(title)")
      .eq("id", questionId)
      .single();

    if (question && question.user_id !== req.user.id) {
      await sendDirectNotification({
        userId:       question.user_id,
        type:         "qa_reply",
        title:        "New reply to your question",
        content:      content.slice(0, 120),
        relatedId:    questionId,
        emailSubject: `New reply to: "${question.title}"`,
        emailHtml:    `<p>${req.user.full_name ?? "Someone"} replied to your question <strong>"${question.title}"</strong>:<br/><em>${content}</em></p>`,
        smsBody:      `Piabam: New reply to your question "${question.title}". Check the app.`,
      }).catch((e) => console.warn("[qa] notification failed:", e.message));
    }

    res201(res, answer);
  }),

  /**
   * PUT /api/questions/:questionId/upvote — toggle upvote
   */
  upvoteQuestion: asyncHandler(async (req, res) => {
    const { questionId } = req.params;

    const { data: existing } = await db
      .from("question_upvotes")
      .select("id")
      .eq("question_id", questionId)
      .eq("user_id", req.user.id)
      .single();

    let upvotes, upvoted;

    if (existing) {
      await db.from("question_upvotes").delete().eq("id", existing.id);
      const { data: q } = await db
        .from("questions")
        .select("upvotes")
        .eq("id", questionId)
        .single();
      upvotes = Math.max(0, (q?.upvotes ?? 1) - 1);
      await db.from("questions").update({ upvotes }).eq("id", questionId);
      upvoted = false;
    } else {
      await db.from("question_upvotes").insert({ question_id: questionId, user_id: req.user.id });
      const { data: q } = await db
        .from("questions")
        .select("upvotes")
        .eq("id", questionId)
        .single();
      upvotes = (q?.upvotes ?? 0) + 1;
      await db.from("questions").update({ upvotes }).eq("id", questionId);
      upvoted = true;
    }

    res200(res, { upvoted, upvotes });
  }),

  /**
   * PUT /api/questions/:questionId/resolve
   */
  resolveQuestion: asyncHandler(async (req, res) => {
    const { data: question } = await db
      .from("questions")
      .select("user_id, course_id, is_resolved")
      .eq("id", req.params.questionId)
      .single();

    if (!question) return res404(res, "Question not found");

    // The author, or this course's teacher (or an admin) — not every instructor (Phase 15 item 6).
    const canResolve = question.user_id === req.user.id || await canManageCourse(req.user, question.course_id);
    if (!canResolve) return res403(res, "Only the question author or teacher can resolve this");

    const { data } = await db
      .from("questions")
      .update({ is_resolved: !question.is_resolved, updated_at: now() })
      .eq("id", req.params.questionId)
      .select("id, is_resolved")
      .single();

    res200(res, data);
  }),

  /**
   * DELETE /api/questions/:questionId
   */
  deleteQuestion: asyncHandler(async (req, res) => {
    const { data: question } = await db
      .from("questions")
      .select("user_id, course_id")
      .eq("id", req.params.questionId)
      .single();

    if (!question) return res404(res, "Question not found");

    const canDelete = question.user_id === req.user.id || await canManageCourse(req.user, question.course_id);
    if (!canDelete) return res403(res, "Not authorised");

    await db.from("questions").delete().eq("id", req.params.questionId);
    res204(res);
  }),
};

// ─── Announcement Handlers ────────────────────────────────────────────────────

const announcementHandlers = {

  /**
   * GET /api/courses/:courseId/announcements
   */
  list: asyncHandler(async (req, res) => {
    const { pinned, important, limit = 20, offset = 0 } = req.query;

    let query = db
      .from("announcements")
      .select(`
        id, title, content, is_important, is_pinned, scheduled_for, sent_at, created_at,
        users!announcements_author_id_fkey ( id, full_name, username, avatar_url )
      `, { count: "exact" })
      .eq("course_id", req.params.courseId)
      .order("is_pinned",   { ascending: false })
      .order("created_at",  { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (pinned    !== undefined) query = query.eq("is_pinned",   pinned    === "true");
    if (important !== undefined) query = query.eq("is_important", important === "true");

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    // Attach read status per user
    const enriched = await Promise.all((data ?? []).map(async (a) => {
      const { data: read } = await db
        .from("announcement_reads")
        .select("id")
        .eq("announcement_id", a.id)
        .eq("user_id", req.user.id)
        .single();
      return { ...a, is_read: !!read };
    }));

    res200(res, enriched, { total: count ?? 0 });
  }),

  /**
   * POST /api/courses/:courseId/announcements
   */
  create: asyncHandler(async (req, res) => {
    const { title, content, is_important = false, is_pinned = false, scheduled_for } = req.body;
    const { courseId } = req.params;

    // Verify ownership
    const { data: course } = await db
      .from("courses")
      .select("instructor_id")
      .eq("id", courseId)
      .single();

    if (!course) return res404(res, "Course not found");
    if (course.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Only the course instructor can post announcements");

    const { data, error } = await db
      .from("announcements")
      .insert({
        course_id:     courseId,
        author_id:     req.user.id,
        title, content, is_important, is_pinned,
        scheduled_for: scheduled_for ?? null,
        sent_at:       scheduled_for ? null : now(),
      })
      .select(`
        id, title, content, is_important, is_pinned, sent_at, created_at,
        users!announcements_author_id_fkey ( id, full_name, username )
      `)
      .single();

    if (error) throw new Error(error.message);

    // Notify enrolled students immediately (if not scheduled)
    if (!scheduled_for) {
      const { data: enrollments } = await db
        .from("enrollments")
        .select("user_id, users(email, full_name, phone)")
        .eq("course_id", courseId)
        .eq("status", "active");

      for (const e of (enrollments ?? [])) {
        if (e.user_id === req.user.id) continue;
        await sendDirectNotification({
          userId:       e.user_id,
          type:         "new_announcement",
          title,
          content:      content.slice(0, 120),
          relatedId:    data.id,
          emailSubject: `${title}`,
          emailHtml:    `<p><strong>${title}</strong></p><p>${content}</p>`,
          smsBody:      `Piabam: New announcement in your course: "${title}"`,
        }).catch(() => {});
      }
    }

    // Broadcast via Socket.io to course chat room
    req.app.get("io")?.to(`chat:${courseId}`).emit("system-alert", {
      text: `New announcement: ${title}`,
    });

    res201(res, data);
  }),

  /**
   * PUT /api/announcements/:announcementId
   */
  update: asyncHandler(async (req, res) => {
    const allowed = ["title", "content", "is_important", "is_pinned", "scheduled_for"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

    const { data, error } = await db
      .from("announcements")
      .update(updates)
      .eq("id", req.params.announcementId)
      .eq("author_id", req.user.id)
      .select()
      .single();

    if (error || !data) return res404(res, "Announcement not found or not authorised");
    res200(res, data);
  }),

  /**
   * DELETE /api/announcements/:announcementId
   */
  delete: asyncHandler(async (req, res) => {
    const { data } = await db
      .from("announcements")
      .select("author_id")
      .eq("id", req.params.announcementId)
      .single();

    if (!data) return res404(res, "Announcement not found");

    const canDelete = data.author_id === req.user.id || req.user.role === "admin";
    if (!canDelete) return res403(res, "Not authorised");

    await db.from("announcements").delete().eq("id", req.params.announcementId);
    res204(res);
  }),

  /**
   * POST /api/announcements/:announcementId/read
   */
  markRead: asyncHandler(async (req, res) => {
    await db
      .from("announcement_reads")
      .upsert(
        { announcement_id: req.params.announcementId, user_id: req.user.id },
        { onConflict: "announcement_id,user_id" }
      );
    res200(res, { read: true });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// Q&A
router.get   ("/courses/:courseId/questions",             authenticateToken, qaHandlers.listQuestions);
router.post  ("/courses/:courseId/questions",             authenticateToken, [body("title").notEmpty(), body("content").notEmpty()], runValidation, qaHandlers.postQuestion);
router.get   ("/questions/:questionId",                   authenticateToken, qaHandlers.getQuestion);
router.post  ("/questions/:questionId/answers",           authenticateToken, [body("content").notEmpty()], runValidation, qaHandlers.postAnswer);
router.put   ("/questions/:questionId/upvote",            authenticateToken, qaHandlers.upvoteQuestion);
router.put   ("/questions/:questionId/resolve",           authenticateToken, qaHandlers.resolveQuestion);
router.delete("/questions/:questionId",                   authenticateToken, qaHandlers.deleteQuestion);

// Announcements
router.get   ("/courses/:courseId/announcements",         authenticateToken, announcementHandlers.list);
router.post  ("/courses/:courseId/announcements",         authenticateToken, requireRole(["instructor", "admin"]), [body("title").notEmpty(), body("content").notEmpty()], runValidation, announcementHandlers.create);
router.put   ("/announcements/:announcementId",           authenticateToken, requireRole(["instructor", "admin"]), announcementHandlers.update);
router.delete("/announcements/:announcementId",           authenticateToken, announcementHandlers.delete);
router.post  ("/announcements/:announcementId/read",      authenticateToken, announcementHandlers.markRead);

export default router;
