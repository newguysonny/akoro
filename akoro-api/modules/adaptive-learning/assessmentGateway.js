/**
 * assessmentGateway.js
 *
 * Session Assessment Gateway — WebSocket surface for proctored assessments.
 *
 * Flow:
 *   register_reference  → reference_saved      (identity baseline photo)
 *   start_assessment    → assessment_ready     (Sergeant generates questions)
 *   proctor_frame       → proctor_result       (per-frame cheat analysis)
 *   assessment_message  → assessment_turn      (one Q&A turn, hints, advance)
 *   request_summary     → assessment_summary   (final, cheat-aware verdict)
 *   end_assessment      → assessment_ended
 *
 * Heavy vision work is offloaded to frameAnalyzer (optional GPU microservice);
 * the temporal scorer turns noisy per-frame signals into a stable probability.
 */

import { SergeantProctor }   from "./agents/sargeant/proctor.js";
import { TemporalScorer }    from "./proctoring/temporalScorer.js";
import { analyzeFrame, proctorServiceEnabled } from "./proctoring/frameAnalyzer.js";
import db                    from "../../db.js";

// sessionId → { proctor, scorer, referenceImage, dbId, blocks, cheatEvents, studentId, lastFrameTs }
const assessments = new Map();

// Frames arrive every ~2s; ignore bursts under this to bound CPU.
const MIN_FRAME_INTERVAL_MS = 1200;
// Auto-terminate threshold — sustained high cheat probability ends the exam.
const TERMINATE_PROBABILITY = 0.85;

export function setupAssessmentGateway(io) {
  io.on("connection", (socket) => {

    /* ── Register identity reference photo ─────────────────── */
    socket.on("register_reference", async ({ studentId, image }) => {
      try {
        if (!image) return socket.emit("assessment_error", { message: "no image" });
        // Persist to storage; keep the base64 in-memory for live comparison.
        const url = await _storeReference(studentId, image).catch(() => null);
        socket.data.referenceImage = _stripDataUrl(image);
        socket.data.referenceUrl   = url;
        socket.emit("reference_saved", { ok: true, url });
      } catch (e) {
        socket.emit("assessment_error", { message: e.message });
      }
    });

    /* ── Start a proctored assessment ──────────────────────── */
    socket.on("start_assessment", async ({ studentId, topic, subject, objectives = [], questionCount = 5, userId }) => {
      if (!studentId || !topic)
        return socket.emit("assessment_error", { message: "studentId and topic required" });
      try {
        const proctor = new SergeantProctor({ topic, subject, objectives, questionCount, studentName: "candidate" });
        const { opening, questions } = await proctor.generateQuestions();

        const id = `assess_${studentId}_${Date.now()}`;
        const scorer = new TemporalScorer();
        const openingBlocks = [
          { type: "proctor-banner", text: "Proctored assessment — keep your face in frame and stay alone.", serviceTier: proctorServiceEnabled() ? "full" : "client" },
          { type: "sergeant", agent: "Sergeant", emoji: "⚡", text: opening },
          ...(questions[0] ? [{ type: "question", idx: 1, total: questions.length, text: questions[0].q, difficulty: questions[0].difficulty }] : []),
        ];

        const state = {
          proctor, scorer, studentId,
          referenceImage: socket.data.referenceImage || null,
          referenceUrl:   socket.data.referenceUrl   || null,
          blocks:      [...openingBlocks],
          cheatEvents: [],
          lastFrameTs: 0,
          dbId:        null,
        };
        assessments.set(id, state);

        socket.data.assessmentId = id;
        socket.join(`assessment:${id}`);

        socket.emit("assessment_ready", {
          assessmentId: id,
          topic, subject,
          openingBlocks,
          totalQuestions: questions.length,
          proctorTier: proctorServiceEnabled() ? "full" : "client",
        });

        // Persist the row in the background — never blocks exam start.
        _createRecord(state, { studentId, topic, subject, questions, openingBlocks })
          .catch(e => console.warn("[assessment create]", e.message));
      } catch (e) {
        console.error("[start_assessment]", e);
        socket.emit("assessment_error", { message: e.message });
      }
    });

    /* ── Per-frame proctoring ──────────────────────────────── */
    socket.on("proctor_frame", async ({ frame, signals = {} }) => {
      const id = socket.data.assessmentId;
      const state = id && assessments.get(id);
      if (!state) return;

      const now = Date.now();
      if (now - state.lastFrameTs < MIN_FRAME_INTERVAL_MS) return;   // throttle
      state.lastFrameTs = now;

      try {
        const { signals: frameSignals, detail } = await analyzeFrame({
          frame, clientSignals: signals, referenceImage: state.referenceImage,
        });
        const result = state.scorer.push(frameSignals, now);

        // Log escalated signals as discrete cheat events (deduped by type+second).
        for (const esc of result.escalations) {
          const last = state.cheatEvents[state.cheatEvents.length - 1];
          if (!last || last.type !== esc.type || now - last.ts > 5000) {
            state.cheatEvents.push({ ts: now, type: esc.type, severity: esc.severity, detail: detail.objects || null });
          }
        }

        socket.emit("proctor_result", {
          probability: result.probability,
          level:       result.level,
          active:      result.active,
          escalations: result.escalations,
        });

        // Auto-terminate on sustained high probability.
        if (result.probability >= TERMINATE_PROBABILITY) {
          socket.emit("assessment_terminated", {
            reason: "Sustained proctoring violations.",
            probability: result.probability,
          });
          await _finalize(state, socket, id, { forcedVerdict: "terminated" });
        }
      } catch (e) {
        // Never let a bad frame break the session.
        console.warn("[proctor_frame]", e.message);
      }
    });

    /* ── One Q&A turn ──────────────────────────────────────── */
    socket.on("assessment_message", async ({ message }) => {
      const id = socket.data.assessmentId;
      const state = id && assessments.get(id);
      if (!state || !message) return;

      try {
        socket.emit("assessment_typing");
        const cheatProbability = state.scorer.score().probability;
        const turn = await state.proctor.evaluateAnswer(message, { cheatProbability });

        const newBlocks = [
          { type: "user", text: message },
          { type: "sergeant", agent: "Sergeant", emoji: "⚡",
            text: turn.eval.feedback, score: turn.eval.score, correct: turn.eval.correct },
        ];
        if (turn.hint)        newBlocks.push({ type: "hint", text: turn.hint });
        if (turn.suspicious)  newBlocks.push({ type: "proctor-flag", text: "Strong answer under elevated proctoring signals — flagged for review." });
        if (turn.advanced && turn.nextQuestion)
          newBlocks.push({ type: "question", idx: turn.progress.index + 1, total: turn.progress.total,
                           text: turn.nextQuestion.q, difficulty: turn.nextQuestion.difficulty });

        state.blocks.push(...newBlocks);
        socket.emit("assessment_turn", {
          blocks:   newBlocks,
          progress: turn.progress,
          done:     turn.done,
        });
        _appendBlocks(state, newBlocks).catch(() => {});

        if (turn.done) {
          // All questions answered — finalize automatically.
          await _finalize(state, socket, id);
        }
      } catch (e) {
        console.error("[assessment_message]", e);
        socket.emit("assessment_error", { message: e.message });
      }
    });

    /* ── Explicit summary request ──────────────────────────── */
    socket.on("request_assessment_summary", async () => {
      const id = socket.data.assessmentId;
      const state = id && assessments.get(id);
      if (!state) return socket.emit("assessment_error", { message: "no active assessment" });
      await _finalize(state, socket, id);
    });

    /* ── End / cleanup ─────────────────────────────────────── */
    socket.on("end_assessment", async () => {
      const id = socket.data.assessmentId;
      const state = id && assessments.get(id);
      if (state) {
        await _markStatus(state, "abandoned").catch(() => {});
        assessments.delete(id);
      }
    });

    socket.on("disconnect", () => {
      const id = socket.data.assessmentId;
      // Keep the record; mark abandoned if it never completed.
      const state = id && assessments.get(id);
      if (state && !state.completed) {
        _markStatus(state, "abandoned").catch(() => {});
        assessments.delete(id);
      }
    });
  });
}

