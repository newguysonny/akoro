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
import { resolveLadder, provenanceLabel } from "./lessonLadder.js";
import { NaNaEsumai } from "./agents/nana-esumai/guide.js";
import { normalizeSessionReference } from "./sessionReference.js";
import { serialiseTeachingEvidence } from "./teaching-evidence.js";
import db from "../../db.js";

export const activeSessions = new Map();

// Rolling deploys can briefly run this code against a database that has not
// received the compact-evidence migration yet. Retry without the optional
// column so normal teaching/session persistence remains available; never fall
// back to storing transcript text as evidence.
function isMissingColumn(error, column) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" ||
    (message.includes(column.toLowerCase()) && /column|schema cache|could not find/i.test(message));
}

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

// How much of a prior transcript a new session row carries forward. Without
// the carry, a continuation's row held only its OWN turns — continue once and
// you saw the previous lesson faded; continue AGAIN and the first lesson was
// gone. The tail is kept (newest blocks always included) so chains stay
// bounded no matter how many times a learner continues.
const CARRY_BLOCK_CAP = 80;
function carryForward(priorBlocks, openingBlocks) {
  if (!Array.isArray(priorBlocks) || !priorBlocks.length) return openingBlocks;
  const carry = priorBlocks
    .filter(b => b && typeof b === "object" && b.type !== "system-divider")
    .map(b => ({ ...b, faded: true }));
  return [...carry.slice(-CARRY_BLOCK_CAP), ...openingBlocks];
}

