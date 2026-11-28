// Teaching-domain socket events: starting a session, running a turn, and the
// read-only summary.

import { provenanceLabel } from "../teaching/lessonLadder.js";
import { normalizeSessionReference } from "../grounding/sessionReference.js";
import { groundTurn, citationsForReply } from "../grounding/documentGrounding.js";
import {
  createSessionRecord, ensureSessionRecord, appendSessionBlocks,
} from "../teaching-session/lifecycle.js";
import { carryForward } from "../teaching-session/context.js";
import { resultToTypedBlocks } from "../teaching-session/blocks.js";
import {
  finalCheckEnabled, createFinalCheck, finalCheckSnapshot, runFinalCheckConcepts,
  finalCheckResolution, beginFinalCheckReteach, finalCheckReteachReady, finishFinalCheck,
} from "../teaching-session/finalCheck.js";
import { prepareTeachingSession } from "../teaching-session/start.js";
import { guideIdeas, shortConcept } from "../teaching-session/guideIdeas.js";
import { activeSessions } from "./sessions.js";
import { endLiveSession } from "./teachingLifecycle.js";

// The Final check owns the ending of a protégé teaching session (not guide
// mode, not a decay review — those keep their own completion paths).
const finalCheckApplies = (orchestrator, result) =>
  finalCheckEnabled()
  && result.teachingMode === "teach_agent"
  && orchestrator.sessionType !== "decay_review";

