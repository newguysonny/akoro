// =============================================================
// training/live.js
// Live streaming training: the WebSocket transcriber, and the
// start / chunk / end HTTP endpoints.
// =============================================================

import db from "../../../db.js";
import { toFile } from "openai";
import { openai } from "../../../lib/aiModel.js";
import { deriveAndSaveOrchestrationConfig } from "./agentOrchestration.js";
import { createRealtimeTranscriber, transcribeBufferDeepgram, hasDeepgram } from "../../voice/index.js";
import { runs, runLog, runInsight, completeRun } from "./runs.js";
import { embed, storeChunk, upsertTeacherProfile } from "./store.js";
import { extractStyleProfile, extractSegments } from "./extraction.js";

// =============================================================
// WEBSOCKET — live streaming training
// =============================================================
export function attachTrainingWS(wss) {
  wss.on("connection", (ws) => {
    let sttConnection = null, run = null, authenticated = false;
    let transcript = "", teacherId, agentId, subject, sessionId;
    const send = (event, data) => ws.send(JSON.stringify({ event, data }));

    const handleSegment = async (segment) => {
      transcript += " " + segment;
      send("transcript", { text: segment });
      if (run) runLog(run, "info", "Transcript segment received", `${Math.ceil(transcript.split(" ").length)} words`);
      if (Math.ceil(transcript.split(" ").length) % 500 === 0) {
        try {
          const embedding = await embed(segment);
          await storeChunk({ teacherId, agentId, sessionId, chunkText: segment, chunkType: "transcript", metadata: { subject, live: true }, embedding });
          if (run) runLog(run, "ok", "Live chunk embedded");
        } catch (e) { if (run) runLog(run, "err", "Live chunk embed failed", e.message); }
      }
    };

    ws.on("message", async (raw, isBinary) => {
      try {
        // Binary frames are raw PCM16 mono 24kHz audio
        if (isBinary && authenticated && sttConnection) {
          sttConnection.sendAudio(Buffer.from(raw).toString("base64"));
          return;
        }
        const msg = JSON.parse(raw.toString());

        if (msg.type === "auth") {
          const { data: tok } = await db.schema("edu").from("stream_tokens").select("*")
            .eq("token", msg.token).gte("expires_at", new Date().toISOString()).single();
          if (!tok) { send("error", { message: "Invalid or expired token" }); return ws.close(); }

          teacherId = tok.teacher_id; agentId = tok.agent_id;
          subject   = tok.subject;   sessionId = tok.session_id;
          authenticated = true; run = runs.get(tok.run_id);

          let interim = "";
          sttConnection = createRealtimeTranscriber({
            onOpen:  () => { send("status", { message: "Transcription open — streaming" }); if (run) runLog(run, "ok", "OpenAI realtime transcription open"); },
            onDelta: (delta) => { interim += delta; send("interim", { text: interim }); },
            onCompleted: async (segment) => { interim = ""; await handleSegment(segment); },
            onError: (e) => { send("error", { message: e.message }); },
            onClose: ()  => { send("status", { message: "Transcription closed" }); },
          });
          send("auth_ok", { sessionId, runId: tok.run_id, message: "Ready — send audio chunks (PCM16 mono 24kHz)" });
          return;
        }

        if (msg.type === "end" && authenticated) {
          if (sttConnection) sttConnection.close();
          if (run) runLog(run, "sys", "Live stream ended — running final extraction");
          if (transcript.trim().length > 100) {
            const [styleProfile, segments] = await Promise.all([
              extractStyleProfile(transcript, subject),
              extractSegments(transcript, subject),
            ]);
            for (const seg of segments) {
              const embedding = await embed(seg.text);
              await storeChunk({ teacherId, agentId, sessionId, chunkText: seg.text, chunkType: seg.type, metadata: { concept: seg.concept, subject, live: true }, embedding });
              if (run) runInsight(run, { type: seg.type, concept: seg.concept, text: seg.text, xp: seg.xp || 40 });
            }
            await upsertTeacherProfile(teacherId, agentId, { subject, style_profile: styleProfile, last_trained_at: new Date() });

            // Derive orchestration from live session too
            const orchConfig = await deriveAndSaveOrchestrationConfig({
              teacherId, agentId, runId: run?.runId, subject, styleProfile, transcript,
            }).catch(e => { console.warn("[Live] Orchestration save failed:", e.message); return null; });

            await db.schema("edu").from("training_sessions").update({ status: "complete", completed_at: new Date() }).eq("id", sessionId);
            const summary = { sessionId, styleProfile, segmentsFound: segments.length, orchestrationSaved: !!orchConfig };
            if (run) completeRun(run, summary);
            send("complete", summary);
          } else {
            send("complete", { sessionId, message: "Session too short" });
            if (run) completeRun(run, { sessionId, message: "Session too short" });
          }
          ws.close();
        }
      } catch (err) {
        console.error("[training/ws]", err);
        send("error", { message: err.message });
      }
    });
    ws.on("close", () => { if (sttConnection) { try { sttConnection.close(); } catch (_) {} } });
  });
}