/* ── Finalization (shared by done / summary / terminate) ───── */
async function _finalize(state, socket, id, { forcedVerdict = null } = {}) {
  if (state.completed) return;
  state.completed = true;
  try {
    const snap = state.scorer.snapshot();
    const summary = await state.proctor.finalVerdict({
      cheatProbability: snap.peakProbability,
      cheatEvents:      state.cheatEvents,
    });
    if (forcedVerdict) summary.verdict = forcedVerdict;

    socket.emit("assessment_summary", {
      ...summary,
      proctoring: snap,
      cheatEvents: state.cheatEvents,
    });
    await _completeRecord(state, summary, snap).catch(e => console.warn("[assessment complete]", e.message));
  } catch (e) {
    console.error("[assessment finalize]", e);
    socket.emit("assessment_error", { message: e.message });
  } finally {
    assessments.delete(id);
  }
}

/* ── Persistence helpers (edu.assessment_sessions) ─────────── */
async function _createRecord(state, { studentId, topic, subject, questions, openingBlocks }) {
  const { data, error } = await db.schema("edu").from("assessment_sessions").insert({
    student_id:          studentId,
    topic, subject:      subject || null,
    status:              "active",
    reference_image_url: state.referenceUrl || null,
    identity_verified:   Boolean(state.referenceImage),
    block_history:       openingBlocks,
    questions:           questions,
    started_at:          new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }).select("id").single();
  if (error) throw error;
  state.dbId = data.id;
}

async function _appendBlocks(state, newBlocks) {
  if (!state.dbId || !newBlocks?.length) return;
  const { data } = await db.schema("edu").from("assessment_sessions")
    .select("block_history").eq("id", state.dbId).single();
  const existing = Array.isArray(data?.block_history) ? data.block_history : [];
  await db.schema("edu").from("assessment_sessions").update({
    block_history: [...existing, ...newBlocks],
    updated_at:    new Date().toISOString(),
  }).eq("id", state.dbId);
}

async function _completeRecord(state, summary, snap) {
  if (!state.dbId) return;
  await db.schema("edu").from("assessment_sessions").update({
    status:             summary.verdict === "terminated" ? "terminated" : "completed",
    assessment_score:   summary.assessmentScore,
    cheat_probability:  snap.peakProbability,
    final_verdict:      summary.verdict,
    verdict_detail:     summary.verdictDetail,
    cheat_events:       state.cheatEvents,
    proctoring_signals: snap,
    completed_at:       new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  }).eq("id", state.dbId);
}

async function _markStatus(state, status) {
  if (!state.dbId) return;
  await db.schema("edu").from("assessment_sessions").update({
    status, updated_at: new Date().toISOString(),
  }).eq("id", state.dbId);
}

async function _storeReference(studentId, image) {
  const buffer = Buffer.from(_stripDataUrl(image), "base64");
  const path = `assessment-refs/${studentId}/${Date.now()}.jpg`;
  const { error } = await db.storage.from("training-assets")
    .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { data } = db.storage.from("training-assets").getPublicUrl(path);
  return data?.publicUrl || null;
}

function _stripDataUrl(s) {
  return typeof s === "string" ? s.replace(/^data:image\/\w+;base64,/, "") : s;
}

export { assessments };
