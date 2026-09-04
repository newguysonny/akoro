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
import { jsonbArray, jsonbObject } from "../../lib/jsonb.js";
import { authenticateToken } from "../auth/routes.js";
import pkg from "pg";
import { OPENAI_MODEL, openai } from "../../lib/aiModel.js";
const { Pool } = pkg;
import db from "../../db.js";

import { getOrchestrator, listAgentPairs, getAgentPairProfile } from "./agents/registry.js";
import { getAgentPreferences, saveAgentPreferences } from "./student-state.js";
import { getSyllabusContext, getSyllabusGrounding } from "./syllabus.js";
import { getPastQuestionGrounding } from "../past-questions/routes.js";
import { getCurriculumGrounding } from "../curriculum/routes.js";
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
    const subtopics  = jsonbArray(session.subtopics);
    const objectives = jsonbObject(session.objectives);

    const { data: progress } = await db.schema("edu")
      .from("session_phase_progress")
      .select("*")
      .eq("session_id", sessionId)
      .order("subtopic_idx");

    const blocks = [
      { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
    ];

    for (const prog of progress || []) {
      // One header per subtopic, carrying its objectives.
      //
      // This used to emit three blocks: the header, a "NaNa plan" strip listing
      // the four phases, and the objectives as a separate checklist. The plan
      // is machinery the learner does not act on, and the checklist was the
      // header's own progress bar written out longhand — same array, same
      // order. The header pages through them now.
      if (prog.phase === "1") {
        blocks.push({
          type: "subtopic-hdr", faded: true,
          subtopic: prog.subtopic, idx: prog.subtopic_idx,
          // The SUBTOPIC list, not this subtopic's objectives.
          //
          // It was the latter, which conflated two different lists: items came
          // from objectives[subtopic] (three entries for one step) while idx and
          // total counted subtopics (one of six). The header paged through three
          // things while claiming to be on step 4 of 6.
          items: subtopics,
          total: subtopics.length, topic, subject,
        });
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
    return [result.guideMessage || result.sargeantMessage || "Let\u2019s bring that back to the topic."];
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
  try { res.json({ success: true, ...(await getAgentPreferences(req.user.id)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/agents/preferences", async (req, res) => {
  try {
    const { agentPairId } = req.body;
    const agentId = req.user.id;   // caller's own agent — never a body-supplied id
    if (!agentPairId) return res.status(400).json({ error: "agentPairId required" });
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
    const agent     = await getOrCreateStudentAgent(req.user.id);
    const dashboard = await decayEngine.getKnowledgeDashboard(req.user.id, agent.id);
    res.json({ success: true, agentId: agent.id, dashboard });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/alerts/:studentId — unread decay notifications + subtopic alerts
router.get("/decay/alerts/:studentId", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const studentId = req.user.id;

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
      // Only dedupe by a REAL sessionId — subtopic alerts without a session
      // (session_id null) are distinct rows and must all be kept, else they
      // all collapse onto the single `null` key.
      if (a.sessionId && seenSessions.has(a.sessionId)) continue;
      if (a.sessionId) seenSessions.add(a.sessionId);
      alerts.push(a);
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
    const agent    = await getOrCreateStudentAgent(req.user.id);
    const subjects = await getAgentKnowledgeBySubject(agent.id);
    res.json({ success: true, subjects, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /decay/topics/:studentId/:subject — topics in a subject with health
router.get("/decay/topics/:studentId/:subject", async (req, res) => {
  try {
    const agent  = await getOrCreateStudentAgent(req.user.id);
    const topics = await getTopicsBySubject(agent.id, req.params.subject);
    res.json({ success: true, subject: req.params.subject, topics, agentId: agent.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const runAll = req.body?.all === true;
    if (runAll) {
      // Full scheduler across every agent — admin only.
      if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
      const result = await decayEngine.runDecayScheduler(null);
      return res.json({ success: true, ...result });
    }
    // Otherwise run decay for the authenticated caller's own agent.
    const agent       = await getOrCreateStudentAgent(req.user.id);
    const alertTopics = await decayEngine.applyDecay(agent.id);
    res.json({ success: true, agentId: agent.id, alertTopics, count: alertTopics.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STUDENT AGENT ROUTES
// =============================================================

router.get("/student/agent/:studentId", async (req, res) => {
  try { res.json({ success: true, agent: await getOrCreateStudentAgent(req.user.id) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/intelligence", async (req, res) => {
  try {
    const agent = await getOrCreateStudentAgent(req.user.id);
    const intel = await getAgentIntelligence(agent.id);
    res.json({ success: true, intelligence: intel, agent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/growth", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const agent   = await getOrCreateStudentAgent(req.user.id);
    const history = await getAgentGrowthHistory(agent.id, Number(limit));
    res.json({ success: true, agent, history });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/:studentId/knowledge", async (req, res) => {
  try {
    const { limit = 20, offset = 0, subject } = req.query;
    let q = db
      .schema("edu").from("student_knowledge")
      .select("id, topic, subject, content, source, confidence, tags, created_at")
      .eq("student_id", req.user.id)
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
    const agent = await getOrCreateStudentAgent(req.user.id);
    await saveStudentKnowledge({
      studentId: req.user.id, agentId: agent.id,
      topic, subject, content, source, tags, confidence: 0.8,
    });
    res.json({ success: true, message: "Knowledge saved" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/student/agent/:studentId/knowledge-search", async (req, res) => {
  try {
    const { q, limit = 5 } = req.query;
    if (!q) return res.status(400).json({ error: "q is required" });
    const agent  = await getOrCreateStudentAgent(req.user.id);
    const chunks = await retrieveAgentKnowledge(agent.id, q, Number(limit));
    res.json({ success: true, chunks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// =============================================================
// STANDARD CHAT
// =============================================================

router.post("/chat", async (req, res) => {
  const t0 = Date.now();
  try {
    const { agentId, message, feedback, studentId, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });
    // Student tool-chat always runs as the authenticated caller.
    if (studentId) return handleStudentChatWithTools(req, res, req.user.id, message, history, t0);
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

// ─── Persistent chat sessions ────────────────────────────────────────────────
// Per-user conversations for the Agent Chat tab, browsable + resumable from
// the sessions drawer. All routes are already behind authenticateToken.

const sessionTitleFrom = (text) => {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 48 ? clean.slice(0, 48).trimEnd() + "…" : clean;
};

// GET /sessions — the user's sessions, newest activity first.
router.get("/sessions", async (req, res) => {
  try {
    const { data, error } = await db
      .from("chat_sessions")
      .select("id, title, created_at, updated_at, last_message_at")
      .eq("user_id", req.user.id)
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    res.json({ success: true, sessions: data ?? [] });
  } catch (err) {
    console.error("[/chat/sessions GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions — create a new (empty) session.
router.post("/sessions", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .insert({ user_id: req.user.id, title })
      .select("id, title, created_at, updated_at, last_message_at")
      .single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /sessions/:id/messages — messages for one owned session.
router.get("/sessions/:id/messages", async (req, res) => {
  try {
    const { data: session } = await db
      .from("chat_sessions").select("id")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { data, error } = await db
      .from("chat_messages")
      .select("id, role, text, created_at")
      .eq("session_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    res.json({ success: true, messages: data ?? [] });
  } catch (err) {
    console.error("[/chat/sessions messages GET]", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /sessions/:id/messages — append a message and bump session activity.
router.post("/sessions/:id/messages", async (req, res) => {
  try {
    const { role, text } = req.body || {};
    if (role !== "user" && role !== "agent") return res.status(400).json({ error: "role must be user or agent" });
    if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });

    const { data: session } = await db
      .from("chat_sessions").select("id, title")
      .eq("id", req.params.id).eq("user_id", req.user.id).maybeSingle();
    if (!session) return res.status(404).json({ error: "Session not found" });

    const { data: message, error } = await db
      .from("chat_messages")
      .insert({ session_id: session.id, user_id: req.user.id, role, text: String(text) })
      .select("id, role, text, created_at")
      .single();
    if (error) throw new Error(error.message);

    // Auto-title from the first user message; always bump activity.
    const patch = { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (role === "user" && (!session.title || session.title === "New chat")) {
      patch.title = sessionTitleFrom(text);
    }
    await db.from("chat_sessions").update(patch).eq("id", session.id);

    res.status(201).json({ success: true, message, title: patch.title });
  } catch (err) {
    console.error("[/chat/sessions messages POST]", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sessions/:id — rename a session.
router.patch("/sessions/:id", async (req, res) => {
  try {
    const title = sessionTitleFrom(req.body?.title);
    const { data, error } = await db
      .from("chat_sessions")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id, title").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true, session: data });
  } catch (err) {
    console.error("[/chat/sessions PATCH]", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sessions/:id — remove a session and its messages (cascade).
router.delete("/sessions/:id", async (req, res) => {
  try {
    const { data, error } = await db
      .from("chat_sessions")
      .delete()
      .eq("id", req.params.id).eq("user_id", req.user.id)
      .select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Session not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("[/chat/sessions DELETE]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── /chat/tutor — educational AI chat with modes + attachments ──────────────
// Used by the "Agent Chat" tab in both the learner and instructor apps.
//
// body: { message, history[], agentName, role,
//         mode: "default" | "think" | "research",
//         attachments: [{ name, type, dataUrl }] }
//
// Modes:
//   default   — the classic tutor: fast, grounded in syllabus + past questions.
//   think     — a reasoning model reasons first. Its summary streams to the UI
//               as `thinking` events (rendered as a collapsible "Thought
//               process" above the answer), then the answer streams as usual.
//               Falls back gpt-4o → gpt-4o-mini when the reasoning model or the
//               Responses API surface isn't available on the key.
//   research  — a deeper pass: more syllabus refs, more past questions, a
//               structured study-guide answer and both ref sets on the reply.
//               Progress streams as `status` steps the UI can show.
//
// Attachments (any mode): images go straight to vision; text files are
// inlined into the prompt; PDFs are text-extracted — and a scanned PDF with
// no text layer is rasterised to page images for vision OCR (renderPdfToImages).
// A bad file never fails the request; it becomes a note appended to the message.

const THINK_MODEL    = process.env.OPENAI_THINK_MODEL    || "o4-mini";
const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-4o";

const MAX_FILES       = 4;
const MAX_FILE_BYTES  = 5 * 1024 * 1024;    // 5 MB per file
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;   // 12 MB per message
const DOC_TEXT_CAP    = 12_000;             // chars of extracted doc text in the prompt
const SCAN_PDF_PAGES  = 4;                  // pages rasterised when a PDF has no text layer

import { renderPdfToImages } from "./pdfRender.js";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_TYPES  = new Set(["text/plain", "text/markdown", "text/csv"]);

function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m) return null;
  try { return m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8"); }
  catch { return null; }
}

// pdf-parse's index.js runs a self-test file read when nothing requires it,
// which crashes under ESM import — import the internals directly.
async function extractPdfText(buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default || mod;
  const out = await pdfParse(buffer);
  return String(out?.text || "");
}

/* Turn the client's attachment list into { visionParts, docContext, notes }.
   visionParts are chat.completions image parts; docContext is prompt text;
   notes are human-facing "what happened to your file" lines (also appended to
   the message so the model knows what it is looking at). */
async function processAttachments(attachments = []) {
  const visionParts = [];
  const docChunks   = [];
  const notes       = [];
  let total = 0;

  for (const [i, a] of attachments.entries()) {
    const name = String(a?.name || `file-${i + 1}`);
    try {
      if (i >= MAX_FILES) { notes.push(`Only the first ${MAX_FILES} attachments were read.`); break; }
      const type = String(a?.type || "").toLowerCase();
      const buf  = dataUrlToBuffer(a?.dataUrl);
      if (!buf) { notes.push(`Couldn't read ${name}.`); continue; }
      total += buf.length;
      if (buf.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) { notes.push(`${name} was too large and was skipped.`); continue; }

      if (IMAGE_TYPES.has(type)) {
        visionParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
        notes.push(`🖼 ${name} attached.`);
        continue;
      }
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const text = await extractPdfText(buf).catch(() => "");
        if (text && text.replace(/\s+/g, "").length >= 200) {
          docChunks.push(`### Attached file: ${name}\n${text.slice(0, DOC_TEXT_CAP)}`);
          notes.push(`📄 ${name} read.`);
        } else {
          // No usable text layer → scanned pages. Render for vision OCR.
          const pages = await renderPdfToImages(buf, { maxPages: SCAN_PDF_PAGES, scale: 1.6 }).catch(() => []);
          pages.forEach((url) => visionParts.push({ type: "image_url", image_url: { url, detail: "auto" } }));
          notes.push(pages.length
            ? `🔍 ${name} has no text layer — ${pages.length} page(s) read as images.`
            : `Couldn't read ${name}.`);
        }
        continue;
      }
      if (TEXT_TYPES.has(type) || /\.(txt|md|csv)$/i.test(name)) {
        docChunks.push(`### Attached file: ${name}\n${buf.toString("utf8").slice(0, DOC_TEXT_CAP)}`);
        notes.push(`📄 ${name} read.`);
        continue;
      }
      notes.push(`${name} isn't a supported file type and was skipped.`);
    } catch {
      notes.push(`Couldn't read ${name}.`);
    }
  }
  return { visionParts, docContext: docChunks.join("\n\n"), notes };
}

const THINK_ADDENDUM = `

The learner turned on "Think" mode because this question is hard. Reason through it carefully before answering — work the steps, sanity-check the result, and fix your working if the check fails. The visible answer stays clear, step-by-step and age-appropriate.`;

const RESEARCH_ADDENDUM = `

The learner turned on "Research" mode: they want a deeper, well-organised study answer. Use ALL the provided syllabus and past-question context and structure the reply exactly as:
**The big picture** — 2–3 sentences orienting the topic.
**Step by step** — a thorough worked explanation with examples.
**How it's examined** — what the past questions show, with exam-focus tips.
**Quick recap** — 3–5 bullet takeaways.
Ground every section in the provided context; name the topics/sources you used.`;

/* chat.completions streaming → `delta` events. Returns the full text. */
async function streamChat({ send, messages, model, max_tokens = 700, temperature = 0.6 }) {
  const stream = await openai.chat.completions.create({ model, temperature, max_tokens, stream: true, messages });
  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) { full += delta; send("delta", { text: delta }); }
  }
  return full;
}

/* Convert chat.completions-style messages to Responses-API input. */
function toResponsesInput(messages) {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
      : m.content.map((p) => p.type === "image_url"
          ? { type: "input_image", image_url: p.image_url?.url, detail: p.image_url?.detail || "auto" }
          : { type: "input_text", text: p.text }),
  }));
}

/* Reasoning model via the Responses API. Reasoning summaries stream as
   `thinking` events, the answer as `delta`. Throws when the model or API
   surface is unavailable so the caller can fall back. */
async function streamThinkWithResponses({ send, messages, model }) {
  const useReasoning = model !== "gpt-4o";   // gpt-4o has no reasoning surface
  const stream = await openai.responses.create({
    model,
    input: toResponsesInput(messages),
    ...(useReasoning ? { reasoning: { effort: "medium", summary: "auto" } } : {}),
    max_output_tokens: 4000,
    stream: true,
  });
  let full = "";
  for await (const ev of stream) {
    if (ev.type === "response.reasoning_summary_text.delta" && ev.delta) send("thinking", { text: ev.delta });
    else if (ev.type === "response.output_text.delta" && ev.delta) { full += ev.delta; send("delta", { text: ev.delta }); }
    else if (ev.type === "response.failed") throw new Error(ev.response?.error?.message || "reasoning model failed");
    else if (ev.type === "error") throw new Error(ev.message || "reasoning model error");
  }
  return full;
}

/* Non-streaming reasoning call → { reply, thinking }. */
async function thinkOnce({ messages, model }) {
  const useReasoning = model !== "gpt-4o";
  const resp = await openai.responses.create({
    model,
    input: toResponsesInput(messages),
    ...(useReasoning ? { reasoning: { effort: "medium", summary: "auto" } } : {}),
    max_output_tokens: 4000,
  });
  const thinking = (Array.isArray(resp?.output) ? resp.output : [])
    .filter((o) => o?.type === "reasoning")
    .flatMap((o) => (o.summary || []).map((s) => s?.text || ""))
    .join("\n\n")
    .trim();
  return { reply: String(resp?.output_text || "").trim(), thinking };
}

router.post("/tutor", async (req, res) => {
  const t0 = Date.now();
  // Opt into token streaming with ?stream=1 (or Accept: text/event-stream).
  // The reply is delivered as Server-Sent Events so the client can render
  // tokens as they arrive instead of waiting for the whole completion.
  const wantsStream = req.query.stream === "1" || req.query.stream === "true"
    || (req.headers.accept || "").includes("text/event-stream");
  try {
    const { message, history = [], agentName, role, mode: rawMode, attachments: rawAttachments } = req.body;
    const mode = ["think", "research"].includes(rawMode) ? rawMode : "default";
    const isThink = mode === "think", isResearch = mode === "research";
    if (!message || !message.trim()) return res.status(400).json({ error: "message is required" });
    if (Array.isArray(rawAttachments) && rawAttachments.length > MAX_FILES) {
      return res.status(400).json({ error: `Too many attachments (max ${MAX_FILES}).` });
    }

    const safeHistory = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-10);

    let headersSent = false;
    const beginStream = () => {
      if (headersSent) return;
      res.writeHead(200, {
        "Content-Type":      "text/event-stream",
        "Cache-Control":     "no-cache, no-transform",
        "Connection":        "keep-alive",
        "X-Accel-Buffering": "no",   // disable proxy buffering (nginx)
      });
      res.flushHeaders?.();
      headersSent = true;
    };
    const send   = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const status = (step, label) => send("status", { step, label });
    if (wantsStream) beginStream();

    // Ground the tutor in the uploaded exam syllabus when the question relates
    // to it (semantic match; empty for off-syllabus questions). `refs` are the
    // human-facing source chips shown under the reply.
    // Ground in BOTH the syllabus (what should be taught) and the past-question
    // bank (how it is actually examined) — they answer different halves of
    // "will this be in the exam?". Teachers additionally get the CURRICULUM —
    // what a class is meant to be taught and how. Research mode digs deeper
    // into both banks, since its whole point is a thorough, sourced answer.
    const wantsCurriculum = role === "instructor";
    const sylLimit  = isResearch ? 8 : 5;
    const pastLimit = isResearch ? 5 : 3;
    if (isResearch && wantsStream) status("grounding", "Searching the syllabus and past questions…");

    const [
      { context: syllabusCtx, refs: syllabusRefs },
      { context: pastCtx, refs: pastRefs },
      { context: curriculumCtx, refs: curriculumRefs },
    ] = await Promise.all([
      getSyllabusGrounding(message.trim(), { limit: sylLimit }).catch(() => ({ context: "", refs: [] })),
      getPastQuestionGrounding(message.trim(), { limit: pastLimit }).catch(() => ({ context: "", refs: [] })),
      wantsCurriculum
        ? getCurriculumGrounding(message.trim(), { limit: 3 }).catch(() => ({ context: "", refs: [] }))
        : Promise.resolve({ context: "", refs: [] }),
    ]);

    // Attachments: images/doc-text/scanned pages, with per-file notes.
    let att = { visionParts: [], docContext: "", notes: [] };
    if (Array.isArray(rawAttachments) && rawAttachments.length) {
      if (wantsStream) status("attachments", "Reading your files…");
      att = await processAttachments(rawAttachments);
    }

    const systemContent = tutorSystemPrompt({ agentName, role }) +
      (isThink      ? THINK_ADDENDUM : "") +
      (isResearch   ? RESEARCH_ADDENDUM : "") +
      (syllabusCtx  ? `\n\n${syllabusCtx}` : "") +
      (pastCtx      ? `\n\n${pastCtx}` : "") +
      (curriculumCtx ? `\n\n${curriculumCtx}` : "") +
      (att.docContext ? `\n\n${att.docContext}` : "");

    // The attachment notes ride along with the question so the model knows
    // what each image/document is supposed to be.
    const userText = message.trim() + (att.notes.length ? `\n\n(Attachments: ${att.notes.join(" ")})` : "");
    const userContent = att.visionParts.length
      ? [{ type: "text", text: userText }, ...att.visionParts]
      : userText;
    const messages = [
      { role: "system", content: systemContent },
      ...safeHistory,
      { role: "user", content: userContent },
    ];

    if (!wantsStream) {
      let reply = "", thinking = "", usedModel = "gpt-4o-mini";
      if (isThink) {
        try { ({ reply, thinking } = await thinkOnce({ messages, model: THINK_MODEL })); usedModel = THINK_MODEL; } catch {}
        if (!reply) {
          try {
            const c = await openai.chat.completions.create({ model: "gpt-4o", temperature: 0.6, max_tokens: 1400, messages });
            reply = c.choices?.[0]?.message?.content?.trim() || ""; usedModel = "gpt-4o";
          } catch {}
        }
      } else {
        usedModel = isResearch ? RESEARCH_MODEL : "gpt-4o-mini";
        try {
          const c = await openai.chat.completions.create({
            model: usedModel, temperature: 0.6, max_tokens: isResearch ? 2200 : 700, messages,
          });
          reply = c.choices?.[0]?.message?.content?.trim() || "";
        } catch {
          if (isResearch) {
            try {
              const c = await openai.chat.completions.create({ model: "gpt-4o-mini", temperature: 0.6, max_tokens: 900, messages });
              reply = c.choices?.[0]?.message?.content?.trim() || ""; usedModel = "gpt-4o-mini";
            } catch {}
          }
        }
      }
      if (!reply) reply = "I'm here to help with your studies — ask me anything about your subjects!";
      return res.json({ success: true, reply, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, curriculum: curriculumRefs, mode, metadata: { model: usedModel, responseTimeMs: Date.now() - t0 } });
    }

    // ── Streaming path (SSE) ──────────────────────────────────────────────
    // Events: status → thinking → delta* → done | error
    let full = "", thinking = "", usedModel = "gpt-4o-mini";
    try {
      if (isThink) {
        status("thinking", "Thinking…");
        try { full = await streamThinkWithResponses({ send, messages, model: THINK_MODEL }); usedModel = THINK_MODEL; }
        catch (thinkErr) {
          console.error("[/chat/tutor think]", thinkErr?.message);
          try { full = await streamThinkWithResponses({ send, messages, model: "gpt-4o" }); usedModel = "gpt-4o"; }
          catch (gptErr) {
            console.error("[/chat/tutor think→gpt-4o]", gptErr?.message);
            full = await streamChat({ send, messages, model: "gpt-4o-mini", max_tokens: 900 });
          }
        }
      } else if (isResearch) {
        status("synthesis", "Writing it up…");
        usedModel = RESEARCH_MODEL;
        try { full = await streamChat({ send, messages, model: RESEARCH_MODEL, max_tokens: 2200 }); }
        catch (err) {
          console.error("[/chat/tutor research]", err?.message);
          usedModel = "gpt-4o-mini";
          full = await streamChat({ send, messages, model: "gpt-4o-mini", max_tokens: 900 });
        }
      } else {
        full = await streamChat({ send, messages, model: "gpt-4o-mini", max_tokens: 700 });
      }
      if (!full.trim()) full = "I'm here to help with your studies — ask me anything about your subjects!";
      send("done", { reply: full, thinking, syllabus: syllabusRefs, pastQuestions: pastRefs, mode, metadata: { model: usedModel, responseTimeMs: Date.now() - t0 } });
    } catch (streamErr) {
      console.error("[/chat/tutor stream]", streamErr);
      send("error", { error: streamErr.message });
    }
    res.end();
  } catch (err) {
    console.error("[/chat/tutor]", err);
    if (wantsStream && res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      return res.end();
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── handleStudentChatWithTools ──────────────────────────────────────────────
// Global mini-ChatGPT handler for student /chat requests.
// 1. Tries Anthropic with CHAT_TOOLS — executes up to 3 tool loops
// 2. Falls back to the original OpenAI knowledge-base response if no tools used
// The frontend receives both the reply text and a toolExecutions array for display.

async function handleStudentChatWithTools(req, res, studentId, message, history, t0) {
  const agent  = await getOrCreateStudentAgent(studentId);
  const [chunks, syllabusCtx] = await Promise.all([
    retrieveAgentKnowledge(agent.id, message, 4),
    getSyllabusContext(message, { limit: 4 }).catch(() => ""),
  ]);
  const knowledgeCtx = chunks.length > 0
    ? "\n\n## Your learning history:\n" + chunks.map((c, i) =>
        `[${i+1}] (${c.chunk_type}, ${Math.round((c.confidence||0.5)*100)}%) ${c.topic}: ${c.content}`
      ).join("\n")
    : "";

  const systemPrompt =
    `You are ${agent.name}, an AI learning agent at level ${agent.level} on Akoro Learning Platform.` +
    `\nYou have been taught across ${agent.total_sessions} sessions.` +
    knowledgeCtx +
    (syllabusCtx ? `\n\n${syllabusCtx}` : "") +
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

  // OpenAI function-calling tool schema (mapped from the Anthropic-style defs).
  const openAiTools = CHAT_TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  try {
    while (iterations < MAX_LOOPS) {
      iterations++;
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL, max_tokens: 1024,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools:    openAiTools,
      });

      const msg       = response.choices?.[0]?.message ?? { role: "assistant", content: "" };
      const toolCalls = msg.tool_calls ?? [];

      if (!toolCalls.length) {
        return res.json({
          success: true, response: msg.content ?? "",
          toolExecutions,
          metadata: { agentLevel: agent.level, knowledgeScore: Math.round(agent.knowledge_score), chunksUsed: chunks.length, responseTimeMs: Date.now() - t0 },
        });
      }

      messages.push(msg);   // assistant turn carrying tool_calls
      for (const call of toolCalls) {
        let input = {};
        try { input = JSON.parse(call.function.arguments || "{}"); } catch { input = {}; }
        const result = await executeChatTool(call.function.name, input, studentId);
        toolExecutions.push({ tool: call.function.name, input, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  } catch (llmErr) {
    console.warn("[/chat] OpenAI tool loop failed, falling back:", llmErr.message);
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
    const ownerId = req.user.id;   // token-scoped — ignore any :ownerId in the URL
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