// ─── Live stream training endpoint ───────────────────────────────────────────

/**
 * POST /api/adaptive/training/stream/start
 * Starts a live microphone/device stream training session.
 * The client sends audio chunks via POST /api/adaptive/training/stream/chunk.
 * Each chunk is transcribed via OpenAI Whisper and added to the training session.
 * Finalize via POST /api/adaptive/training/stream/end
 */
export async function startLiveStream(req, res) {
  const { subject } = req.body;
  const teacherId = req.user?.id;   // caller trains their own agent — no body override
  if (!teacherId) return res.status(400).json({ error: "auth required" });

  const { data: session, error } = await db.schema("edu").from("training_sessions").insert({
    teacher_id:    teacherId,
    source_type:   "live_stream",
    subject:       subject ?? "General",
    status:        "processing",
    file_count:    0,
    total_chunks:  0,
    started_at:    new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Store session in Redis for chunk accumulation
  try {
    const redis = (await import("../../learner-state/index.js")).getRedis();
    await redis.setex(
      `live_stream:${session.id}`,
      3600,
      JSON.stringify({ sessionId: session.id, teacherId, subject, chunks: [], startedAt: Date.now() })
    );
  } catch (e) {
    console.warn("[training/stream] Redis cache failed:", e.message);
  }

  res.status(201).json({ session_id: session.id, status: "streaming", message: "Send audio chunks to /api/adaptive/training/stream/chunk" });
}

/**
 * POST /api/adaptive/training/stream/chunk
 * Receives a raw audio chunk (base64 or buffer) from the client.
 * Transcribes via OpenAI Whisper and appends text to the live session.
 */
export async function receiveChunk(req, res) {
  const { session_id, audio_base64, text } = req.body;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  let transcribed = text ?? "";

  // If audio provided, transcribe (Deepgram primary, Whisper fallback)
  if (audio_base64 && !text) {
    try {
      const buffer = Buffer.from(audio_base64, "base64");
      if (hasDeepgram()) {
        ({ transcript: transcribed } = await transcribeBufferDeepgram(buffer));
      } else {
        const result = await openai.audio.transcriptions.create({
          file:     await toFile(buffer, "chunk.webm"),
          model:    "whisper-1",
          language: "en",
        });
        transcribed = result.text ?? "";
      }
    } catch (e) {
      console.warn("[training/stream] transcription failed:", e.message);
      return res.status(500).json({ error: "Transcription failed: " + e.message });
    }
  }

  if (!transcribed.trim()) return res.json({ received: true, transcribed: "" });

  // Append to Redis session
  try {
    const redis = (await import("../../learner-state/index.js")).getRedis();
    const raw   = await redis.get(`live_stream:${session_id}`);
    if (raw) {
      const state = JSON.parse(raw);
      state.chunks.push({ text: transcribed, ts: Date.now() });
      await redis.setex(`live_stream:${session_id}`, 3600, JSON.stringify(state));
    }
  } catch (e) {
    console.warn("[training/stream] Redis append failed:", e.message);
  }

  res.json({ received: true, transcribed, length: transcribed.length });
}

/**
 * POST /api/adaptive/training/stream/end
 * Finalises the live stream session.
 * Concatenates all chunks → runs through the training pipeline.
 */
export async function endLiveStream(req, res) {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  let fullText = "";
  let teacherId, subject;

  try {
    const redis = (await import("../../learner-state/index.js")).getRedis();
    const raw   = await redis.get(`live_stream:${session_id}`);
    if (raw) {
      const state = JSON.parse(raw);
      fullText  = state.chunks.map((c) => c.text).join(" ");
      teacherId = state.teacherId;
      subject   = state.subject;
      await redis.del(`live_stream:${session_id}`);
    }
  } catch (e) {
    console.warn("[training/stream] Redis read failed:", e.message);
  }

  if (!fullText.trim()) {
    await db.schema("edu").from("training_sessions").update({ status: "failed" }).eq("id", session_id);
    return res.status(400).json({ error: "No audio content received — session empty" });
  }

  // Store transcript as a training chunk and finish
  await db.schema("edu").from("training_sessions").update({
    status:       "completed",
    total_chunks: 1,
    completed_at: new Date().toISOString(),
  }).eq("id", session_id);

  try {
    await db.schema("edu").from("stream_tokens").insert({
      session_id,
      token_text:  fullText,
      token_index: 0,
    });
  } catch {}

  res.json({
    session_id,
    status:           "completed",
    transcript_words: fullText.split(/\s+/).length,
    message:          "Live stream session processed. Run /api/adaptive/training/start to embed into agent.",
  });
}
