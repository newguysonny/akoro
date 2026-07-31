// =============================================================
// adaptive-websocket.js  v3.2
// Updated:
//   • start_session / start_student_session now accept userId
//     for ownership verification before loading trained agents
//   • agent_purchased event — pushed after successful payment
//   • list_agent_pairs now accepts userId to filter owned agents
//   • get_my_agents — returns user's full agent inventory
// =============================================================

import { getOrchestrator, listAgentPairs } from "./agents/registry.js";
import {
  clearStateCache,
  getStudentState,
  getAgentPreferences,
  userOwnsAgent,
} from "./student-state.js";
import {
  getOrCreateStudentAgent,
  getAgentKnowledgeBySubject,
  getTopicsBySubject,
} from "./agents/student/knowledge.js";
import { decayEngine } from "./agents/student/decayEngine.js";
import db from "../../db.js";

export const activeSessions = new Map();

// ── Session reap grace window ────────────────────────────────────────────────
// When a socket drops we keep its orchestrator alive briefly so a reconnecting
// client can resume the same session seamlessly. If no resume arrives within the
// grace window, the orchestrator is reaped to bound memory.
const sessionReapTimers      = new Map();   // sessionId → timeout
const SESSION_REAP_GRACE_MS  = 5 * 60 * 1000;

function cancelSessionReap(sessionId) {
  const t = sessionReapTimers.get(sessionId);
  if (t) { clearTimeout(t); sessionReapTimers.delete(sessionId); }
}

function scheduleSessionReap(sessionId) {
  cancelSessionReap(sessionId);
  const t = setTimeout(() => {
    sessionReapTimers.delete(sessionId);
    if (activeSessions.has(sessionId)) {
      activeSessions.delete(sessionId);
      console.log(`[session reap] ${sessionId} removed after ${SESSION_REAP_GRACE_MS / 1000}s grace`);
    }
  }, SESSION_REAP_GRACE_MS);
  if (t.unref) t.unref();   // don't keep the process alive for a reap timer
  sessionReapTimers.set(sessionId, t);
}

// ── adaptive_sessions persistence ────────────────────────────────────────────
// The WS flow already saves agent knowledge/stats/deltas. These helpers also
// persist the session row + typed block transcript so the Sessions list
// (GET /sessions) and "Continue Teaching" (continuation mode) work for WS
// sessions. The DB row id is stashed on the orchestrator as `dbSessionId`.
async function createSessionRecord(orchestrator, { studentId, topic, subject, openingBlocks }) {
  if (orchestrator?.dbSessionId) return orchestrator.dbSessionId;   // already saved
  try {
    const { data, error } = await db.schema("edu").from("adaptive_sessions").insert({
      student_id:             studentId,
      student_agent_id:       orchestrator.studentAgentRecord?.id || null,
      // topic + subject are NOT NULL — never let a missing value silently drop
      // the whole session row (which is what kept sessions off the list).
      topic:                  topic || "Untitled session",
      subject:                subject || "General",
      // These columns are JSONB — send real arrays/objects. Sending
      // JSON.stringify(...) stored a JSON *string* scalar ("[]") instead of an
      // array, which then read back wrong downstream.
      subtopics:              Array.isArray(orchestrator.session?.mustKnowParts) ? orchestrator.session.mustKnowParts : [],
      objectives:             {},
      current_subtopic_idx:   0,
      current_phase:          "1",
      status:                 "active",
      started_at:             new Date().toISOString(),
      updated_at:             new Date().toISOString(),
      session_history:        [],
      objectives_covered:     {},
      confidence_by_subtopic: {},
      block_history:          Array.isArray(openingBlocks) ? openingBlocks : [],
    }).select("id").single();
    if (error) throw error;
    orchestrator.dbSessionId = data.id;
    // Remember the identity so a later fallback save (cancel/disconnect before
    // the row existed) can still persist the session.
    orchestrator.sessionMeta = { studentId, topic, subject };
    return data.id;
  } catch (e) {
    // Loud: a failure here is why a session would never appear in the list.
    console.error("[adaptive_sessions create] FAILED — session will not be listed:", e.message);
    return null;
  }
}

// Ensure a DB row exists for this orchestrator — used by the cancel/disconnect
// path so a session started but never "completed" is still saved.
async function ensureSessionRecord(orchestrator) {
  if (orchestrator?.dbSessionId) return orchestrator.dbSessionId;
  const meta = orchestrator?.sessionMeta;
  if (!meta?.studentId) return null;
  return createSessionRecord(orchestrator, { ...meta, openingBlocks: [] });
}

