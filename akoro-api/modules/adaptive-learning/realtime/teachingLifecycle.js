// Teaching session lifecycle: reconnect, park, end, mode switch, and reopening
// a handed-over workflow.

import { clearStateCache } from "../../learner-state/index.js";
import {
  ensureSessionRecord, completeSessionRecord, readSessionBlocks,
} from "../teaching-session/lifecycle.js";
import { fmtSessionEnd } from "./format.js";
import { activeSessions, cancelSessionReap } from "./sessions.js";
import { joinSessionRoom, joinStudentRoom, joinUserRoom } from "./rooms.js";

export function registerTeachingLifecycleHandlers(socket) {
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
    joinSessionRoom(socket, sessionId);
    joinStudentRoom(socket, studentId || orchestrator.studentId);
    joinUserRoom(socket, caller);

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
  socket.on("end_session", async () => endLiveSession(socket, { endedBy: "learner" }));

  // ── set_teaching_mode (D24) ───────────────────────────────
  // Learn by teaching ↔ learn with the guide, from the next turn. Transcript,
  // evidence, phase and part carry across.
  socket.on("set_teaching_mode", async ({ mode } = {}) => {
    const orchestrator = activeSessions.get(socket.data?.sessionId);
    if (!orchestrator?.session) return socket.emit("error", { message: "No active session." });
    const { normaliseMode } = await import("../teaching-session/policy.js");
    orchestrator.session.teachingMode = normaliseMode(mode);
    socket.emit("teaching_mode", { mode: orchestrator.session.teachingMode });
    if (orchestrator.teachingWorkflowId) {
      import("../study-prep/wiring.js").then((w) => w.teachingHandoff().setMode({ workflowId: orchestrator.teachingWorkflowId, mode: orchestrator.session.teachingMode })).catch(() => null);
    }
  });

  // ── open_workflow (§9.7) ──────────────────────────────────
  // Reopen a teaching workflow by id — after closing the app, or from another
  // device: a live session resumes as resume_session does; otherwise the
  // client starts it as a continuation of its saved row. Always the
  // authenticated learner's own, and only while it is open.
  socket.on("open_workflow", async ({ workflowId, afterSeq = 0 } = {}) => {
    const me = socket.data?.user?.id;
    if (!me || typeof workflowId !== "string") return socket.emit("workflow_open_failed", { workflowId: workflowId || null, reason: "not_found" });
    try {
      const w = await import("../study-prep/wiring.js");
      const handoff = w.teachingHandoff();
      const view = (await handoff.listOpen(me)).find((t) => t.workflowId === workflowId) || null;
      if (!view) return socket.emit("workflow_open_failed", { workflowId, reason: "not_open" });
      const events = await handoff.eventsFor({ workflowId, after: Number(afterSeq) || 0 });
      const liveId = [...activeSessions.entries()].find(([, o]) => o.teachingWorkflowId === workflowId && (o.userId || o.studentId) === me)?.[0] || null;
      socket.emit("workflow_opened", { workflow: view, events: (events || []).slice(-50), liveSessionId: liveId, resumeWith: liveId ? "resume_session" : "start_adaptive_session", adaptiveSessionId: view.adaptiveSessionId || null });
    } catch (e) {
      socket.emit("workflow_open_failed", { workflowId, reason: "error" });
      console.warn("[open_workflow]", e.message);
    }
  });
}

export async function endLiveSession(socket, { endedBy = "learner", bounded = null } = {}) {
  const { sessionId, agentId, agentPairId } = socket.data;
  const orchestrator = activeSessions.get(sessionId);
  if (sessionId) cancelSessionReap(sessionId);
  if (!orchestrator) return socket.emit("error", { message: "No active session." });
  try {
    const endResult = await orchestrator.endSession();
    const formatted = fmtSessionEnd(endResult);
    await ensureSessionRecord(orchestrator);
    await completeSessionRecord(orchestrator);   // mark the session row complete
    // Phase 4a: how the session's strategy turned out (fire-and-forget, never fails the end).
    void import("../teaching-workflow/tools.js").then(({ currentTeachingStrategy, recordTeachingStrategyOutcome, teachingSessionOutcome }) => {
      const outcome = teachingSessionOutcome({ endedBy, totalTurns: endResult?.totalTurns, teachingEvidence: orchestrator.teachingEvidence });
      const strategy = currentTeachingStrategy(orchestrator);
      return outcome && strategy ? recordTeachingStrategyOutcome(orchestrator, { strategy, outcome, turnRef: "session_end", details: { endedBy, ...(bounded ? { bounded } : {}) } }) : null;
    }).catch((e) => console.warn("[strategy outcome] session end:", e.message));
    // Phase 6: a handed-over session's outcome goes back to Study Prep (its retest unlocks).
    if (orchestrator.teachingWorkflowId) {
      await import("../study-prep/wiring.js")
        .then((w) => w.teachingHandoff().finish({ workflowId: orchestrator.teachingWorkflowId, endResult, notesAdded: orchestrator.stats?.agentKnowledgeAdded || 0,
          endedBy, bounded, mode: orchestrator.session?.teachingMode || null, strategy: orchestrator.session?.strategy || null }))
        .catch((e) => console.warn("[teaching handoff] finish:", e.message));
    }
    if (orchestrator.decayReviewWorkflowId) {
      await import("../decay-review/wiring.js")
        .then((w) => w.decayReview().teachingDone({ workflowId: orchestrator.decayReviewWorkflowId, learnerId: orchestrator.userId || orchestrator.studentId }))
        .catch((e) => console.warn("[decay review] teaching done:", e.message));
    }
    activeSessions.delete(sessionId);
    await clearStateCache(agentId);
    socket.emit("session_ended", {
      message: formatted, summary: endResult, agentPairId,
      agentGrowth:  endResult.agentGrowth  || null,
      decayResult:  endResult.decayResult  || null,
      sessionType:  endResult.sessionType  || "free_teaching",
      // Who ended it: the learner, or the session itself (every part taught / a limit reached).
      endedBy, ...(bounded ? { bounded } : {}),
    });
  } catch (err) { console.error("[end_session]", err); socket.emit("error", { message: err.message }); }
}
