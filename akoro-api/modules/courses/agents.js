/**
 * agents.js  —  Piabam User Agent Profiles router
 *
 * Handles:
 *   - Get / create / update agent profile (one per user)
 *   - Trigger agent to reply in class chat
 *   - Course agent leaderboard
 *
 * Usage in app.js:
 *   import agentsRouter from "./routes/agents.js";
 *   app.use("/api", agentsRouter);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true, data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true, data });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

const AGENT_SELECT = "id, agent_name, agent_emoji, agent_color, agent_bg, total_xp, system_prompt, personality, teacher_agent_id, guide_name, guide_emoji, guide_render_style, is_active, created_at, updated_at";

const NANA_RENDER_STYLE = {
  bubbleBg:     "rgba(124,58,237,0.10)",
  bubbleBorder: "#7C3AED",
  labelColor:   "#7C3AED",
  ttsVoice:     "alloy",
  assessStyle:  "gentle",
};

const handlers = {

  /**
   * GET /api/user/agent
   * Returns the student's AI agent + their active guide/teacher agent.
   * student agent = Atlas/Aria (what they named their AI)
   * guide agent   = NaNa or purchased teacher (who coaches during sessions)
   */
  get: asyncHandler(async (req, res) => {
    let { data: agent } = await db
      .from("user_agents")
      .select(AGENT_SELECT)
      .eq("user_id", req.user.id)
      .single();

    if (!agent) {
      const { data: created, error } = await db
        .from("user_agents")
        .insert({
          user_id:           req.user.id,
          agent_name:        `Agent_${req.user.username ?? req.user.id.slice(0, 6)}`,
          agent_emoji:       "🤖",
          agent_color:       "#E8884A",
          agent_bg:          "#FEF0E6",
          teacher_agent_id:  "nana-sargeant",
          guide_name:        "NaNa Esumai",
          guide_emoji:       "🧠",
          guide_render_style: NANA_RENDER_STYLE,
        })
        .select(AGENT_SELECT)
        .single();

      if (error) throw new Error(error.message);
      agent = created;
    }

    // §7.13.1a: "Let my agent help other learners" (on until the learner turns it off).
    try { agent = { ...agent, help_others_opt_in: await (await import("../../lib/peerConsult.js")).readHelpOthersOptIn(req.user.id) }; } catch { /* the setting reads as on */ }

    // Also pull the active teacher agent's orchestration config
    // to return render_style + tts_voice if they've purchased one
    let guideRenderStyle = agent.guide_render_style || NANA_RENDER_STYLE;
    let ttsVoice = guideRenderStyle.ttsVoice || "alloy";

    if (agent.teacher_agent_id && agent.teacher_agent_id !== "nana-sargeant") {
      try {
        const { data: oc } = await db
          .schema("edu")
          .from("agent_orchestration_configs")
          .select("agent_id, tts_voice")
          .eq("agent_id", agent.teacher_agent_id)
          .single();

        const { data: tp } = await db
          .schema("edu")
          .from("teacher_profiles")
          .select("agent_name, render_style")
          .eq("agent_id", agent.teacher_agent_id)
          .single();

        if (tp?.render_style) {
          guideRenderStyle = { ...NANA_RENDER_STYLE, ...tp.render_style };
          ttsVoice = tp.render_style.ttsVoice || oc?.tts_voice || "alloy";
        }
      } catch { /* keep defaults */ }
    }

    res200(res, {
      // Student's AI agent (Atlas, Aria, etc.)
      id:          agent.id,
      agent_name:  agent.agent_name,
      agent_emoji: agent.agent_emoji,
      agent_color: agent.agent_color,
      agent_bg:    agent.agent_bg,
      total_xp:    agent.total_xp,
      // Guide / teacher agent (NaNa or purchased)
      teacher_agent_id:  agent.teacher_agent_id  || "nana-sargeant",
      guide_name:        agent.guide_name        || "NaNa Esumai",
      guide_emoji:       agent.guide_emoji       || "🧠",
      guide_render_style: guideRenderStyle,
      tts_voice:         ttsVoice,
    });
  }),

  /**
   * PUT /api/user/agent
   * Create or update the user's agent profile.
   */
  upsert: asyncHandler(async (req, res) => {
    const {
      agent_name, agent_emoji, agent_color, agent_bg,
      system_prompt, personality, photo_url,
      study_level, year_group, exam_board, subjects, goal,
    } = req.body;

    const { data: existing } = await db
      .from("user_agents")
      .select("id")
      .eq("user_id", req.user.id)
      .single();

    let data, error;

    if (existing) {
      const updates = {};
      if (agent_name    != null) updates.agent_name    = agent_name;
      if (agent_emoji   != null) updates.agent_emoji   = agent_emoji;
      if (agent_color   != null) updates.agent_color   = agent_color;
      if (agent_bg      != null) updates.agent_bg      = agent_bg;
      if (system_prompt != null) updates.system_prompt = system_prompt;
      if (personality   != null) updates.personality   = personality;
      if (photo_url     != null) updates.photo_url     = photo_url;
      if (study_level   != null) updates.study_level   = study_level;
      if (year_group    != null) updates.year_group    = year_group;
      if (exam_board    != null) updates.exam_board    = exam_board;
      if (subjects      != null) updates.subjects      = subjects;
      if (goal          != null) updates.goal          = goal;
      updates.updated_at = now();

      ({ data, error } = await db
        .from("user_agents")
        .update(updates)
        .eq("id", existing.id)
        .select(AGENT_SELECT)
        .single());
    } else {
      ({ data, error } = await db
        .from("user_agents")
        .insert({
          user_id:       req.user.id,
          agent_name:    agent_name    ?? `Agent_${req.user.id.slice(0, 6)}`,
          agent_emoji:   agent_emoji   ?? "🤖",
          agent_color:   agent_color   ?? "#E8884A",
          agent_bg:      agent_bg      ?? "#FEF0E6",
          system_prompt: system_prompt ?? null,
          personality:   personality   ?? null,
          photo_url:     photo_url     ?? null,
          study_level:   study_level   ?? null,
          year_group:    year_group    ?? null,
          exam_board:    exam_board    ?? null,
          subjects:      subjects      ?? [],
          goal:          goal          ?? null,
        })
        .select(AGENT_SELECT)
        .single());
    }

    if (error) throw new Error(error.message);
    // §7.13.1a "Let my agent help other learners": saved with the agent, and it
    // marks the learner's non-sensitive struggle records shareable as stories (or not).
    if (typeof req.body.help_others_opt_in === "boolean") {
      const { setHelpOthersOptIn } = await import("../../lib/peerConsult.js");
      const saved = await setHelpOthersOptIn(req.user.id, req.body.help_others_opt_in);
      return res200(res, { ...data, help_others_opt_in: saved.helpOthersOptIn });
    }
    res200(res, data);
  }),

  /**
   * POST /api/user/agent/reply
   * Trigger the user's agent to post an AI reply in a course chat.
   * Body: { courseId, triggerMessage }
   */
  reply: asyncHandler(async (req, res) => {
    const { courseId, triggerMessage } = req.body;

    const { data: agent } = await db
      .from("user_agents")
      .select(AGENT_SELECT)
      .eq("user_id", req.user.id)
      .single();

    if (!agent) return res404(res, "No agent found. Create one first via PUT /api/user/agent");

    let replyText;
    try {
      const { generateAgentReply } = await import("../services/agentService.js");
      replyText = await generateAgentReply({
        courseId,
        triggerMessage,
        agentName: agent.agent_name,
        userId:    req.user.id,
      });
    } catch (e) {
      console.warn("[agents] agentService unavailable:", e.message);
      replyText = `${agent.agent_name} is processing... 🤔`;
    }

    // Save message to class_messages
    const { data: message, error } = await db
      .from("class_messages")
      .insert({
        course_id:    courseId,
        sender_id:    req.user.id,
        sender_type:  "agent",
        agent_id:     agent.id,
        message:      replyText,
        message_type: "text",
      })
      .select(`
        id, course_id, sender_type, message, created_at,
        user_agents ( agent_name, agent_emoji, agent_color, agent_bg )
      `)
      .single();

    if (error) throw new Error(error.message);

    // Award XP
    await db
      .from("user_agents")
      .update({ total_xp: agent.total_xp + 10, updated_at: now() })
      .eq("id", agent.id);

    // Broadcast to course chat room
    req.app.get("io")?.to(`chat:${courseId}`).emit("new-message", message);

    res201(res, { message, xp_awarded: 10, total_xp: agent.total_xp + 10 });
  }),

  /**
   * GET /api/courses/:courseId/agents
   * All agents active in a course, ranked by XP (for leaderboard display in chat).
   */
  courseLeaderboard: asyncHandler(async (req, res) => {
    const { courseId } = req.params;

    // Get all enrolled users + instructor
    const { data: enrollments } = await db
      .from("enrollments")
      .select("user_id")
      .eq("course_id", courseId)
      .eq("status", "active");

    const { data: course } = await db
      .from("courses")
      .select("instructor_id")
      .eq("id", courseId)
      .single();

    const userIds = [
      ...(enrollments ?? []).map((e) => e.user_id),
      course?.instructor_id,
    ].filter(Boolean);

    if (!userIds.length) return res200(res, [], { total: 0 });

    const { data: agents, error } = await db
      .from("user_agents")
      .select(`
        ${AGENT_SELECT},
        users!user_agents_user_id_fkey ( id, username, full_name, role )
      `)
      .in("user_id", userIds)
      .eq("is_active", true)
      .order("total_xp", { ascending: false });

    if (error) throw new Error(error.message);

    // Attach message count in this course
    const enriched = await Promise.all((agents ?? []).map(async (a) => {
      const { count } = await db
        .from("class_messages")
        .select("id", { count: "exact", head: true })
        .eq("course_id", courseId)
        .eq("sender_id", a.users?.id)
        .eq("sender_type", "agent");

      return { ...a, course_message_count: count ?? 0 };
    }));

    res200(res, enriched, { total: enriched.length });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get ("/user/agent",                    authenticateToken, handlers.get);
router.put ("/user/agent",                    authenticateToken, [
  body("agent_name").optional().trim().isLength({ max: 100 }),
  body("agent_emoji").optional().trim(),
  body("agent_color").optional().trim(),
  body("agent_bg").optional().trim(),
  body("personality").optional().trim().isLength({ max: 500 }),
  body("photo_url").optional().trim(),
  body("study_level").optional().trim(),
  body("year_group").optional().trim(),
  body("exam_board").optional().trim(),
  body("subjects").optional().isArray(),
  body("goal").optional().trim(),
  body("help_others_opt_in").optional().isBoolean(),
], runValidation, handlers.upsert);
router.post("/user/agent/reply",              authenticateToken, [
  body("courseId").notEmpty(),
  body("triggerMessage").notEmpty(),
], runValidation, handlers.reply);
router.get ("/courses/:courseId/agents",      authenticateToken, handlers.courseLeaderboard);

export default router;
