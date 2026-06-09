// =============================================================
// chat.js  v3.1
// HTTP routes — all session types + decay system routes.
// New in v3.1:
//   GET  /decay/status/:studentId     — knowledge health dashboard
//   GET  /decay/alerts/:studentId     — unread decay notifications
//   GET  /decay/subjects/:studentId   — all subjects + confidence
//   GET  /decay/topics/:studentId/:subject — topics in a subject
//   POST /decay/session/start         — start a decay review session
//   POST /decay/acknowledge/:notifId  — mark notification read
//   POST /decay/run                   — manually trigger decay check
// =============================================================

import express from "express";
import { authenticateToken } from "../auth/routes.js";
import pkg from "pg";
const { Pool } = pkg;
import OpenAI    from "openai";
import Anthropic from "@anthropic-ai/sdk";
import db from "../../db.js";

import { getOrchestrator, listAgentPairs, getAgentPairProfile } from "./agents/registry.js";
import { clearStateCache, getAgentPreferences, saveAgentPreferences } from "./student-state.js";
import {
  getOrCreateStudentAgent,
  getAgentGrowthHistory,
  getAgentIntelligence,
  retrieveAgentKnowledge,
  saveStudentKnowledge,
  getAgentKnowledgeBySubject,
  getTopicsBySubject,
} from "./agents/student/knowledge.js";
import { decayEngine } from "./agents/student/decayEngine.js";
import { activeSessions } from "./websocket.js";

const router     = express.Router();
const pool       = new Pool({ connectionString: process.env.DATABASE_URL });
const query      = (text, params) => pool.query(text, params);
const openai     = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PHASE_PLAN = [
  "Phase 1 → what do they know",
  "Phase 2 → must-know parts",
  "Phase 3 → teach it back",
  "Phase 4 → push further",
];

/* ─── reconstructHistoryBlocks ──────────────────────────────────────────────
   Rebuilds the typed block array from a completed teaching session.
   Priority: block_history column (exact) → session_phase_progress (derived).
   Returns faded blocks for the decay session overlay.
─────────────────────────────────────────────────────────────────────────────*/
async function reconstructHistoryBlocks(sessionId, topic, subject, agentName, agentEmoji) {
  try {
    // 1. Try exact block history saved during session
    const { data: session } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("block_history, subtopics, objectives, completed_at, updated_at")
      .eq("id", sessionId)
      .single();

    if (!session) return [];

    const completedAt = session.completed_at || session.updated_at;
    const daysSince   = Math.max(0, Math.round(
      (Date.now() - new Date(completedAt).getTime()) / 86_400_000
    ));

    // If we have the exact block history, fade all blocks and return
    if (session.block_history?.length > 0) {
      const faded = session.block_history.map(b => ({ ...b, faded: true }));
      return [
        { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
        ...faded,
      ];
    }

    // 2. Derive blocks from session_phase_progress
    const subtopics  = JSON.parse(session.subtopics  || "[]");
    const objectives = JSON.parse(session.objectives || "{}");

    const { data: progress } = await db.schema("edu")
      .from("session_phase_progress")
      .select("*")
      .eq("session_id", sessionId)
      .order("subtopic_idx");

    const blocks = [
      { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
    ];

    for (const prog of progress || []) {
      // Subtopic header + plan + objectives at start of each subtopic
      if (prog.phase === "1") {
        blocks.push({
          type: "subtopic-hdr", faded: true,
          subtopic: prog.subtopic, idx: prog.subtopic_idx,
          total: subtopics.length, topic, subject,
        });
        blocks.push({ type: "plan", phases: PHASE_PLAN, faded: true });
        const objs = objectives[prog.subtopic] || [];
        if (objs.length) {
          blocks.push({ type: "objectives", subtopic: prog.subtopic, items: objs, faded: true });
        }
        blocks.push({
          type: "guide", agent: "NaNa Esumai", emoji: "🧠", faded: true,
          phase: `Phase 1 — ${prog.subtopic}`,
          text:  `Starting ${prog.subtopic}. ${agentName} confidence: ${prog.confidence_start || 20}%.`,
        });
      }

      // Sargeant assessment result at end of each subtopic
      if (prog.phase === "assessment" && prog.assessment_score !== null) {
        const confPct    = Math.round(prog.assessment_score * 100);
        const confEnd    = Math.round(prog.confidence_end   ?? confPct);
        blocks.push({
          type: "student-agent", agent: agentName, emoji: agentEmoji, faded: true,
          phase: `${agentName} · Phase 4 complete · ${confEnd}%`,
          confidence: confEnd,
          text: `I understand ${prog.subtopic} now. My knowledge has solidified.`,
        });
        blocks.push({
          type:         "assess-result", faded: true,
          subtopic:     prog.subtopic,
          agentName,
          confidence:   confPct,
          passed:       prog.passed,
          nextSubtopic: subtopics[prog.subtopic_idx + 1] || null,
        });
      }
    }

    return blocks;
  } catch (e) {
    console.warn("[reconstructHistoryBlocks]", e.message);
    return [];
  }
}

// ─── Global chat tools (added to /chat for mini-ChatGPT functionality) ────────
// These execute against the student's real data when the agent needs them.

const CHAT_TOOLS = [
  {
    name: "check_progress",
    description: "Check the student's progress across all enrolled courses. Returns completion % and overall XP.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_task",
    description: "Create a study task or reminder for the student. Use when they ask to be reminded about something.",
    input_schema: {
      type: "object",
      properties: {
        title:    { type: "string", description: "Short task title" },
        priority: { type: "string", enum: ["high", "medium", "low"] },
        due:      { type: "string", description: "e.g. 'Today', 'Tomorrow', 'This week'" },
        course:   { type: "string", description: "Related course or subject (optional)" },
      },
      required: ["title", "priority"],
    },
  },
  {
    name: "list_tasks",
    description: "Get the student's pending tasks sorted by priority.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_battles",
    description: "Find active and upcoming battles in courses the student is enrolled in.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_ranking",
    description: "Get the student's XP, rank, streak and leaderboard position.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_weak_topics",
    description: "Get topics where the student has low confidence. Use for study recommendations.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Filter by subject (optional)" },
      },
      required: [],
    },
  },
];