async function appendSessionBlocks(orchestrator, newBlocks) {
  const id = orchestrator?.dbSessionId || await ensureSessionRecord(orchestrator);
  if (!id || !newBlocks?.length) return;
  try {
    const { data } = await db.schema("edu").from("adaptive_sessions")
      .select("block_history").eq("id", id).single();
    const existing = Array.isArray(data?.block_history) ? data.block_history : [];
    await db.schema("edu").from("adaptive_sessions").update({
      block_history: [...existing, ...newBlocks],
      updated_at:    new Date().toISOString(),
    }).eq("id", id);
  } catch (e) {
    console.warn("[adaptive_sessions append]", e.message);
  }
}

async function completeSessionRecord(orchestrator) {
  const id = orchestrator?.dbSessionId;
  if (!id) return;
  try {
    // Read prior status + student so ranking XP is awarded exactly once.
    const { data: prior } = await db.schema("edu").from("adaptive_sessions")
      .select("status, student_id").eq("id", id).maybeSingle();

    await db.schema("edu").from("adaptive_sessions").update({
      status:       "complete",
      completed_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }).eq("id", id);

    if (prior && prior.status !== "complete" && prior.student_id) {
      try {
        const { awardXP, XP } = await import("../ranking/routes.js");
        awardXP({ userId: prior.student_id, reason: "teaching_session", amount: XP.SESSION_ATTEND }).catch(() => {});
      } catch { /* ranking module unavailable — non-fatal */ }
    }
  } catch (e) {
    console.warn("[adaptive_sessions complete]", e.message);
  }
}

