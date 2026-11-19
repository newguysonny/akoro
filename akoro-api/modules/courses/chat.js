/**
 * chat.js  —  Piabam Live Class Comment Feed router
 *
 * Handles:
 *   - Fetch recent messages (paginated, cursor-based)
 *   - Post student / teacher message
 *   - Post agent message → triggers agentService for AI reply
 *   - Toggle like on a message
 *   - Pin / unpin message (teacher only)
 *   - Delete message (owner or teacher)
 *   - Get pinned messages
 *
 * All writes broadcast via Socket.io to the course chat room.
 *
 * Usage in app.js:
 *   import chatRouter from "./routes/chat.js";
 *   app.use("/api", chatRouter);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/index.js";
import { canManageCourse, canUseCourse }  from "./courseAccess.js";

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

// ─── Message shape builder ────────────────────────────────────────────────────

const MESSAGE_SELECT = `
  id, course_id, sender_type, message, message_type,
  reply_to_id, likes, is_pinned, created_at,
  users!class_messages_sender_id_fkey ( id, username, full_name, avatar_url ),
  user_agents ( id, agent_name, agent_emoji, agent_color, agent_bg )
`;

// ─── Handlers ─────────────────────────────────────────────────────────────────

const handlers = {

  /**
   * GET /api/courses/:courseId/messages?before=<cursor>&limit=50
   */
  list: asyncHandler(async (req, res) => {
    const { courseId }      = req.params;
    const { before, limit = 50 } = req.query;

    let query = db
      .from("class_messages")
      .select(MESSAGE_SELECT)
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(Number(limit));

    if (before) query = query.lt("id", before);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const messages = (data ?? []).reverse();
    res200(res, messages, { has_more: messages.length === Number(limit) });
  }),

  /**
   * GET /api/courses/:courseId/messages/pinned
   */
  pinned: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("class_messages")
      .select(MESSAGE_SELECT)
      .eq("course_id", req.params.courseId)
      .eq("is_pinned", true)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    res200(res, data ?? []);
  }),

  /**
   * POST /api/courses/:courseId/messages
   * Student or teacher posts a text message.
   */
  post: asyncHandler(async (req, res) => {
    const { courseId }   = req.params;
    const { message, reply_to_id } = req.body;
    const senderType = ["instructor", "admin"].includes(req.user.role) ? "teacher" : "student";

    const { data, error } = await db
      .from("class_messages")
      .insert({
        course_id:   courseId,
        sender_id:   req.user.id,
        sender_type: senderType,
        message,
        reply_to_id: reply_to_id ?? null,
      })
      .select(MESSAGE_SELECT)
      .single();

    if (error) throw new Error(error.message);

    req.app.get("io")?.to(`chat:${courseId}`).emit("new-message", data);
    res201(res, data);
  }),

  /**
   * POST /api/courses/:courseId/messages/agent
   * Student triggers their agent to reply.
   * Calls agentService for an AI-generated response, saves and broadcasts it.
   */
  postAgent: asyncHandler(async (req, res) => {
    const { courseId }       = req.params;
    const { trigger_message } = req.body;

    // Get user's agent
    const { data: agent } = await db
      .from("user_agents")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    if (!agent)
      return res404(res, "No agent found. Create your agent first via PUT /api/user/agent");

    // Generate AI reply
    let replyText;
    try {
      const { generateAgentReply } = await import("../services/agentService.js");
      replyText = await generateAgentReply({
        courseId,
        triggerMessage: trigger_message,
        agentName:      agent.agent_name,
        userId:         req.user.id,
      });
    } catch (e) {
      console.warn("[chat] agentService not available:", e.message);
      replyText = `${agent.agent_name} is thinking... 🤔`;
    }

    const { data, error } = await db
      .from("class_messages")
      .insert({
        course_id:    courseId,
        sender_id:    req.user.id,
        sender_type:  "agent",
        agent_id:     agent.id,
        message:      replyText,
        message_type: "text",
      })
      .select(MESSAGE_SELECT)
      .single();

    if (error) throw new Error(error.message);

    // Award XP to agent
    await db
      .from("user_agents")
      .update({ total_xp: agent.total_xp + 10, updated_at: new Date().toISOString() })
      .eq("id", agent.id);

    req.app.get("io")?.to(`chat:${courseId}`).emit("new-message", data);
    res201(res, data);
  }),

  /**
   * POST /api/messages/:messageId/like
   * Toggle like — adds or removes the user's like.
   */
  toggleLike: asyncHandler(async (req, res) => {
    const { messageId } = req.params;

    const { data: target } = await db.from("class_messages").select("course_id").eq("id", messageId).maybeSingle();
    if (!target) return res404(res, "Message not found");
    if (!(await canUseCourse(req.user, target.course_id))) return res403(res, "Join this course to use its chat");

    const { data: existing } = await db
      .from("class_message_likes")
      .select("id")
      .eq("message_id", messageId)
      .eq("user_id", req.user.id)
      .single();

    let likes;
    if (existing) {
      await db.from("class_message_likes").delete().eq("id", existing.id);
      const { data: msg } = await db
        .from("class_messages")
        .update({ likes: db.rpc("greatest", { a: 0 }) })
        .eq("id", messageId)
        .select("likes, course_id")
        .single();
      // Supabase doesn't support inline decrement simply — use raw update
      await db.from("class_messages").update({ likes: Math.max(0, (msg?.likes ?? 1) - 1) }).eq("id", messageId);
      const { data: updated } = await db.from("class_messages").select("likes, course_id").eq("id", messageId).single();
      likes = updated?.likes ?? 0;
      req.app.get("io")?.to(`chat:${updated?.course_id}`).emit("message-liked", { messageId, likes });
      return res200(res, { liked: false, likes });
    }

    await db.from("class_message_likes").insert({ message_id: messageId, user_id: req.user.id });
    const { data: msg } = await db
      .from("class_messages")
      .select("likes, course_id")
      .eq("id", messageId)
      .single();

    likes = (msg?.likes ?? 0) + 1;
    await db.from("class_messages").update({ likes }).eq("id", messageId);
    req.app.get("io")?.to(`chat:${msg?.course_id}`).emit("message-liked", { messageId, likes });
    res200(res, { liked: true, likes });
  }),

  /**
   * POST /api/messages/:messageId/pin
   * Toggle pin (teacher only).
   */
  togglePin: asyncHandler(async (req, res) => {
    const { data: msg } = await db
      .from("class_messages")
      .select("id, is_pinned, course_id")
      .eq("id", req.params.messageId)
      .single();

    if (!msg) return res404(res, "Message not found");
    // The course's own teacher — not any account with the instructor role.
    if (!(await canManageCourse(req.user, msg.course_id))) return res403(res, "Only this course's teacher can pin messages");

    const { data: updated } = await db
      .from("class_messages")
      .update({ is_pinned: !msg.is_pinned })
      .eq("id", msg.id)
      .select("id, is_pinned, course_id")
      .single();

    req.app.get("io")?.to(`chat:${msg.course_id}`).emit("message-pinned", {
      messageId: msg.id,
      is_pinned: updated.is_pinned,
    });

    res200(res, { is_pinned: updated.is_pinned });
  }),

  /**
   * DELETE /api/messages/:messageId
   * Owner or teacher can delete.
   */
  delete: asyncHandler(async (req, res) => {
    const { data: msg } = await db
      .from("class_messages")
      .select("id, sender_id, course_id")
      .eq("id", req.params.messageId)
      .single();

    if (!msg) return res404(res, "Message not found");

    const isOwner   = msg.sender_id === req.user.id;
    if (!isOwner && !(await canManageCourse(req.user, msg.course_id))) return res403(res, "Not authorised to delete this message");

    await db.from("class_messages").delete().eq("id", msg.id);
    res204(res);
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/** A course's chat is for the people in it: its teacher, an admin, or an enrolled learner (Phase 15 item 6). */
const requireCourseMember = asyncHandler(async (req, res, next) => {
  if (!(await canUseCourse(req.user, req.params.courseId))) return res403(res, "Join this course to use its chat");
  next();
});

router.get   ("/courses/:courseId/messages",            authenticateToken, requireCourseMember, handlers.list);
router.get   ("/courses/:courseId/messages/pinned",     authenticateToken, requireCourseMember, handlers.pinned);
router.post  ("/courses/:courseId/messages",            authenticateToken, requireCourseMember, [body("message").notEmpty()], runValidation, handlers.post);
router.post  ("/courses/:courseId/messages/agent",      authenticateToken, requireCourseMember, [body("trigger_message").notEmpty()], runValidation, handlers.postAgent);
router.post  ("/messages/:messageId/like",              authenticateToken, handlers.toggleLike);
router.post  ("/messages/:messageId/pin",               authenticateToken, handlers.togglePin);
router.delete("/messages/:messageId",                   authenticateToken, handlers.delete);

export default router;