async function executeChatTool(name, input, studentId) {
  switch (name) {
    case "check_progress": {
      const { data: enrollments } = await db.from("enrollments")
        .select("course_id, progress, courses!inner(title, subject)")
        .eq("user_id", studentId).eq("status", "active");
      const { data: xpRow } = await db.from("xp_leaderboard")
        .select("total_xp, rank").eq("user_id", studentId).limit(1);
      return {
        courses:  (enrollments ?? []).map(e => ({ title: e.courses?.title, subject: e.courses?.subject, progress: e.progress ?? 0 })),
        total_xp: xpRow?.[0]?.total_xp ?? 0,
        rank:     xpRow?.[0]?.rank ?? "—",
      };
    }
    case "create_task": {
      const { data: agentRow } = await db.from("user_agents").select("id").eq("user_id", studentId).single();
      const { data: task, error } = await db.from("tasks").insert({
        creator_id: studentId, agent_id: agentRow?.id,
        title: input.title, priority: input.priority ?? "medium",
        status: "pending", task_type: "general",
        payload: { due: input.due ?? "This week" },
        timezone: "Africa/Lagos",
      }).select().single();
      if (error) return { error: error.message };
      global.io?.to(`user:${studentId}`).emit("task:created", task);
      return { created: true, title: task.title, priority: task.priority };
    }
    case "list_tasks": {
      const { data } = await db.from("tasks")
        .select("id, title, priority, status, payload")
        .eq("creator_id", studentId).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(10);
      return { tasks: data ?? [], count: data?.length ?? 0 };
    }
    case "find_battles": {
      const { data: enrolled } = await db.from("enrollments")
        .select("course_id").eq("user_id", studentId).eq("status", "active");
      const ids = (enrolled ?? []).map(e => e.course_id);
      if (!ids.length) return { battles: [] };
      const { data } = await db.from("battles")
        .select("id, title, status, battle_type, xp_pool, courses!inner(title)")
        .in("course_id", ids).in("status", ["live", "scheduled", "lobby"]).limit(5);
      return { battles: (data ?? []).map(b => ({ id: b.id, title: b.title, status: b.status, course: b.courses?.title, xp_pool: b.xp_pool })) };
    }
    case "get_ranking": {
      const { data } = await db.from("xp_leaderboard")
        .select("total_xp, rank, scope, battles_won, win_rate")
        .eq("user_id", studentId).limit(3);
      return { entries: data ?? [] };
    }
    case "get_weak_topics": {
      const { data: agentRow } = await db.schema("edu").from("student_agents")
        .select("id").eq("student_id", studentId).single();
      if (!agentRow) return { weak_topics: [], message: "No knowledge profile yet — start a session!" };
      let q = db.schema("edu").from("student_knowledge")
        .select("topic, subject, confidence, priority")
        .eq("agent_id", agentRow.id).order("confidence");
      if (input.subject) q = q.eq("subject", input.subject);
      const { data } = await q.limit(8);
      return { weak_topics: (data ?? []).filter(t => t.confidence < 0.5).map(t => ({ topic: t.topic, subject: t.subject, confidence: Math.round((t.confidence ?? 0) * 100) + "%", priority: t.priority })) };
    }
    default: return { error: `Unknown tool: ${name}` };
  }
}
// =============================================================
// FORMAT HELPERS
// =============================================================