// Wire io globally so webhook can emit agent_purchased
// Call from server.js: global._io = io;

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
  if (agentPairId === "professor-warden" && engine.correctStreak > 0)
    lines.push(`  • Correct streak → ${engine.correctStreak} 🔥`);
  if (agentPairId === "student-session") {
    if (engine.agentKnowledgeAdded > 0)
      lines.push(`  • Agent knowledge added → ${engine.agentKnowledgeAdded} chunks 📚`);
    if (engine.agentLevel)
      lines.push(`  • Agent level → ${engine.agentLevel} | Score → ${engine.knowledgeScore}`);
  }
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
    lines.push(``, `🔄 Knowledge Reinforcement Result:`);
    lines.push(`  Topic: ${decayResult.subject} — ${decayResult.topicReinforced}`);
    lines.push(`  Confidence: ${Math.round(decayResult.confidenceBefore * 100)}% → ${Math.round(decayResult.confidenceAfter * 100)}%`);
    lines.push(`  Next review: ${new Date(decayResult.nextReviewDue).toLocaleDateString()}`);
  }

  if (agentGrowth) {
    lines.push(``, `🤖 Student Agent Growth:`);
    lines.push(`  • Knowledge chunks saved: ${agentGrowth.knowledgeChunksSaved}`);
    lines.push(`  • XP earned: +${agentGrowth.xpEarned}`);
    if (agentGrowth.conceptsLearned?.length > 0)
      lines.push(`  • Concepts learned: ${agentGrowth.conceptsLearned.join(", ")}`);
    lines.push(`  • Agent level: ${agentGrowth.agentLevel} | Score: ${agentGrowth.agentKnowledgeScore}`);
    if (agentGrowth.leveledUp) lines.push(`  🎊 LEVEL UP! Agent reached level ${agentGrowth.agentLevel}!`);
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

// =============================================================
// SOCKET.IO SETUP
// =============================================================
// =============================================================
// TYPED BLOCK CONVERTERS
// Maps orchestrator result → BlockRenderer-compatible typed blocks
// (same format as teachingSession.js REST endpoint)
// =============================================================

const PHASE_PLAN_WS = [
  "Phase 1 → what do they know",
  "Phase 2 → must-know parts",
  "Phase 3 → teach it back",
  "Phase 4 → push further",
];

const NANA_RENDER_STYLE = {
  bubbleBg:     "rgba(124,58,237,0.10)",
  bubbleBorder: "#7C3AED",
  labelColor:   "#7C3AED",
  ttsVoice:     "alloy",
  assessStyle:  "gentle",
};

function resultToTypedBlocks(result, agentPairId) {
  const blocks     = [];
  const guideName  = result.guideName  || "NaNa Esumai";
  const guideEmoji = result.guideEmoji || "🧠";
  const renderStyle = result.guideRenderStyle || NANA_RENDER_STYLE;
  const agentName  = result.studentAgentName || "Agent";
  const confidence = result.adaptiveEngine?.understanding ?? 0;

  // Drift / sargeant warning
  if (result.type === "drift_warning") {
    return [{
      type:  "sargeant",
      phase: "Drift warning",
      text:  result.sargeantMessage || "⚠️ Off-topic detected. Please stay focused.",
    }];
  }

  // Subtopic advance — full header sequence
  if (result.subtopicAdvanced && result.currentSubtopic) {
    blocks.push({
      type:    "subtopic-hdr",
      subtopic: result.currentSubtopic,
      idx:     result.subtopicIdx     ?? 0,
      total:   result.totalSubtopics  ?? 1,
      topic:   result.topic    ?? "",
      subject: result.subject  ?? "",
    });
    blocks.push({ type: "plan", phases: PHASE_PLAN_WS });
    if (result.subtopicObjectives?.length) {
      blocks.push({
        type:     "objectives",
        subtopic: result.currentSubtopic,
        items:    result.subtopicObjectives,
      });
    }
  }

  // Sargeant assessment gate
  if (result.wardenHolding && result.wardenHoldMessage) {
    blocks.push({
      type:        "sargeant",
      phase:       `Assessment gate — ${result.currentSubtopic || ""}`,
      text:        result.wardenHoldMessage,
      renderStyle,
    });
  }

  // Student agent response
  if (result.studentAgentResponse) {
    blocks.push({
      type:       "student-agent",
      agent:      agentName,
      emoji:      "🤖",
      phase:      `${agentName} · Phase ${result.currentPhase ?? "?"} · ${confidence}%`,
      confidence,
      text:       result.studentAgentResponse,
    });
  }

  // Guide message
  if (result.guideMessage) {
    const phase = result.phaseChanged && result.phaseLabel
      ? result.phaseLabel
      : result.currentPhase
      ? `Phase ${result.currentPhase}${result.guideIsUrgent ? " — Intervening" : ""}`
      : "Guide";
    blocks.push({
      type:        "guide",
      agent:       guideName,
      emoji:       guideEmoji,
      phase,
      text:        result.guideMessage,
      renderStyle,
    });
  }

  // Sargeant assessment result
  if (result.assessmentResult) {
    const confPct = Math.round((result.assessmentResult.score ?? 0.7) * 100);
    blocks.push({
      type:         "assess-result",
      subtopic:     result.currentSubtopic,
      agentName,
      confidence:   confPct,
      passed:       result.assessmentResult.passed ?? confPct >= 70,
      nextSubtopic: result.nextSubtopic ?? null,
      renderStyle,
    });
  }

  // Session complete
  if (result.sessionComplete || result.currentPhase === "complete") {
    blocks.push({
      type:    "session-complete",
      text:    `${agentName} has completed the session on ${result.topic || "this topic"}. +${result.turnXP ?? 0} XP earned.`,
      isDecay: result.sessionType === "decay_review",
    });
  }

  return blocks;
}

export function setupWebSocket(io) {

  // Wire decay engine + global io for webhook emits
  decayEngine.setWsManager(io);
  global._io = io;

  // Events that act on a specific user's data. They require an authenticated
  // socket (socket.data.user, set by the io.use() JWT middleware in app.js),
  // and the client-supplied studentId/userId are OVERWRITTEN with the token
  // identity — a client can never start/read/drive a session as someone else.
  const IDENTITY_EVENTS = new Set([
    "list_agent_pairs", "get_my_agents",
    "start_session", "start_student_session", "start_decay_session", "start_adaptive_session",
    "teacher_message", "request_summary", "resume_session", "end_session",
    "switch_agent_pair", "get_knowledge_health", "get_subject_topics",
    "acknowledge_alert", "get_state", "get_agent_growth",
    "subscribe-student", "join-student-room",
  ]);

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.use((packet, next) => {
      const [event, payload] = packet;
      if (IDENTITY_EVENTS.has(event)) {
        const u = socket.data.user;
        if (!u) { socket.emit("error", { message: "Sign in required." }); return; } // drop the packet
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          payload.userId = u.id;
          if ("studentId" in payload || /^(start_student_session|start_decay_session|start_adaptive_session|get_knowledge_health|get_subject_topics|get_agent_growth)$/.test(event)) {
            payload.studentId = u.id;
          }
        }
      }
      next();
    });

    // ── subscribe-student / join-student-room ─────────────────
    // Joins the student room so out-of-session pushes (e.g.
    // agent_purchased after a marketplace payment) reach this socket
    // even when no teaching session is active. Identity comes from the
    // token — the payload id is ignored.
    const joinStudentRoom = () => {
      const u = socket.data.user;
      if (u) {
        socket.join(`student:${u.id}`);
        // Also join the generic user room so notifyUser() pushes (bell
        // notifications: purchases, payouts, reviews, class alerts…) arrive live.
        socket.join(`user:${u.id}`);
      }
    };
    socket.on("subscribe-student",  joinStudentRoom);
    socket.on("join-student-room",  joinStudentRoom);

    // ── list_agent_pairs ──────────────────────────────────────
    // v3.2: accepts userId to return only owned agents
    socket.on("list_agent_pairs", async ({ userId } = {}) => {
      try {
        const pairs = await listAgentPairs(userId || null);
        socket.emit("agent_pairs_list", { pairs });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── get_my_agents ─────────────────────────────────────────
    // NEW v3.2 — returns user's full agent inventory
    socket.on("get_my_agents", async ({ userId }) => {
      if (!userId) return socket.emit("error", { message: "userId required" });
      try {
        const prefs = await getAgentPreferences(userId);
        const pairs = await listAgentPairs(userId);
        socket.emit("my_agents_data", {
          userId,
          defaultPairId:   prefs.guide_pair_id,
          activeAgentId:   prefs.active_agent_id,
          purchasedAgents: prefs.purchased_agents,
          availablePairs:  prefs.available_pairs,
          pairs,
        });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── start_session ─────────────────────────────────────────
    // v3.2: accepts userId for ownership check
    socket.on("start_session", async ({ agentId, topic, agentPairId, sessionId, userId }) => {
      if (!agentId || !topic) return socket.emit("error", { message: "agentId and topic required" });
      try {
        let pairId = agentPairId;
        if (!pairId) {
          const prefs = await getAgentPreferences(userId || agentId);
          pairId = prefs.guide_pair_id || "nana-sargeant";
        }

        const id = sessionId || `session_${agentId}_${Date.now()}`;
        const orchestrator = await getOrchestrator({
          agentPairId: pairId,
          agentId,
          userId: userId || agentId,   // v3.2 ownership check
        });
        const init = await orchestrator.initialize(agentId, topic);

        activeSessions.set(id, orchestrator);
        socket.join(`session:${id}`);
        if (userId) socket.join(`user:${userId}`);
        socket.data = { ...socket.data, sessionId: id, agentId, agentPairId: pairId, userId, mode: "teaching" };

        socket.emit("session_ready", {
          sessionId: id, agentPairId: pairId,
          message: init.openingPrompt, mustKnowParts: init.mustKnowParts,
          topicBoundary: init.topicBoundary, studentAgentName: init.studentAgentName,
          initialState: init.initialState, teacherName: init.teacherName || null,
          lecturePlan: init.lecturePlan || null,
        });
      } catch (err) { console.error("[start_session]", err); socket.emit("error", { message: err.message }); }
    });

    // ── start_student_session ─────────────────────────────────
    // v3.2: userId used for ownership check on teacherAgentId
    socket.on("start_student_session", async ({ studentId, topic, teacherAgentId, userId }) => {
      if (!studentId || !topic) return socket.emit("error", { message: "studentId and topic required" });
      try {
        const caller = userId || studentId;
        const id = `student_${studentId}_${Date.now()}`;
        const orchestrator = await getOrchestrator({
          mode: "student", studentId,
          teacherAgentId: teacherAgentId || null,
          userId: caller,
        });
        const init = await orchestrator.initialize(studentId, topic);

        activeSessions.set(id, orchestrator);
        socket.join(`session:${id}`);
        socket.join(`student:${studentId}`);
        if (userId) socket.join(`user:${userId}`);
        socket.data = { ...socket.data, sessionId: id, agentId: studentId, agentPairId: "student-session", userId: caller, mode: "student" };

        socket.emit("student_session_ready", {
          sessionId: id, agentPairId: "student-session",
          sessionType: "free_teaching",
          message: init.openingPrompt, mustKnowParts: init.mustKnowParts,
          topicBoundary: init.topicBoundary, studentAgentName: init.studentAgentName,
          agentLevel: init.agentLevel, totalSessions: init.totalSessions,
          knowledgeScore: init.knowledgeScore, initialState: init.initialState,
        });
      } catch (err) { console.error("[start_student_session]", err); socket.emit("error", { message: err.message }); }
    });

    // ── start_decay_session ───────────────────────────────────
    socket.on("start_decay_session", async ({ studentId, subject, topic, teacherAgentId, notificationId, userId }) => {
      if (!studentId || !subject || !topic)
        return socket.emit("error", { message: "studentId, subject and topic required" });
      try {
        const caller = userId || studentId;
        const agent  = await getOrCreateStudentAgent(studentId);
        const decaySessionPayload = await decayEngine.generateDecaySession(agent.id, studentId, subject, topic);

        if (notificationId) await decayEngine.markNotificationRead(notificationId);

        const id = `decay_${studentId}_${Date.now()}`;
        const orchestrator = await getOrchestrator({
          mode: "student", studentId,
          teacherAgentId: teacherAgentId || null,
          userId: caller,
          sessionType: "decay_review",
          decayPayload: { ...decaySessionPayload, notificationId },
        });
        const init = await orchestrator.initialize(studentId, topic);

        activeSessions.set(id, orchestrator);
        socket.join(`session:${id}`);
        socket.join(`student:${studentId}`);
        if (userId) socket.join(`user:${userId}`);
        socket.data = { ...socket.data, sessionId: id, agentId: studentId, agentPairId: "student-session", userId: caller, mode: "decay_review" };

        socket.emit("student_session_ready", {
          sessionId: id, agentPairId: "student-session",
          sessionType: "decay_review", subject, topic,
          message: init.openingPrompt, mustKnowParts: init.mustKnowParts,
          topicBoundary: init.topicBoundary, studentAgentName: init.studentAgentName,
          agentLevel: init.agentLevel, knowledgeScore: init.knowledgeScore,
          initialState: init.initialState, decayPayload: decaySessionPayload,
        });
      } catch (err) { console.error("[start_decay_session]", err); socket.emit("error", { message: err.message }); }
    });

    // ══════════════════════════════════════════════════════════
    // start_adaptive_session — UNIFIED handler for all 3 modes
    // mode: "fresh" | "continuation" | "decay"
    //
    // fresh       — no history, agent starts blank
    // continuation— loads block_history from DB, agent resumes
    // decay       — loads decay context, agent is re-taught
    //
    // All three use the same teacher_message event after this.
    // ══════════════════════════════════════════════════════════
    socket.on("start_adaptive_session", async ({
      studentId, topic, subject,
      mode = "fresh",
      sessionId: prevSessionId,   // for continuation
      notificationId,             // for decay
      userId,
    }) => {
      if (!studentId || !topic)
        return socket.emit("error", { message: "studentId and topic required" });

      try {
        const caller     = userId || studentId;
        let historyBlocks = [];
        let decayPayload  = null;
        let sessionType   = "free_teaching";

        // ── Continuation: load block history from DB ─────────
        if (mode === "continuation" && prevSessionId) {
          sessionType = "continuation";
          try {
            const { data: prevSession } = await db.schema("edu")
              .from("adaptive_sessions")
              .select("block_history, updated_at, completed_at")
              .eq("id", prevSessionId)
              .single();

            if (prevSession?.block_history?.length) {
              const completedAt = prevSession.completed_at || prevSession.updated_at;
              const daysSince   = Math.max(0, Math.round(
                (Date.now() - new Date(completedAt).getTime()) / 86_400_000
              ));
              historyBlocks = [
                { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
                ...prevSession.block_history.map(b => ({ ...b, faded: true })),
              ];
            }
          } catch (e) {
            console.warn("[start_adaptive_session] history load failed:", e.message);
          }
        }

        // ── Decay: load decay context ─────────────────────────
        if (mode === "decay") {
          sessionType = "decay_review";
          const agent = await getOrCreateStudentAgent(studentId);
          decayPayload = await decayEngine.generateDecaySession(agent.id, studentId, subject, topic);
          if (notificationId) await decayEngine.markNotificationRead(notificationId);
        }

        // ── Create orchestrator with mode-aware context ───────
        const orchestrator = await getOrchestrator({
          mode:                 "student",
          studentId,
          userId:               caller,
          sessionType,
          subject,
          continuationSessionId: mode === "continuation" ? prevSessionId : null,
          decayPayload,
          // Prompt context injected here — orchestrator uses this to
          // set agent's opening knowledge state
          agentContext: {
            mode,
            historyLoaded:    historyBlocks.length > 0,
            previousSessionId: prevSessionId ?? null,
          },
        });

        const init = await orchestrator.initialize(studentId, topic);
        const id   = `${mode}_${studentId}_${Date.now()}`;

        activeSessions.set(id, orchestrator);
        socket.join(`session:${id}`);
        socket.join(`student:${studentId}`);
        if (userId) socket.join(`user:${userId}`);
        socket.data = {
          ...socket.data,
          sessionId: id, agentId: studentId,
          agentPairId: "student-session",
          userId: caller, mode,
          topic, subject,                  // preserved for mid-session agent switch
        };

        // Single unified response event — emit immediately, don't gate on DB write
        socket.emit("session_ready", {
          sessionId:         id,
          mode,
          sessionType,
          topic,             subject,
          message:           init.openingPrompt,
          openingBlocks:     init.openingBlocks,
          mustKnowParts:     init.mustKnowParts,
          agentLevel:        init.agentLevel,
          knowledgeScore:    init.knowledgeScore,
          initialState:      init.initialState,
          decayPayload,
          historyBlocks,
          guideProfile: {
            name:        orchestrator.guideOrchestrator?.guide?.name  || "NaNa Esumai",
            emoji:       orchestrator.guideOrchestrator?.guide?.emoji || "🧠",
            renderStyle: orchestrator.guideOrchestrator?.guide?.renderStyle || null,
            ttsVoice:    orchestrator.guideOrchestrator?.guide?.renderStyle?.ttsVoice || "alloy",
          },
        });

        // Stash identity FIRST so the cancel/disconnect path can still save the
        // session even if this initial insert fails or hasn't finished yet.
        orchestrator.sessionMeta = { studentId, topic, subject };

        // Persist in background — never blocks the session
        createSessionRecord(orchestrator, {
          studentId, topic, subject, openingBlocks: init.openingBlocks,
        }).catch(e => console.warn("[createSessionRecord]", e.message));

      } catch (err) {
        console.error("[start_adaptive_session]", err);
        socket.emit("error", { message: err.message });
      }
    });

    // ── teacher_message (all session types) ──────────────────
    socket.on("teacher_message", async ({ message }) => {
      const { sessionId, agentPairId } = socket.data;
      const orchestrator = activeSessions.get(sessionId);
      if (!orchestrator) return socket.emit("error", { message: "No active session." });

      try {
        socket.emit("typing_start");
        socket.emit("student_typing", { typing: true });

        const result = await orchestrator.processTeachingMessage(message, {
          onStudentChunk: (token) => socket.emit("student_token",  { token }),
          onStateUpdate:  (state) => socket.emit("state_update",   state),
          onGuideChunk:   (token) => socket.emit("guide_token",    { token }),
        });

        socket.emit("student_done");
        socket.emit("guide_done");

        // Convert result to typed blocks (BlockRenderer-compatible)
        const blocks = resultToTypedBlocks(result, agentPairId);

        socket.emit("turn_complete", {
          type:           result.type === "drift_warning" ? "drift_warning" : "teaching_response",
          blocks,
          currentPhase:   result.currentPhase,
          currentSubtopic: result.currentSubtopic,
          agentPairId,
          turnXP:         result.turnXP || 0,
          sessionType:    result.sessionType,
        });

        // Persist the turn (human message + response blocks) to the transcript.
        appendSessionBlocks(orchestrator, [{ type: "user", text: message }, ...blocks]);
      } catch (err) {
        console.error("[teacher_message]", err);
        socket.emit("student_done"); socket.emit("guide_done");
        socket.emit("error", { message: err.message });
      }
    });

    // ── request_summary ───────────────────────────────────────
    // Read-only mid/end-of-session summary. Does not end the session, so the
    // user can keep teaching afterwards. Replaces the old REST /teaching/summary.
    socket.on("request_summary", async () => {
      const { sessionId } = socket.data;
      const orchestrator = activeSessions.get(sessionId);
      if (!orchestrator) return socket.emit("error", { message: "No active session." });
      try {
        const summary = await orchestrator.generateSummary();
        socket.emit("session_summary", { summary });
      } catch (err) {
        console.error("[request_summary]", err);
        socket.emit("summary_error", { message: err.message });
      }
    });

    // ── resume_session ────────────────────────────────────────
    // Seamless reconnect: re-bind this fresh socket to an orchestrator that
    // survived a transient drop. If the orchestrator is gone (server restart,
    // landed on another instance, or grace window expired) the client is told
    // to start fresh instead.
    socket.on("resume_session", ({ sessionId, studentId, userId } = {}) => {
      const orchestrator = sessionId ? activeSessions.get(sessionId) : null;
      if (!orchestrator) return socket.emit("resume_failed", { sessionId: sessionId || null });

      // Ownership: only the user who started the session may resume it.
      const me = socket.data.user?.id;
      const owner = orchestrator.userId || orchestrator.studentId;
      if (owner && me && owner !== me) return socket.emit("resume_failed", { sessionId });

      cancelSessionReap(sessionId);

      const caller = userId || studentId || orchestrator.studentId;
      socket.join(`session:${sessionId}`);
      if (studentId || orchestrator.studentId) socket.join(`student:${studentId || orchestrator.studentId}`);
      if (caller) socket.join(`user:${caller}`);

      socket.data = {
        ...socket.data,
        sessionId,
        agentId:     studentId || orchestrator.studentId,
        agentPairId: "student-session",
        userId:      caller,
        mode:        orchestrator.sessionType === "decay_review" ? "decay" : (socket.data?.mode || "fresh"),
        topic:       orchestrator.session?.topic,
        subject:     orchestrator.subject,
      };

      socket.emit("session_resumed", {
        sessionId,
        currentPhase: orchestrator.session?.phase   || null,
        currentSubtopic: orchestrator.session?.mustKnowParts?.[orchestrator.session?.mustKnowIndex] || null,
        topic:        orchestrator.session?.topic   || null,
        subject:      orchestrator.subject          || null,
      });
    });

    // ── end_session ───────────────────────────────────────────
    socket.on("end_session", async () => {
      const { sessionId, agentId, agentPairId } = socket.data;
      const orchestrator = activeSessions.get(sessionId);
      if (sessionId) cancelSessionReap(sessionId);
      if (!orchestrator) return socket.emit("error", { message: "No active session." });
      try {
        const endResult = await orchestrator.endSession();
        const formatted = fmtSessionEnd(endResult);
        await completeSessionRecord(orchestrator);   // mark the session row complete
        activeSessions.delete(sessionId);
        await clearStateCache(agentId);
        socket.emit("session_ended", {
          message: formatted, summary: endResult, agentPairId,
          agentGrowth:  endResult.agentGrowth  || null,
          decayResult:  endResult.decayResult  || null,
          sessionType:  endResult.sessionType  || "free_teaching",
        });
      } catch (err) { console.error("[end_session]", err); socket.emit("error", { message: err.message }); }
    });

    // ── switch_agent_pair ─────────────────────────────────────
    // v3.2: verifies ownership, then rebuilds the live session with the new
    // teacher guide — same student + topic, same sessionId (socket room intact).
    // The student agent's learned state is keyed by studentId, so its knowledge
    // carries over; only the guiding teacher changes.
    socket.on("switch_agent_pair", async ({ newAgentPairId, topic: topicArg, userId }) => {
      try {
        const data      = socket.data || {};
        const sessionId = data.sessionId;
        const studentId = data.agentId;
        const subject   = data.subject;
        const topic     = topicArg || data.topic;
        const caller    = userId || data.userId || studentId;

        if (!sessionId || !studentId)
          return socket.emit("error", { message: "No active session to switch." });
        if (!newAgentPairId)
          return socket.emit("error", { message: "newAgentPairId required" });
        if (!topic)
          return socket.emit("error", { message: "Session topic unavailable for switch." });

        // Resolve the teacher agent the new pair maps to (null = platform default)
        let teacherAgentId = null;
        if (newAgentPairId.startsWith("trained:")) {
          teacherAgentId = newAgentPairId.replace("trained:", "");
          const owns = await userOwnsAgent(caller, teacherAgentId);
          if (!owns) {
            return socket.emit("error", {
              message: "You do not own this agent. Purchase it from the marketplace first.",
              code:    "NOT_PURCHASED",
              agentPairId: newAgentPairId,
            });
          }
        }

        socket.emit("agent_pair_switching", { newAgentPairId });

        // Rebuild the orchestrator with the new teacher; reuse student + topic
        const orchestrator = await getOrchestrator({
          mode:     "student",
          studentId,
          userId:   caller,
          teacherAgentId,
        });
        const init = await orchestrator.initialize(studentId, topic);

        // Swap in place under the same sessionId so the socket room stays valid
        activeSessions.set(sessionId, orchestrator);
        socket.data = { ...socket.data, agentPairId: newAgentPairId, teacherAgentId };

        socket.emit("agent_pair_switched", {
          sessionId,
          agentPairId:      newAgentPairId,
          topic,            subject,
          message:          init.openingPrompt,
          mustKnowParts:    init.mustKnowParts,
          agentLevel:       init.agentLevel,
          knowledgeScore:   init.knowledgeScore,
          initialState:     init.initialState,
          studentAgentName: init.studentAgentName,
          guideProfile: {
            name:        orchestrator.guideOrchestrator?.guide?.name  || "NaNa Esumai",
            emoji:       orchestrator.guideOrchestrator?.guide?.emoji || "🧠",
            renderStyle: orchestrator.guideOrchestrator?.guide?.renderStyle || null,
            ttsVoice:    orchestrator.guideOrchestrator?.guide?.renderStyle?.ttsVoice || "alloy",
          },
        });
      } catch (err) {
        console.error("[switch_agent_pair]", err);
        socket.emit("error", { message: err.message });
      }
    });

    // ── get_knowledge_health ──────────────────────────────────
    socket.on("get_knowledge_health", async ({ studentId }) => {
      try {
        const agent     = await getOrCreateStudentAgent(studentId);
        const dashboard = await decayEngine.getKnowledgeDashboard(studentId, agent.id);
        socket.emit("knowledge_health_data", { dashboard, agentId: agent.id });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── get_subject_topics ────────────────────────────────────
    socket.on("get_subject_topics", async ({ studentId, subject }) => {
      try {
        const agent  = await getOrCreateStudentAgent(studentId);
        const topics = await getTopicsBySubject(agent.id, subject);
        socket.emit("subject_topics_data", { subject, topics, agentId: agent.id });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── acknowledge_alert ─────────────────────────────────────
    socket.on("acknowledge_alert", async ({ notificationId }) => {
      try {
        await decayEngine.markNotificationRead(notificationId);
        socket.emit("alert_acknowledged", { notificationId });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── get_state ─────────────────────────────────────────────
    socket.on("get_state", async () => {
      const { sessionId } = socket.data;
      const orchestrator  = activeSessions.get(sessionId);
      if (!orchestrator) return socket.emit("error", { message: "No active session." });
      try {
        const agentId = orchestrator.session?.agentId || orchestrator.studentId;
        const state   = await getStudentState(agentId);
        socket.emit("state_snapshot", { state });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── get_agent_growth ──────────────────────────────────────
    socket.on("get_agent_growth", async ({ studentId }) => {
      try {
        const { getAgentGrowthHistory } = await import("./agents/student/knowledge.js");
        const agent   = await getOrCreateStudentAgent(studentId);
        const history = await getAgentGrowthHistory(agent.id, 20);
        socket.emit("agent_growth_data", { agent, history });
      } catch (err) { socket.emit("error", { message: err.message }); }
    });

    // ── disconnect ────────────────────────────────────────────
    socket.on("disconnect", () => {
      const sid = socket.data?.sessionId;
      // A cancelled/closed session must still be saved: make sure the DB row
      // exists (it stays `active`, so it lists as resumable) before we let the
      // in-memory orchestrator go.
      if (sid && activeSessions.has(sid)) {
        ensureSessionRecord(activeSessions.get(sid))
          .catch(e => console.warn("[adaptive_sessions persist-on-cancel]", e.message));
        // Keep the orchestrator alive through a grace window so a reconnecting
        // client can resume it; reap it if no resume arrives.
        scheduleSessionReap(sid);
      }
      console.log(`🔌 Disconnected: ${socket.id} (session: ${sid || "none"})`);
    });
  });
}