async function createSessionRecord(orchestrator, { studentId, topic, subject, openingBlocks }) {
  if (orchestrator?.dbSessionId) return orchestrator.dbSessionId;   // already saved
  const row = {
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
    // Compact scores/categories only. The conversation itself remains in the
    // existing transcript column, never duplicated as assessment evidence.
    teaching_evidence:      serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
    block_history:          Array.isArray(openingBlocks) ? openingBlocks : [],
  };

  try {
    let insertRow = row;
    let { data, error } = await db.schema("edu").from("adaptive_sessions")
      .insert(insertRow).select("id").single();

    // The new field is intentionally optional during a rolling migration.
    if (error && isMissingColumn(error, "teaching_evidence")) {
      console.warn("[adaptive_sessions create] teaching_evidence migration pending; saving without it");
      const { teaching_evidence: _evidence, ...legacyRow } = row;
      insertRow = legacyRow;
      ({ data, error } = await db.schema("edu").from("adaptive_sessions")
        .insert(insertRow).select("id").single());
    }

    // The session row is what makes a session visible in the Sessions tab, so
    // never let one optional column take the whole row down with it.
    // student_agent_id is a decoration; student_id/topic/subject are the row.
    // (Its FK pointed at public.user_agents while we write edu.student_agents
    // ids — that silently killed EVERY insert.)
    if (error && insertRow.student_agent_id) {
      console.warn("[adaptive_sessions create] retrying without student_agent_id:", error.message);
      ({ data, error } = await db.schema("edu").from("adaptive_sessions")
        .insert({ ...insertRow, student_agent_id: null }).select("id").single());
    }
    if (error) throw error;
    orchestrator.dbSessionId = data.id;
    // Remember the identity so a later fallback save (cancel/disconnect before
    // the row existed) can still persist the session.
    orchestrator.sessionMeta = { studentId, topic, subject };
    return data.id;
  } catch (e) {
    // Loud: a failure here is why a session would never appear in the list.
    console.error("[adaptive_sessions create] FAILED — session will not be listed:",
      e.code || "", e.message, e.details || "");
    orchestrator.saveError = { message: e.message, code: e.code || null };
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

    // WHERE THEY GOT TO, not just what was said.
    //
    // current_phase and current_subtopic_idx were written once at creation as
    // "1" and 0 and never touched again, so the stored row always claimed the
    // learner was on the first phase of the first subtopic no matter how far
    // they had come. Continuing a session read that back and restarted them at
    // the beginning — the transcript was there, the progress was not.
    //
    // subtopics is refreshed too: the ladder is resolved after the row is
    // created, so the row was written with whatever was known at insert time,
    // which for a resolved-later ladder is an empty array.
    const sess = orchestrator?.session ?? {};
    const update = {
      block_history:        [...existing, ...newBlocks],
      current_phase:        String(sess.phase ?? "1").replace(/^PHASE_/, ""),
      current_subtopic_idx: Number.isInteger(sess.mustKnowIndex) ? sess.mustKnowIndex : 0,
      ...(Array.isArray(sess.mustKnowParts) && sess.mustKnowParts.length
        ? { subtopics: sess.mustKnowParts }
        : {}),
      teaching_evidence: serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
      updated_at:           new Date().toISOString(),
    };
    let { error } = await db.schema("edu").from("adaptive_sessions").update(update).eq("id", id);
    if (error && isMissingColumn(error, "teaching_evidence")) {
      const { teaching_evidence: _evidence, ...legacyUpdate } = update;
      ({ error } = await db.schema("edu").from("adaptive_sessions").update(legacyUpdate).eq("id", id));
    }
    if (error) throw error;
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
      .select("status, student_id, subject").eq("id", id).maybeSingle();

    const completion = {
      status:       "complete",
      completed_at: new Date().toISOString(),
      teaching_evidence: serialiseTeachingEvidence(orchestrator?.teachingEvidence) || {},
      updated_at:   new Date().toISOString(),
    };
    let { error } = await db.schema("edu").from("adaptive_sessions").update(completion).eq("id", id);
    if (error && isMissingColumn(error, "teaching_evidence")) {
      const { teaching_evidence: _evidence, ...legacyCompletion } = completion;
      ({ error } = await db.schema("edu").from("adaptive_sessions").update(legacyCompletion).eq("id", id));
    }
    if (error) throw error;

    if (prior && prior.status !== "complete" && prior.student_id) {
      try {
        const { awardXP, XP } = await import("../ranking/routes.js");
        awardXP({ userId: prior.student_id, reason: "teaching_session", amount: XP.SESSION_ATTEND, subject: prior.subject || null }).catch(() => {});
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
  // These labels are already shaped by the server-side evidence workflow.
  // They are safe learner-facing direction, not raw evaluation values.
  const learningState = result.publicLearningState || {};

  // No drift block. A wandering learner is steered inside NaNa's own tip now,
  // as part of a turn that still teaches — rather than by a red alarm from a
  // second agent that replaced the whole turn with a scolding. Sargeant still
  // appears below for the assessment gate, which is a different job.

  const advancedObjectiveHeader = result.subtopicAdvanced && result.currentSubtopic
    ? {
        type:    "subtopic-hdr",
        subtopic: result.currentSubtopic,
        idx:     result.subtopicIdx     ?? 0,
        items:   result.subtopicObjectives ?? [],
        total:   result.totalSubtopics  ?? 1,
        topic:   result.topic    ?? "",
        subject: result.subject  ?? "",
      }
    : null;

  // Sargeant assessment gate
  if (result.wardenHolding && result.wardenHoldMessage) {
    blocks.push({
      type:        "sargeant",
      phase:       `Assessment gate — ${result.currentSubtopic || ""}`,
      text:        result.wardenHoldMessage,
      renderStyle,
    });
  }

  // Student Agent response. The current idea and short explanation of the
  // prompt's purpose are deterministic server-owned UI copy—never an inferred
  // browser state and never a claim that the agent has mastered the concept.
  if (result.studentAgentResponse) {
    blocks.push({
      type:            "student-agent",
      agent:           agentName,
      emoji:           "🤖",
      currentIdea:     learningState.currentIdea || null,
      whyThisResponse: learningState.whyThisResponse || null,
      text:            result.studentAgentResponse,
    });
  }

  // Teaching Guide response. A short evidence status and next learning move
  // replace the internal phase label; private scores and evaluator rationale
  // stay on the server.
  if (result.guideMessage) {
    blocks.push({
      type:             "guide",
      agent:            guideName,
      emoji:            guideEmoji,
      learningState:    learningState.learningState || null,
      nextLearningMove: learningState.nextLearningMove || null,
      text:             result.guideMessage,
      renderStyle,
    });
  }

  // When this turn unlocks a new objective, introduce it only after the
  // responses about the just-completed idea. This keeps each response context
  // truthful and leaves the familiar objective tracker ready for the next turn.
  if (advancedObjectiveHeader) blocks.push(advancedObjectiveHeader);

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
    socket.on("start_session", async ({ agentId, topic, agentPairId, userId }) => {
      if (!agentId || !topic) return socket.emit("error", { message: "agentId and topic required" });
      try {
        let pairId = agentPairId;
        if (!pairId) {
          const prefs = await getAgentPreferences(userId || agentId);
          pairId = prefs.guide_pair_id || "nana-sargeant";
        }

        // A fresh session id is server-generated. Accepting an arbitrary id here
        // could overwrite another live entry in the in-memory session map.
        const id = `session_${agentId}_${Date.now()}`;
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
        // A client may send an arbitrary notification UUID. Retain it for the
        // session only when it belongs to this authenticated learner.
        const ownedNotificationId = notificationId && await decayEngine.markNotificationRead(notificationId, studentId)
          ? notificationId
          : null;

        const id = `decay_${studentId}_${Date.now()}`;
        const orchestrator = await getOrchestrator({
          mode: "student", studentId,
          teacherAgentId: teacherAgentId || null,
          userId: caller,
          sessionType: "decay_review",
          decayPayload: { ...decaySessionPayload, notificationId: ownedNotificationId },
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
          initialState: init.initialState,
          decayPayload: decaySessionPayload,
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
      reference,                  // compact text returned by /teaching/reference
      userId,
    }) => {
      if (!studentId || !topic)
        return socket.emit("error", { message: "studentId and topic required" });

      // Immediate ack so the client can paint the session shell (topic, guide,
      // "preparing your lesson…") instead of staring at a blank screen while we
      // resolve the ladder and build the opening. Purely additive — clients that
      // don't listen for it are unaffected.
      socket.emit("session_preparing", { topic, subject: subject || null, mode });

      try {
        const caller     = userId || studentId;
        // Socket payloads are client-controlled. Only retain the capped,
        // text-only reference produced by the authenticated upload endpoint.
        const sessionReference = normalizeSessionReference(reference);
        let historyBlocks = [];
        let decayPayload  = null;
        let sessionType   = "free_teaching";
        let resumeFrom    = null;
        let resumeTeachingEvidence = null;
        let ownedNotificationId = null;
        // The previous conversation, restored as agent memory (continuation)
        // or as review context (decay). UI chrome is filtered out by the
        // mapper/orchestrator; only the spoken turns become context.
        let priorBlocks   = [];

        // ── Continuation: load block history from DB ─────────
        if (mode === "continuation" && prevSessionId) {
          sessionType = "continuation";
          try {
            // The continuation id comes from the browser, so ownership belongs
            // in this query rather than in client-side navigation state.
            let { data: prevSession, error: continuationError } = await db.schema("edu")
              .from("adaptive_sessions")
              .select("block_history, updated_at, completed_at, current_subtopic_idx, current_phase, teaching_evidence")
              .eq("id", prevSessionId)
              .eq("student_id", studentId)
              .maybeSingle();
            // Compatibility with API/schema caches while the migration rolls
            // out. This does not weaken ownership filtering.
            if (continuationError && isMissingColumn(continuationError, "teaching_evidence")) {
              ({ data: prevSession, error: continuationError } = await db.schema("edu")
                .from("adaptive_sessions")
                .select("block_history, updated_at, completed_at, current_subtopic_idx, current_phase")
                .eq("id", prevSessionId)
                .eq("student_id", studentId)
                .maybeSingle());
            }
            if (continuationError) throw continuationError;

            // The position, not just the transcript. Loading only the words
            // meant a continuation showed the previous lesson greyed out and
            // then began teaching subtopic 1 again.
            if (prevSession) {
              const savedPhase = String(prevSession.current_phase || "1").toUpperCase().replace(/^PHASE_/, "");
              resumeFrom = {
                subtopicIdx: Number(prevSession.current_subtopic_idx) || 0,
                phase: savedPhase === "MASTERY" ? "MASTERY" : `PHASE_${savedPhase}`,
              };
              resumeTeachingEvidence = prevSession.teaching_evidence || null;
            }

            if (prevSession?.block_history?.length) {
              const completedAt = prevSession.completed_at || prevSession.updated_at;
              const daysSince   = Math.max(0, Math.round(
                (Date.now() - new Date(completedAt).getTime()) / 86_400_000
              ));
              historyBlocks = [
                { type: "system-divider", label: `Previous session · ${daysSince} days ago` },
                ...prevSession.block_history.map(b => ({ ...b, faded: true })),
              ];
              // The transcript shown faded above is also the agent's memory:
              // without this the continuation looked connected but the agent
              // itself had forgotten every word of the previous lesson.
              priorBlocks = Array.isArray(prevSession.block_history)
                ? prevSession.block_history
                : [];
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
          // An alert id is an untrusted browser value. It may be carried into
          // the session only after the token-derived learner owns that alert.
          if (notificationId && await decayEngine.markNotificationRead(notificationId, studentId)) {
            ownedNotificationId = notificationId;
          }
          decayPayload = { ...decayPayload, notificationId: ownedNotificationId };

          // A review resumes the relationship, not just the topic health: the
          // tail of the most recent lesson on this topic becomes the agent's
          // conversational memory, and the modal shows it faded. Failure here
          // degrades to a context-less review, never a failed session start.
          try {
            const { data: priorRow } = await db.schema("edu")
              .from("adaptive_sessions")
              .select("block_history, updated_at, completed_at")
              .eq("student_id", studentId)
              .ilike("topic", topic)
              .in("status", ["active", "complete"])
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (Array.isArray(priorRow?.block_history) && priorRow.block_history.length) {
              const tail = priorRow.block_history
                .filter(b => b && typeof b === "object" && b.type !== "system-divider")
                .slice(-10);
              priorBlocks = tail;
              const completedAt = priorRow.completed_at || priorRow.updated_at;
              const daysSince   = Math.max(0, Math.round(
                (Date.now() - new Date(completedAt).getTime()) / 86_400_000
              ));
              historyBlocks = [
                { type: "system-divider", label: `Last lesson · ${daysSince} days ago` },
                ...tail.map(b => ({ ...b, faded: true })),
              ];
            }
          } catch (e) {
            console.warn("[start_adaptive_session] decay prior-lesson load failed:", e.message);
          }
        }

        // ── Create orchestrator with mode-aware context ───────
        const orchestrator = await getOrchestrator({
          mode:                 "student",
          studentId,
          userId:               caller,
          sessionType,
          subject,
          // The restored conversation. (A continuationSessionId used to be
          // passed here and silently dropped — getOrchestrator never named
          // it, so every continuation restarted the agent with empty memory.)
          priorBlocks,
          decayPayload,
          // Capped source material from the higher-ed start-session modal.
          // It is session-memory only; no file or raw text is persisted.
          referenceMaterial: sessionReference,
          teachingEvidence: resumeTeachingEvidence,
        });

        // Read by initialize() once the ladder is resolved, so the session
        // starts where the last one stopped rather than at step one.
        orchestrator.resumeFrom = resumeFrom;

        // Resolve the lesson ladder from the most trustworthy source available
        // (school scheme of work → exam-syllabus grounding → AI). Cached per
        // topic so a teacher review improves it for every future learner, and
        // NEVER blocking: a pending-review ladder is served immediately.
        let ladder = null;
        try {
          ladder = await resolveLadder({
            studentId, topic, subject,
            guide: orchestrator.guideOrchestrator?.guide || new NaNaEsumai(),
          });
          if (ladder?.subtopics?.length) {
            // initialize() reads this instead of calling detectMustKnowParts —
            // one LLM call saved per session start.
            orchestrator.presetMustKnow = ladder.subtopics;
            orchestrator.session = orchestrator.session || {};
            orchestrator.session.objectives = ladder.objectives || {};
            // The path, not just the stops: what each step builds on and what
            // it unlocks, so the learner can see where they are in the topic
            // rather than only what is in front of them.
            orchestrator.session.knowledgeMap = ladder.map || [];
          }
        } catch (e) { console.warn("[resolveLadder]", e.message); }

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
          reference: sessionReference ? {
            name: sessionReference.name,
            chars: sessionReference.chars,
            truncated: sessionReference.truncated,
          } : null,
          // Provenance of the lesson plan, so the learner can see where it came
          // from (school scheme of work / exam syllabus / AI-generated).
          source: ladder ? {
            provenance: ladder.provenance,
            status:     ladder.status,
            label:      provenanceLabel(ladder.provenance, ladder.status),
            refs:       ladder.refs || [],
          } : null,
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

        // Persist in background — never blocks the session. The new row
        // carries the prior transcript (faded) so the NEXT continuation sees
        // the whole chain, not just this hop.
        createSessionRecord(orchestrator, {
          studentId, topic, subject,
          openingBlocks: carryForward(priorBlocks, init.openingBlocks),
        }).then(rowId => {
          socket.emit("session_saved", {
            sessionId: id,
            saved:     !!rowId,
            rowId:     rowId || null,
            error:     rowId ? null : (orchestrator.saveError || { message: "unknown" }),
          });
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
          // Observable workflow labels only—never raw messages, model rationale,
          // or an instruction that the browser may use to choose a tool.
          onWorkflowStep: (step) => socket.emit("teaching_workflow_step", step),
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
          workflow:       result.workflow || null,
        });

        // Persist the turn and compact server-owned evidence before another
        // socket event (especially end_session) can observe this session.
        await appendSessionBlocks(orchestrator, [{ type: "user", text: message }, ...blocks]);
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
        await ensureSessionRecord(orchestrator);
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
        const priorOrchestrator = activeSessions.get(sessionId);
        const orchestrator = await getOrchestrator({
          mode:     "student",
          studentId,
          userId:   caller,
          teacherAgentId,
          referenceMaterial: priorOrchestrator?.referenceMaterial || null,
          teachingEvidence: serialiseTeachingEvidence(priorOrchestrator?.teachingEvidence),
        });
        if (priorOrchestrator?.session) {
          orchestrator.resumeFrom = {
            subtopicIdx: priorOrchestrator.session.mustKnowIndex || 0,
            phase: priorOrchestrator.session.phase || "PHASE_1",
          };
          orchestrator.dbSessionId = priorOrchestrator.dbSessionId || null;
          orchestrator.sessionMeta = priorOrchestrator.sessionMeta || null;
        }
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
          // The client appends this one server-shaped guide message after its
          // switch divider; it must not manufacture a phase or learning state.
          guideOpeningBlock: init.openingBlocks?.find((block) => block.type === "guide") || null,
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
        const acknowledged = await decayEngine.markNotificationRead(notificationId, socket.data.user.id);
        socket.emit("alert_acknowledged", { notificationId, acknowledged });
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