function fmtAdaptiveEngine(engine, agentPairId) {
  const lines = ["🧠 Adaptive Engine:"];
  if (engine.misconception)        lines.push(`  • Misconception flagged: "${engine.misconception}"`);
  if (engine.misconceptionCleared) lines.push(`  • Misconception cleared ✅`);
  if (engine.newConceptLearned)    lines.push(`  • New concept: "${engine.newConceptLearned}" 💡`);
  lines.push(`  • Understanding → ${engine.understanding}%`);
  if (engine.confusion > 25)       lines.push(`  • Confusion spike → ${engine.confusion}%`);
  lines.push(`  • Action → ${engine.actionLabel}`);
  if (agentPairId === "student-session" && engine.agentKnowledgeAdded > 0)
    lines.push(`  • Agent knowledge added → ${engine.agentKnowledgeAdded} chunks 📚`);
  return lines.join("\n");
}

function fmtGuide(message, isUrgent, guideName) {
  if (!message) return null;
  return `${isUrgent ? `${guideName} (Intervenes):` : `${guideName}:`}\n${isUrgent ? "⚠️" : "💡"} ${message}`;
}

function fmtControl(line, controlName) {
  return line ? `${controlName}:\n${line}` : null;
}

function fmtPhaseHeader(label) {
  return [
    `═══════════════════════════════════════════════════════════════`,
    label,
    `═══════════════════════════════════════════════════════════════`,
  ].join("\n");
}

function fmtSubtopicHeader(subtopic, agentPairId) {
  const prefix = agentPairId === "professor-warden" ? "Module" : "Phase 2 — Must-know parts";
  return fmtPhaseHeader(`${prefix}: ${subtopic}`);
}

function fmtSessionEnd({ evaluation, controlReport, finalState, agentPairId,
                         drillSummary, agentGrowth, decayResult, sessionType }) {
  const score     = evaluation?.overallScore || 0;
  const stars     = "⭐".repeat(Math.round(score / 20));
  const strengths = (evaluation?.strengths || []).map(s => `  ✅ ${s}`).join("\n");
  const guideName = agentPairId?.startsWith("trained:") ? "Teaching Guide"
    : agentPairId === "professor-warden" ? "Professor Ade" : "NaNa Esumai";

  const lines = [``, `${guideName}:`, `🎉 Teaching Score: ${score}/100 ${stars}`];
  if (evaluation?.academicGrade) lines.push(`📋 Academic Grade: ${evaluation.academicGrade}`);
  if (drillSummary) lines.push(`📊 Drill Accuracy: ${drillSummary.accuracy}%`);

  if (decayResult && sessionType === "decay_review") {
    lines.push(``, `🔄 Knowledge Reinforcement:`);
    lines.push(`  Topic: ${decayResult.subject} — ${decayResult.topicReinforced}`);
    lines.push(`  Confidence: ${Math.round(decayResult.confidenceBefore * 100)}% → ${Math.round(decayResult.confidenceAfter * 100)}%`);
    lines.push(`  Next review: ${new Date(decayResult.nextReviewDue).toLocaleDateString()}`);
  }

  if (agentGrowth) {
    lines.push(``, `🤖 Student Agent Growth:`);
    lines.push(`  • Knowledge chunks saved: ${agentGrowth.knowledgeChunksSaved}`);
    lines.push(`  • XP earned: +${agentGrowth.xpEarned}`);
    lines.push(`  • Agent level: ${agentGrowth.agentLevel}`);
    if (agentGrowth.leveledUp) lines.push(`  🎊 LEVEL UP!`);
  }

  if (strengths) lines.push(``, `What you did really well:`, strengths);
  lines.push(
    ``, `One tip for next time:`, `  👉 ${evaluation?.nextTimeTip || "Keep going!"}`,
    ``, controlReport?.summary || "",
    ``, `🧠 FINAL STATE`,
    `Understanding: ${finalState.understanding}% | Confusion: ${finalState.confusion}%`,
    `Mode: MASTERY`, ``,
    `═══════════════════════════════════════════════════════════════`,
    sessionType === "decay_review" ? `DECAY REVIEW COMPLETE` : `SESSION COMPLETE`,
    `Next lesson: ${evaluation?.nextLesson || "Continue the topic"}`,
    `═══════════════════════════════════════════════════════════════`,
  );
  return lines.join("\n");
}