export function registerTeachingSessionHandlers(socket) {
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
    decayReviewWorkflowId,      // Phase 8: a Decay Review's re-teaching step (ownership checked)
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
        ? await import("../study-prep/wiring.js").then((w) => w.teachingHandoff()).catch(() => null)
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

      // Phase 8: the re-teaching step of the learner's own Decay Review — its end starts the last retest.
      if (mode === "decay" && isId(decayReviewWorkflowId)) {
        const review = await import("../decay-review/wiring.js").then((w) => w.decayReview().view({ workflowId: decayReviewWorkflowId, learnerId: owner })).catch(() => null);
        if (review?.state === "intervention" && review.teaching?.needed) orchestrator.decayReviewWorkflowId = decayReviewWorkflowId;
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
        // The Final check's state, when one is already running on this session.
        finalCheck: finalCheckSnapshot(orchestrator.session),
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

  // ── The Final check driver (2026-11-28) ───────────────────
  // The verdict on a teach session is the end-of-session assessment, not
  // the per-turn scores: when the evidence says every part is taught, the
  // check runs (its snapshots drive the strip in the app); gaps loop back
  // through re-teaching; only a passed or settled check ends the session.
  const emitFinalCheck = (orchestrator) => {
    const snap = finalCheckSnapshot(orchestrator.session);
    if (snap) socket.emit("final_check", { finalCheck: snap });
  };

  // Run the check over `concepts`, then resolve. fullRun: the first,
  // whole-topic run (a machinery failure there must not trap the session).
  const runCheckAndResolve = async (orchestrator, concepts, { fullRun = false } = {}) => {
    if (orchestrator.finalCheckRunning) return;
    orchestrator.finalCheckRunning = true;
    const fc = orchestrator.session.finalCheck;
    try {
      let { judged } = await runFinalCheckConcepts({
        orchestrator, concepts, onProgress: () => emitFinalCheck(orchestrator),
      });
      if (fullRun) {
        // One retry pass over anything a failed batch left unjudged.
        const unjudged = fc.items.filter((i) => i.status === "waiting").map((i) => i.concept);
        if (unjudged.length && judged > 0) {
          const retry = await runFinalCheckConcepts({
            orchestrator, concepts: unjudged, onProgress: () => emitFinalCheck(orchestrator),
          });
          judged += retry.judged;
        }
        if (judged === 0) {
          // The verdict machinery itself failed: fall back to the per-turn
          // bar (which WAS met) rather than trapping a finished learner.
          console.warn("[final-check] no part could be judged — completing on the per-turn bar");
          delete orchestrator.session.finalCheck;
          await endLiveSession(socket, { endedBy: "objective_met" });
          return;
        }
        // Still unjudged after the retry: an honest gap the learner can act on.
        for (const item of fc.items) {
          if (item.status === "waiting") {
            item.status = "gap";
            item.note = "The check couldn't judge this part — re-teach it and it will be checked again.";
          }
        }
      }
    } finally {
      orchestrator.finalCheckRunning = false;
    }
    const resolution = finalCheckResolution(fc);
    if (resolution === "open") {
      fc.status = fc.items.some((i) => i.status === "reteaching") ? "reteach" : "open";
      emitFinalCheck(orchestrator);
      return;
    }
    finishFinalCheck(fc, resolution);
    emitFinalCheck(orchestrator);
    await endLiveSession(socket, { endedBy: "objective_met" });
  };

  // ── teacher_message (all session types) ──────────────────
  socket.on("teacher_message", async ({ message, mode } = {}) => {
    const { sessionId, agentPairId } = socket.data;
    const orchestrator = activeSessions.get(sessionId);
    if (!orchestrator) {
      if (socket.data.sessionEnded) return;   // typed into a completed session — drop it quietly
      return socket.emit("error", { message: "No active session." });
    }

    try {
      socket.emit("typing_start");
      socket.emit("student_typing", { typing: true });
      const turnStartedAt = Date.now();
      const turnNo = (orchestrator.session.turnCount || 0) + 1;

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
        // Guide mode (learn_with_guide): NaNa's teaching reply IS the turn's reply.
        onGuideReplyChunk: (token) => socket.emit("guide_reply_token", { token }),
        // Observable workflow labels only—never raw messages, model rationale,
        // or an instruction that the browser may use to choose a tool.
        onWorkflowStep: (step) => socket.emit("teaching_workflow_step", step),
        // The coach's result, when it lands after the turn has settled (it
        // runs off the critical path): the guide's pills for this turn.
        onGuideUpdate: (guideResult, meta = {}) => {
          if (!guideResult) return;
          socket.emit("guide_update", {
            turn: turnNo,
            ideas: guideIdeas(guideResult.suggestions, {
              nextAction: guideResult.nextAction,
              concept: meta.topic || shortConcept(meta.concept),
            }),
            tip: guideResult.tip || null,
            nextAction: guideResult.nextAction || null,
            isUrgent: !!guideResult.isUrgent,
            offTopic: !!guideResult.offTopic,
          });
        },
      }, { mode: mode || null });
      console.info(`[teach-turn] teacher_message total ${Date.now() - turnStartedAt}ms (turn ${turnNo})`);

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
        teachingMode:   result.teachingMode || "teach_agent",
        // teaching.request_assessment's card (each question as marked, the score) — only on a check turn.
        ...(result.assessment ? { assessment: result.assessment } : {}),
      });

      // Persist the turn and compact server-owned evidence before another
      // socket event (especially end_session) can observe this session.
      await appendSessionBlocks(orchestrator, [{ type: "user", text: message }, ...blocks]);
      // Phase 6: a handed-over session tells Study Prep each part taught (its card and chat follow).
      if (orchestrator.teachingWorkflowId) {
        import("../study-prep/wiring.js").then((w) => {
          const h = w.teachingHandoff();
          h.recordTurn({ workflowId: orchestrator.teachingWorkflowId, decisions: result.decisions, fallback: result.fallback, reply: result.workflow?.reply || null, mode: result.teachingMode });
          return h.progress({ workflowId: orchestrator.teachingWorkflowId, result });
        }).catch((e) => console.warn("[teaching handoff] progress:", e.message));
      }
      // The agent paused it: keep it resumable (the row exists), as a minimise does.
      if (result.pauseRequested) await ensureSessionRecord(orchestrator).catch(() => null);
      // A §9.5 bound ends the session outright — the safety valve outranks the check.
      if (result.boundedEnd) {
        await endLiveSession(socket, { endedBy: result.endRequested, bounded: result.boundedEnd });
      } else if (finalCheckApplies(orchestrator, result)) {
        const fc = orchestrator.session.finalCheck;
        const reteachItem = finalCheckReteachReady(fc);
        if (reteachItem) {
          // A re-teach is in flight: once the gate itself moves past the
          // part (or the evidence completes), re-check just that part.
          if (result.subtopicAdvanced || result.objectiveMet || result.endRequested === "objective_met") {
            fc.status = "running";
            await runCheckAndResolve(orchestrator, [reteachItem.concept]);
          }
          // Otherwise the re-teach is still landing — the check waits.
        } else if (!fc && (result.objectiveMet || result.endRequested === "objective_met")) {
          // Every part taught to the per-turn bar. The scores steered us
          // here; the verdict belongs to the Final check now. Triggering on
          // objectiveMet (not only on the agent proposing completion) also
          // ends the old end-decision lag.
          const parts = orchestrator.session.mustKnowParts?.length
            ? orchestrator.session.mustKnowParts
            : [orchestrator.session.topic];
          orchestrator.session.finalCheck = createFinalCheck(parts);
          emitFinalCheck(orchestrator);
          await runCheckAndResolve(orchestrator, parts, { fullRun: true });
        }
        // With a check open, an endRequested is the check's to grant, not
        // the turn's — it is deliberately not honoured here.
      } else if (result.endRequested) {
        await endLiveSession(socket, { endedBy: result.endRequested, bounded: result.boundedEnd });
      }
    } catch (err) {
      console.error("[teacher_message]", err);
      socket.emit("student_done"); socket.emit("guide_done");
      socket.emit("error", { message: err.message });
    }
  });

  // ── final_check_reteach ───────────────────────────────────
  // The learner tapped Re-teach on a gap in the Final check strip: the
  // session goes back to teaching that part in the chat. When the gate
  // moves past it again, teacher_message re-checks just that part.
  socket.on("final_check_reteach", async ({ index } = {}) => {
    const { sessionId } = socket.data;
    const orchestrator = activeSessions.get(sessionId);
    if (!orchestrator) {
      if (socket.data.sessionEnded) return;   // a completed session has no check to re-teach
      return socket.emit("error", { message: "No active session." });
    }
    const fc = orchestrator.session.finalCheck;
    if (!beginFinalCheckReteach(fc, Number(index))) return;   // not an open gap — nothing to do
    orchestrator.session.mustKnowIndex = Number(index);
    if (orchestrator.session.phase === "MASTERY") orchestrator.session.phase = "PHASE_2";
    emitFinalCheck(orchestrator);
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
}
