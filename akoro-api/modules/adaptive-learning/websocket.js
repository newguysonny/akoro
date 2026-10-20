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
import { provenanceLabel } from "./lessonLadder.js";
import { normalizeSessionReference } from "./sessionReference.js";
import { groundTurn, citationsForReply } from "./documentGrounding.js";
import { serialiseTeachingEvidence } from "./teaching-evidence.js";
import {
  createSessionRecord, ensureSessionRecord, appendSessionBlocks, completeSessionRecord,
  readSessionBlocks,
} from "./teaching-session/lifecycle.js";
import { carryForward } from "./teaching-session/context.js";
import { resultToTypedBlocks } from "./teaching-session/blocks.js";
import { prepareTeachingSession } from "./teaching-session/start.js";

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
    "teacher_message", "request_summary", "resume_session", "park_session", "end_session",
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

    // ── Retired session starts (D42) ──────────────────────────
    // start_session ran the NaNa / Trained orchestrators, which moved the
    // learner up a phase on the guide's say-so; start_student_session and
    // start_decay_session never saved the session. Every teaching session now
    // starts with start_adaptive_session (fresh | continuation | decay), where
    // phases change only through the evidence gate and the guide is a choice
    // inside the session (switch_agent_pair).
    for (const retired of ["start_session", "start_student_session", "start_decay_session"]) {
      socket.on(retired, () => socket.emit("error", {
        code: "retired_event",
        message: `${retired} was retired — start the session with start_adaptive_session.`,
      }));
    }

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
      document,                   // { recordId } | { contentKey } — a library document to search per turn
      teacherAgentId,             // the learner's chosen guide (ownership checked in the registry)
      userId,
      workflowId,                 // Phase 6: a teaching session handed over from Study Prep (ownership checked)
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
        // Phase 6: a teaching workflow from the dashboard — only the authenticated
        // learner's own, and only while it is open. Its focus (what the Agent Check
        // missed) becomes the session's parts.
        // It is found by its workflow id, or — opened from the dashboard's sessions list like any
        // session — by its row (the continuation's sessionId).
        const isId = (v) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
        const handoff = isId(workflowId) || (mode === "continuation" && isId(prevSessionId))
          ? await import("./study-prep/wiring.js").then((w) => w.teachingHandoff()).catch(() => null)
          : null;
        const owner = socket.data?.user?.id || caller;
        const teaching = !handoff ? null
          : isId(workflowId) ? (await handoff.listOpen(owner).catch(() => [])).find((t) => t.workflowId === workflowId) || null
            : await handoff.forSessionRow({ learnerId: owner, adaptiveSessionId: prevSessionId }).catch(() => null);
        // One preparation for every transport (teaching-session/start.js):
        // continuation / decay loading, the gated student session, the ladder.
        const { orchestrator, init, sessionType, decayPayload, historyBlocks, priorBlocks, ladder } = await prepareTeachingSession({
          studentId, caller, topic, subject, mode,
          prevSessionId, notificationId, reference: sessionReference, document, teacherAgentId,
          focus: teaching?.focus || null,
        });
        const id   = `${mode}_${studentId}_${Date.now()}`;
        if (teaching) {
          orchestrator.teachingWorkflowId = teaching.workflowId;
          // Its first opening teaches into the row start_teaching_session made — no second row in the list.
          if (teaching.state === "scheduled" && teaching.adaptiveSessionId && teaching.adaptiveSessionId === prevSessionId) orchestrator.dbSessionId = prevSessionId;
          await handoff.bind({ workflowId: teaching.workflowId, learnerId: owner, liveSessionId: id }).catch((e) => console.warn("[teaching handoff] bind:", e.message));
        }

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

        // (sessionMeta — the identity lifecycle.js saves from — was set by
        // prepareTeachingSession, so cancel/disconnect can still save.)

        // Persist in background — never blocks the session. The new row
        // carries the prior transcript (faded) so the NEXT continuation sees
        // the whole chain, not just this hop.
        createSessionRecord(orchestrator, {
          studentId, topic, subject,
          openingBlocks: carryForward(priorBlocks, init.openingBlocks),
        }).then(rowId => {
          // The dashboard's Continue reopens this row for the handed-over session.
          if (rowId && teaching) handoff.saved({ workflowId: teaching.workflowId, adaptiveSessionId: rowId }).catch(() => null);
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

        // Ground this turn in the document's passages most relevant to what
        // the learner just said. Best-effort: no target / nothing indexed /
        // a failure leaves the session's fixed reference in place.
        let grounding = null;
        if (orchestrator.documentTargetPromise) {
          const target = await orchestrator.documentTargetPromise.catch(() => null);
          grounding = target ? await groundTurn({ target, message }) : null;
          if (orchestrator.studentAgent) {
            orchestrator.studentAgent.referenceMaterial = grounding ? grounding.reference : orchestrator.referenceMaterial;
          }
        }

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
        // The [n] the protégé used → page + box (or a moment); the app turns
        // them into chips that jump the reader. Saved with the block, so a
        // resumed session keeps them.
        if (grounding) {
          const studentBlock = blocks.find((b) => b.type === "student-agent");
          const citations = studentBlock ? citationsForReply(studentBlock.text, grounding.passages) : [];
          if (citations.length) studentBlock.citations = citations;
          // The guide's tip cites the same passages (guidePassagesBlock).
          const guideBlock = blocks.find((b) => b.type === "guide");
          const guideCites = guideBlock ? citationsForReply(guideBlock.text, grounding.passages) : [];
          if (guideCites.length) guideBlock.citations = guideCites;
        }

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
        // Phase 6: a handed-over session tells Study Prep each part taught (its card and chat follow).
        if (orchestrator.teachingWorkflowId) {
          import("./study-prep/wiring.js").then((w) => w.teachingHandoff().progress({ workflowId: orchestrator.teachingWorkflowId, result }))
            .catch((e) => console.warn("[teaching handoff] progress:", e.message));
        }
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
    socket.on("resume_session", async ({ sessionId, studentId, userId } = {}) => {
      const orchestrator = sessionId ? activeSessions.get(sessionId) : null;
      if (!orchestrator) return socket.emit("resume_failed", { sessionId: sessionId || null });

      // Ownership: only the user who started the session may resume it.
      const me = socket.data.user?.id;
      const owner = orchestrator.userId || orchestrator.studentId;
      if (owner && me && owner !== me) return socket.emit("resume_failed", { sessionId });

      cancelSessionReap(sessionId);

      // A remounted client (minimize → restore) arrives with empty local
      // blocks; the same per-turn-appended history a continuation loads
      // rebuilds its transcript. A client that merely reconnected keeps its
      // intact local blocks and ignores this. Not faded — this is the live
      // session's own conversation, not a previous one.
      const historyBlocks = await readSessionBlocks(orchestrator);

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
        historyBlocks,
      });
    });

    // ── park_session ──────────────────────────────────────────
    // Minimize: save the session the way an end does, but keep it resumable.
    // The transcript is already appended per turn; this ensures the DB row
    // exists (status stays "active", so it lists as resumable) before the
    // socket drops. The disconnect handler then holds the orchestrator
    // through its grace window so a quick restore resumes the live session.
    socket.on("park_session", async () => {
      const { sessionId } = socket.data;
      const orchestrator = activeSessions.get(sessionId);
      if (!orchestrator) return socket.emit("session_parked", { sessionId: sessionId || null, saved: false, reason: "no active session" });
      try {
        const rowId = await ensureSessionRecord(orchestrator);
        socket.emit("session_parked", { sessionId, saved: !!rowId, rowId: rowId || null });
      } catch (err) {
        console.error("[park_session]", err);
        socket.emit("session_parked", { sessionId, saved: false, error: err.message });
      }
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
        // Phase 6: a handed-over session's outcome goes back to Study Prep (its retest unlocks).
        if (orchestrator.teachingWorkflowId) {
          await import("./study-prep/wiring.js")
            .then((w) => w.teachingHandoff().finish({ workflowId: orchestrator.teachingWorkflowId, endResult, notesAdded: orchestrator.stats?.agentKnowledgeAdded || 0 }))
            .catch((e) => console.warn("[teaching handoff] finish:", e.message));
        }
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
        if (!["nana-esumai", "nana-sargeant"].includes(newAgentPairId) && !newAgentPairId.startsWith("trained:")) {
          return socket.emit("error", { message: "Unknown teaching guide.", code: "UNKNOWN_GUIDE", agentPairId: newAgentPairId });
        }
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
        // Only the guide changes (D42): the session keeps its type, subject,
        // decay material, conversation, phase and evidence. (A switch used to
        // rebuild it as a fresh free-teaching session.)
        const orchestrator = await getOrchestrator({
          mode:     "student",
          studentId,
          userId:   caller,
          teacherAgentId,
          sessionType:  priorOrchestrator?.sessionType || "free_teaching",
          subject:      priorOrchestrator?.subject || subject || null,
          decayPayload: priorOrchestrator?.decayPayload || null,
          referenceMaterial: priorOrchestrator?.referenceMaterial || null,
          teachingEvidence: serialiseTeachingEvidence(priorOrchestrator?.teachingEvidence),
        });
        // The document stays with the session across a guide switch.
        orchestrator.documentTargetPromise = priorOrchestrator?.documentTargetPromise || null;
        if (priorOrchestrator?.session) {
          orchestrator.resumeFrom = {
            subtopicIdx: priorOrchestrator.session.mustKnowIndex || 0,
            phase: priorOrchestrator.session.phase || "PHASE_1",
          };
          orchestrator.dbSessionId = priorOrchestrator.dbSessionId || null;
          orchestrator.sessionMeta = priorOrchestrator.sessionMeta || null;
        }
        const init = await orchestrator.initialize(studentId, topic);
        // The live conversation carries over too (initialize() starts it empty).
        if (priorOrchestrator?.session?.history?.length && orchestrator.session) {
          orchestrator.session.history = priorOrchestrator.session.history;
        }

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