function buildTurnBlocks(result, agentPairId) {
  if (result.type === "drift_warning") {
    return [result.sargeantMessage || "⚠️ Off-topic detected."];
  }
  const blocks = [];
  if (result.phaseChanged && result.phaseLabel)     blocks.push(fmtPhaseHeader(result.phaseLabel));
  else if (result.subtopicAdvanced && result.currentSubtopic)
    blocks.push(fmtSubtopicHeader(result.currentSubtopic, agentPairId));
  if (result.wardenHolding && result.wardenHoldMessage) blocks.push(result.wardenHoldMessage);
  if (result.studentAgentResponse) blocks.push(`🤖 STUDENT AGENT:\n"${result.studentAgentResponse}"`);
  if (result.adaptiveEngine)       blocks.push(fmtAdaptiveEngine(result.adaptiveEngine, agentPairId));
  const guideMsg = fmtGuide(result.guideMessage, result.guideIsUrgent, result.guideName || "Guide");
  if (guideMsg) blocks.push(guideMsg);
  const showCtrl = result.wardenHolding || result.driftInfo?.driftLevel === "edge" ||
    ["PHASE_3","STAGE_3"].includes(result.currentPhase) || result.adaptiveEngine?.understanding >= 88;
  if (result.controlStatusLine && showCtrl) {
    const ctrl = fmtControl(result.controlStatusLine, result.controlName || "Control");
    if (ctrl) blocks.push(ctrl);
  }
  if (result.turnXP) {
    blocks.push(result.sessionType === "decay_review"
      ? `✨ +${result.turnXP} XP (Reinforcement Bonus!)`
      : `✨ +${result.turnXP} XP`);
  }
  return blocks;
}

// =============================================================
// AGENT PAIR ROUTES
// =============================================================

router.get("/agents/pairs", async (req, res) => {
  try { res.json({ success: true, pairs: await listAgentPairs() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/agents/pairs/:pairId", async (req, res) => {
  try {
    const profile = await getAgentPairProfile(req.params.pairId);
    if (!profile) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, profile });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/agents/preferences/:agentId", async (req, res) => {
  try { res.json({ success: true, ...(await getAgentPreferences(req.params.agentId)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/agents/preferences", async (req, res) => {
  try {
    const { agentId, agentPairId } = req.body;
    if (!agentId || !agentPairId) return res.status(400).json({ error: "agentId and agentPairId required" });
    await saveAgentPreferences(agentId, agentPairId);
    res.json({ success: true, agentId, agentPairId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// DECAY ROUTES  (v3.1)
// =============================================================

// GET /decay/status/:studentId — full knowledge health dashboard
router.get("/decay/status/:studentId", async (req, res) => {
  try {
    const agent     = await getOrCreateStudentAgent(req.params.studentId);
    const dashboard = await decayEngine.getKnowledgeDashboard(req.params.studentId, agent.id);
    res.json({ success: true, agentId: agent.id, dashboard });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/alerts/:studentId — unread decay notifications + subtopic alerts
router.get("/decay/alerts/:studentId", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const studentId = req.params.studentId;

    // Original topic-level notifications
    const notifications = await decayEngine.getUnreadNotifications(
      studentId, Number(limit)
    );

    // Subtopic-level alerts from knowledge_confidence table
    const subtopicAlerts = await decayEngine.getSubtopicAlerts(studentId);

    // Merge: subtopic alerts take priority, deduplicate by sessionId
    const seenSessions = new Set();
    const alerts = [];

    for (const a of subtopicAlerts) {
      if (!seenSessions.has(a.sessionId)) {
        seenSessions.add(a.sessionId);
        alerts.push(a);
      }
    }

    // Add topic-level notifications not already covered by subtopic alerts
    for (const n of notifications) {
      const sessionMatch = subtopicAlerts.find(a =>
        a.topic === n.topic && a.subject === n.subject
      );
      if (!sessionMatch) {
        alerts.push({
          id:              n.id,
          sessionId:       n.session_id || null,
          topic:           n.topic,
          subtopic:        n.subtopic || n.topic,
          subject:         n.subject,
          confidence:      Math.round((n.confidence ?? 0.5) * 100),
          prevConfidence:  Math.round((n.prev_confidence ?? 0.7) * 100),
          daysSince:       n.days_since_review || 0,
          misconceptions:  n.misconceptions || [],
        });
      }
    }

    res.json({
      success: true,
      alerts,                       // ← frontend uses this shape
      notifications,                // keep for backward compat
      count: alerts.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/subjects/:studentId — all subjects + confidence summary
router.get("/decay/subjects/:studentId", async (req, res) => {
  try {
    const agent    = await getOrCreateStudentAgent(req.params.studentId);
    const subjects = await getAgentKnowledgeBySubject(agent.id);
    res.json({ success: true, subjects, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/topics/:studentId/:subject — topics in a subject with health
router.get("/decay/topics/:studentId/:subject", async (req, res) => {
  try {
    const agent  = await getOrCreateStudentAgent(req.params.studentId);
    const topics = await getTopicsBySubject(agent.id, req.params.subject);
    res.json({ success: true, subject: req.params.subject, topics, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/session/start — start a focused decay review session (HTTP fallback)
router.post("/decay/session/start", async (req, res) => {
  try {
    const { studentId, subject, topic, teacherAgentId, notificationId } = req.body;
    if (!studentId || !subject || !topic)
      return res.status(400).json({ error: "studentId, subject and topic required" });

    const agent               = await getOrCreateStudentAgent(studentId);
    const agentName           = agent.agent_name  || "Agent";
    const agentEmoji          = agent.agent_emoji || "🤖";
    const decaySessionPayload = await decayEngine.generateDecaySession(
      agent.id, studentId, subject, topic
    );

    if (notificationId) {
      await decayEngine.markNotificationRead(notificationId);
    }

    // Find most recent completed teaching session for this topic
    const { data: prevSession } = await db.schema("edu")
      .from("adaptive_sessions")
      .select("id, completed_at, subtopics, objectives")
      .eq("student_id", studentId)
      .eq("topic", topic)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single()
      .catch(() => ({ data: null }));

    // Reconstruct history blocks from previous session
    const historyBlocks = prevSession
      ? await reconstructHistoryBlocks(prevSession.id, topic, subject, agentName, agentEmoji)
      : [];

    // Fix 7: read student's saved preference if no explicit teacherAgentId
    let resolvedTeacherAgentId = teacherAgentId || null;
    if (!resolvedTeacherAgentId) {
      try {
        const prefs  = await getAgentPreferences(studentId);
        const pairId = prefs.guide_pair_id;
        if (pairId && pairId.startsWith("trained:")) {
          resolvedTeacherAgentId = pairId.replace("trained:", "");
        }
      } catch { /* keep null */ }
    }

    const sessionId    = `decay_${studentId}_${Date.now()}`;
    const orchestrator = await getOrchestrator({
      mode:           "student",
      studentId,
      teacherAgentId: resolvedTeacherAgentId,
      sessionType:    "decay_review",
      decayPayload:   { ...decaySessionPayload, notificationId },
    });

    const init = await orchestrator.initialize(studentId, topic);
    activeSessions.set(sessionId, orchestrator);

    await saveChatMessage(studentId, "[DECAY SESSION START]", init.openingPrompt, {
      sessionId, subject, topic, type: "decay_session_start",
      decayPayload: decaySessionPayload,
    }, "teaching");

    res.json({
      success:          true,
      sessionId,
      agentPairId:      "student-session",
      sessionType:      "decay_review",
      subject,
      topic,
      agentName,
      agentEmoji,
      message:          init.openingPrompt,
      mustKnowParts:    init.mustKnowParts,
      initialState:     init.initialState,
      agentLevel:       init.agentLevel,
      knowledgeScore:   init.knowledgeScore,
      decayPayload:     decaySessionPayload,
      // ← Frontend uses this to pre-populate session history
      historyBlocks,
    });

  } catch (err) {
    console.error("[/decay/session/start]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /decay/acknowledge/:notifId — mark notification as read
router.post("/decay/acknowledge/:notifId", async (req, res) => {
  try {
    await decayEngine.markNotificationRead(req.params.notifId);
    res.json({ success: true, notificationId: req.params.notifId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /decay/run — manually trigger decay check for a student (admin/dev use)
router.post("/decay/run", async (req, res) => {
  try {
    const { studentId } = req.body;

    if (studentId) {
      // Run decay for single student
      const agent       = await getOrCreateStudentAgent(studentId);
      const alertTopics = await decayEngine.applyDecay(agent.id);
      res.json({ success: true, agentId: agent.id, alertTopics, count: alertTopics.length });
    } else {
      // Run full scheduler (all agents)
      const result = await decayEngine.runDecayScheduler(null);
      res.json({ success: true, ...result });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STUDENT AGENT ROUTES
// =============================================================

router.get("/student/agent/:studentId", async (req, res) => {
  try { res.json({ success: true, agent: await getOrCreateStudentAgent(req.params.studentId) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/intelligence", async (req, res) => {
  try {
    const agent = await getOrCreateStudentAgent(req.params.studentId);
    const intel = await getAgentIntelligence(agent.id);
    res.json({ success: true, intelligence: intel, agent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/growth", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const agent   = await getOrCreateStudentAgent(req.params.studentId);
    const history = await getAgentGrowthHistory(agent.id, Number(limit));
    res.json({ success: true, agent, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/:studentId/knowledge", async (req, res) => {
  try {
    const { limit = 20, offset = 0, subject } = req.query;
    let q = db
      .from("edu.student_knowledge")
      .select("id, topic, subject, content, source, confidence, tags, created_at")
      .eq("student_id", req.params.studentId)
      .order("created_at", { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    if (subject) q = q.eq("subject", subject);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, knowledge: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/student/:studentId/knowledge", async (req, res) => {
  try {
    const { topic, subject, content, source = "manual", tags = [] } = req.body;
    if (!topic || !content) return res.status(400).json({ error: "topic and content required" });
    const agent = await getOrCreateStudentAgent(req.params.studentId);
    await saveStudentKnowledge({
      studentId: req.params.studentId, agentId: agent.id,
      topic, subject, content, source, tags, confidence: 0.8,
    });
    res.json({ success: true, message: "Knowledge saved" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/knowledge-search", async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) return res.status(400).json({ error: "q is required" });
    const agent  = await getOrCreateStudentAgent(req.params.studentId);
    const chunks = await retrieveAgentKnowledge(agent.id, q, Number(limit));
    res.json({ success: true, chunks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// TEACHING SESSION ROUTES
// =============================================================

router.post("/teaching/start", async (req, res) => {
  try {
    const {
      agentId, studentId, topic,
      agentPairId: requestedPairId,
      teacherAgentId,
      mode = "teaching",
    } = req.body;

    if (!topic) return res.status(400).json({ error: "topic is required" });

    let orchestrator, init, pairId = requestedPairId;

    if (mode === "student" || studentId) {
      if (!studentId) return res.status(400).json({ error: "studentId required" });
      orchestrator = await getOrchestrator({
        mode: "student", studentId, teacherAgentId: teacherAgentId || null,
      });
      init   = await orchestrator.initialize(studentId, topic);
      pairId = "student-session";
    } else {
      if (!agentId) return res.status(400).json({ error: "agentId required" });
      if (!pairId) { const prefs = await getAgentPreferences(agentId); pairId = prefs.guide_pair_id || "nana-sargeant"; }
      orchestrator = await getOrchestrator({ agentPairId: pairId, agentId });
      init = await orchestrator.initialize(agentId, topic);
    }

    const sessionId = `session_${agentId || studentId}_${Date.now()}`;
    activeSessions.set(sessionId, orchestrator);
    await saveChatMessage(agentId || studentId, "[SESSION START]", init.openingPrompt,
      { sessionId, topic, agentPairId: pairId, mode, type: "session_start" }, "teaching");

    res.json({
      success: true, sessionId, agentPairId: pairId, mode, topic,
      studentAgentName: init.studentAgentName, message: init.openingPrompt,
      mustKnowParts: init.mustKnowParts, topicBoundary: init.topicBoundary,
      initialState: init.initialState, teacherName: init.teacherName || null,
      lecturePlan: init.lecturePlan || null,
      agentLevel: init.agentLevel || null, knowledgeScore: init.knowledgeScore || null,
    });
  } catch (err) { console.error("[/teaching/start]", err); res.status(500).json({ error: err.message }); }
});

router.post("/teaching/message", async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: "sessionId and message required" });
    const orchestrator = activeSessions.get(sessionId);
    if (!orchestrator) return res.status(404).json({ error: "Session not found." });
    const result      = await orchestrator.processTeachingMessage(message);
    const agentPairId = result.agentPairId || "nana-sargeant";
    const blocks      = buildTurnBlocks(result, agentPairId);
    const full        = blocks.join("\n\n");
    const ownerId     = orchestrator.session?.agentId || orchestrator.studentId;
    await saveChatMessage(ownerId, message, full,
      { sessionId, type: result.type, phase: result.currentPhase, agentPairId, sessionType: result.sessionType }, "teaching");
    res.json({ success: true, response: full, blocks, raw: result, agentPairId });
  } catch (err) { console.error("[/teaching/message]", err); res.status(500).json({ error: err.message }); }
});

router.post("/teaching/end", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const orchestrator = activeSessions.get(sessionId);
    if (!orchestrator) return res.status(404).json({ error: "Session not found." });
    const endResult  = await orchestrator.endSession();
    const formatted  = fmtSessionEnd(endResult);
    const ownerId    = orchestrator.session?.agentId || orchestrator.studentId;
    await saveChatMessage(ownerId, "[SESSION END]", formatted,
      { sessionId, type: "session_end", summary: endResult }, "teaching");
    activeSessions.delete(sessionId);
    await clearStateCache(ownerId);
    res.json({ success: true, response: formatted, summary: endResult });
  } catch (err) { console.error("[/teaching/end]", err); res.status(500).json({ error: err.message }); }
});

router.get("/teaching/status/:sessionId", (req, res) => {
  const orch = activeSessions.get(req.params.sessionId);
  if (!orch) return res.status(404).json({ active: false });
  res.json({
    active: true, sessionId: req.params.sessionId,
    topic: orch.session.topic, phase: orch.session.phase,
    turnCount: orch.session.turnCount,
    mustKnowIndex: orch.session.mustKnowIndex || orch.session.moduleIndex || 0,
    agentPairId: orch._profile?.id || orch.constructor.profile?.id,
    sessionType: orch.sessionType || "free_teaching",
  });
});

router.get("/teaching/sessions/:ownerId", (req, res) => {
  const sessions = [];
  for (const [id, orch] of activeSessions.entries()) {
    if (id.includes(req.params.ownerId)) {
      sessions.push({
        sessionId:   id, topic: orch.session.topic,
        phase:       orch.session.phase, turnCount: orch.session.turnCount,
        agentPairId: orch._profile?.id || orch.constructor.profile?.id,
        sessionType: orch.sessionType || "free_teaching",
      });
    }
  }
  res.json({ success: true, sessions, count: sessions.length });
});

// =============================================================
// STANDARD CHAT
// =============================================================

router.post("/chat", async (req, res) => {
  const t0 = Date.now();
  try {
    const { agentId, message, feedback, studentId, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });
    if (studentId) return handleStudentChatWithTools(req, res, studentId, message, history, t0);
    if (!agentId)  return res.status(400).json({ error: "agentId required" });

    const knowledge = await retrieveKnowledge(agentId, message);
    const { response, confidenceUsed, usedNodes } = await generateStandardResponse(agentId, message, knowledge);
    const chatId = await saveChatMessage(agentId, message, response, {
      confidenceUsed, nodesUsed: usedNodes.map(n => ({ id: n.id, topic: n.topic })),
      responseTime: Date.now() - t0,
    }, "standard");

    if (feedback) {
      await updateConfidence(usedNodes, feedback);
      const learned = await learnFromConversation(agentId, message, response, feedback === "helpful");
      if (learned?.learned) {
        await query(`INSERT INTO notifications (agent_id, type, message) VALUES ($1,$2,$3)`,
          [agentId, "learning", `I learned about "${learned.knowledge.topic}"!`]);
      }
    }
    res.json({ success: true, response, metadata: { confidenceUsed, chatId, responseTimeMs: Date.now() - t0 } });
  } catch (err) { console.error("[/chat]", err); res.status(500).json({ error: err.message }); }
});

// ─── handleStudentChatWithTools ──────────────────────────────────────────────
// Global mini-ChatGPT handler for student /chat requests.
// 1. Tries Anthropic with CHAT_TOOLS — executes up to 3 tool loops
// 2. Falls back to the original OpenAI knowledge-base response if no tools used
// The frontend receives both the reply text and a toolExecutions array for display.

async function handleStudentChatWithTools(req, res, studentId, message, history, t0) {
  const agent  = await getOrCreateStudentAgent(studentId);
  const chunks = await retrieveAgentKnowledge(agent.id, message, 4);
  const knowledgeCtx = chunks.length > 0
    ? "\n\n## Your learning history:\n" + chunks.map((c, i) =>
        `[${i+1}] (${c.chunk_type}, ${Math.round((c.confidence||0.5)*100)}%) ${c.topic}: ${c.content}`
      ).join("\n")
    : "";

  const systemPrompt =
    `You are ${agent.name}, an AI learning agent at level ${agent.level} on Akoro Learning Platform.` +
    `\nYou have been taught across ${agent.total_sessions} sessions.` +
    knowledgeCtx +
    `\n\nYou can also use tools to check the student's real progress, tasks, battles, and rankings.` +
    `\nAnswer from your knowledge when you can. Use tools when the student asks about their actual data.` +
    `\nIf you don't know something: "I haven't been taught about that yet — teach me!"`;

  const messages = [
    ...history.slice(-10),
    { role: "user", content: message },
  ];

  const toolExecutions = [];
  let iterations = 0;
  const MAX_LOOPS = 3;

  try {
    while (iterations < MAX_LOOPS) {
      iterations++;
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6", max_tokens: 1024,
        system: systemPrompt, tools: CHAT_TOOLS, messages,
      });

      if (response.stop_reason === "end_turn") {
        const reply = response.content.filter(b => b.type === "text").map(b => b.text).join("");
        return res.json({
          success: true, response: reply,
          toolExecutions,
          metadata: { agentLevel: agent.level, knowledgeScore: Math.round(agent.knowledge_score), chunksUsed: chunks.length, responseTimeMs: Date.now() - t0 },
        });
      }

      if (response.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: response.content });
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          const result = await executeChatTool(block.name, block.input, studentId);
          toolExecutions.push({ tool: block.name, input: block.input, result });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }
      break;
    }
  } catch (anthropicErr) {
    console.warn("[/chat] Anthropic tool loop failed, falling back to OpenAI:", anthropicErr.message);
  }

  // Fallback: original OpenAI knowledge-base response
  return handleStudentChat(req, res, studentId, message, t0);
}

async function handleStudentChat(req, res, studentId, message, t0) {
  const agent  = await getOrCreateStudentAgent(studentId);
  const chunks = await retrieveAgentKnowledge(agent.id, message, 6);
  const ctx    = chunks.length > 0
    ? chunks.map((c, i) => `[${i + 1}] (${c.chunk_type}, ${Math.round((c.confidence||0.5)*100)}%) ${c.topic}: ${c.content}`).join("\n\n")
    : "No relevant knowledge yet on this topic.";

  const res2 = await openai.chat.completions.create({
    model: "gpt-4.1-mini", temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You are ${agent.name}, an AI learning agent at level ${agent.level}.
You answer based on knowledge taught across ${agent.total_sessions} sessions.

## Your knowledge:
${ctx}

If you don't know: "I haven't been taught about that yet. Can you teach me?"
Never fabricate.`,
      },
      { role: "user", content: message },
    ],
  });

  res.json({
    success: true,
    response: res2.choices[0].message.content,
    metadata: {
      agentLevel:     agent.level,
      knowledgeScore: Math.round(agent.knowledge_score),
      chunksUsed:     chunks.length,
      responseTimeMs: Date.now() - t0,
    },
  });
}

// =============================================================
// HISTORY
// =============================================================

router.get("/history/:ownerId", async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { limit = 50, offset = 0, mode } = req.query;
    const params = mode ? [ownerId, mode, Number(limit), Number(offset)] : [ownerId, Number(limit), Number(offset)];
    const sql = mode
      ? `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
      : `SELECT id, user_message, assistant_response, metadata, mode, created_at FROM chat_history WHERE agent_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
    const result = await query(sql, params);
    res.json({ success: true, history: result.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STANDARD CHAT HELPERS
// =============================================================

async function retrieveKnowledge(agentId, question, limit = 5) {
  const embRes    = await openai.embeddings.create({ model: "text-embedding-3-small", input: question.substring(0, 8000) });
  const embedding = embRes.data[0].embedding;
  const res = await query(
    `SELECT kn.id, kn.topic, kn.content, kn.confidence, 1-(ke.embedding<=>$2) AS similarity
     FROM knowledge_nodes kn JOIN knowledge_embeddings ke ON ke.node_id=kn.id
     WHERE kn.agent_id=$1 AND kn.is_gap=false AND kn.confidence>0.3
     ORDER BY similarity DESC LIMIT $3`,
    [agentId, JSON.stringify(embedding), limit]
  );
  return res.rows;
}

async function generateStandardResponse(agentId, userMessage, knowledge) {
  const ctx      = knowledge.map(k => `[${k.topic}] (${Math.round(k.confidence*100)}%): ${k.content}`).join("\n\n");
  const agentRes = await query("SELECT name, level FROM agents WHERE id=$1", [agentId]);
  const agent    = agentRes.rows[0] || { name: "Student Agent", level: 1 };
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini", temperature: 0.7,
    messages: [
      { role: "system", content: `You are ${agent.name}, level ${agent.level}.\nAnswer ONLY from knowledge below.\nKnowledge:\n${ctx || "None yet."}` },
      { role: "user",   content: userMessage },
    ],
  });
  return {
    response:       res.choices[0].message.content,
    confidenceUsed: knowledge.length > 0 ? knowledge.reduce((s,k)=>s+k.confidence,0)/knowledge.length : 0.1,
    usedNodes:      knowledge,
  };
}

async function learnFromConversation(agentId, userMessage, assistantResponse, wasHelpful) {
  if (wasHelpful) return { learned: false };
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini", temperature: 0,
    messages: [
      { role: "system", content: `Extract knowledge. JSON: {"topic":"...","domain":"...","content":"...","confidence":0.7}` },
      { role: "user",   content: `User: "${userMessage}"\nAssistant: "${assistantResponse}"` },
    ],
  });
  const knowledge = JSON.parse(res.choices[0].message.content);
  try { const { ingestKnowledge } = await import("./learning-pipeline.js"); await ingestKnowledge(agentId, knowledge.content); }
  catch (e) { console.warn("[learn]", e.message); }
  return { learned: true, knowledge };
}

async function updateConfidence(nodes, feedback) {
  for (const node of nodes) {
    if (feedback === "helpful")   await query(`UPDATE knowledge_nodes SET confidence=LEAST(1.0,confidence+0.02),strength=LEAST(1.0,strength+0.01),usage_count=usage_count+1,last_used_at=NOW() WHERE id=$1`, [node.id]);
    if (feedback === "unhelpful") await query(`UPDATE knowledge_nodes SET confidence=GREATEST(0,confidence-0.05),decay_rate=decay_rate+0.01,usage_count=usage_count+1,last_used_at=NOW() WHERE id=$1`, [node.id]);
  }
}

async function saveChatMessage(agentId, userMessage, assistantResponse, metadata, mode) {
  const res = await query(
    `INSERT INTO chat_history (agent_id,user_message,assistant_response,metadata,mode,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id`,
    [agentId, userMessage, assistantResponse, JSON.stringify(metadata), mode]
  );
  return res.rows[0].id;
}

// =============================================================
// DB MIGRATION
// =============================================================
async function runMigration() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id UUID,
        user_message TEXT NOT NULL,
        assistant_response TEXT NOT NULL,
        metadata JSONB,
        mode TEXT DEFAULT 'standard',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_agent ON chat_history(agent_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_mode  ON chat_history(mode);
    `);
    console.log("✅ chat_history table ready");
  } catch (err) { console.error("[Chat] Migration error:", err.message); }
}
runMigration();

export default router;
