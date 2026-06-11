/**
 * voice/streaming.js
 * ─────────────────────────────────────────────────────────────
 * Realtime voice streaming via OpenAI Realtime transcription (STT)
 * + streaming TTS via OpenAI tts-1 (TTS). Single OPENAI_API_KEY.
 *
 * STT events (client → server):
 *   start_voice_stream          — open OpenAI realtime connection
 *   voice_audio_chunk { audio } — base64 PCM16 mono 24kHz chunk
 *   stop_voice_stream           — close connection, emit voice_complete
 *
 * STT events (server → client):
 *   voice_stream_ready          — realtime connection open, start sending chunks
 *   voice_interim  { text, accumulated }   — word forming (grey text)
 *   voice_final    { text, accumulated }   — sentence confirmed (black text)
 *   voice_utterance_end { transcript }     — silence gap detected
 *   voice_complete { transcript }          — stream closed, full text ready
 *   voice_error    { message }             — transcription error
 *
 * TTS events (client → server):
 *   start_tts_stream  { text, voice, seq } — begin streaming TTS audio
 *   stop_tts_stream                        — abort current TTS (barge-in)
 *
 * TTS events (server → client):
 *   tts_audio_chunk { chunk, seq }  — base64 MP3 chunk
 *   tts_stream_done { seq }         — stream complete
 *   tts_stream_stopped              — stream aborted on request
 *   tts_error { message }           — TTS failure
 */

import OpenAI from "openai";
import { createRealtimeTranscriber } from "./openaiRealtime.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VALID_VOICES = ["alloy","echo","fable","onyx","nova","shimmer"];

// socketId → { live: RealtimeTranscriber, transcript: string }
const liveConnections = new Map();

// socketId → AbortController (for barge-in TTS cancellation)
const ttsStreams = new Map();

function closeLiveConnection(socketId) {
  const conn = liveConnections.get(socketId);
  if (conn?.live) {
    try { conn.live.close(); } catch { /* already closed */ }
  }
  liveConnections.delete(socketId);
}

export function setupVoiceStreaming(io) {

  io.on("connection", (socket) => {

    /* ── start_voice_stream ──────────────────────────────────────── */
    socket.on("start_voice_stream", async () => {
      // Close any leftover connection for this socket
      closeLiveConnection(socket.id);

      let accumulated = "";
      let interim     = "";   // partial of the current utterance

      const live = createRealtimeTranscriber({
        onOpen: () => {
          // Tell frontend OpenAI is ready — start sending audio chunks
          socket.emit("voice_stream_ready");
        },
        onDelta: (delta) => {
          // Interim — words still forming, show as grey ghost text
          interim += delta;
          socket.emit("voice_interim", { text: interim, accumulated });
        },
        onCompleted: (text) => {
          // Final — utterance complete, add to accumulator
          interim     = "";
          accumulated = accumulated ? `${accumulated} ${text}` : text;

          const conn = liveConnections.get(socket.id);
          if (conn) conn.transcript = accumulated;

          socket.emit("voice_final", { text, accumulated });
        },
        onSpeechStarted: () => {
          socket.emit("voice_speech_started");
        },
        onSpeechStopped: () => {
          // Silence gap detected — interim trigger for auto-submit if desired
          const conn = liveConnections.get(socket.id);
          if (conn?.transcript) {
            socket.emit("voice_utterance_end", { transcript: conn.transcript });
          }
        },
        onError: (err) => {
          console.error(`[voice/streaming] socket=${socket.id}`, err);
          socket.emit("voice_error", {
            message: err?.message || "Transcription error",
          });
          closeLiveConnection(socket.id);
        },
        onClose: () => {
          liveConnections.delete(socket.id);
        },
      });

      liveConnections.set(socket.id, { live, transcript: "" });
    });

    /* ── voice_audio_chunk ───────────────────────────────────────── */
    socket.on("voice_audio_chunk", ({ audio }) => {
      const conn = liveConnections.get(socket.id);
      if (!conn?.live) return;

      try {
        conn.live.sendAudio(audio);   // base64 PCM16 mono 24kHz
      } catch (err) {
        console.warn("[voice_audio_chunk]", err.message);
      }
    });

    /* ── stop_voice_stream ───────────────────────────────────────── */
    socket.on("stop_voice_stream", () => {
      const conn    = liveConnections.get(socket.id);
      const final   = conn?.transcript?.trim() || "";
      closeLiveConnection(socket.id);

      socket.emit("voice_complete", { transcript: final });
    });

    /* ── start_tts_stream ───────────────────────────────────────── */
    socket.on("start_tts_stream", async ({ text, voice, seq }) => {
      // Cancel any in-progress TTS for this socket (previous turn barge-in)
      const existing = ttsStreams.get(socket.id);
      if (existing) { existing.abort(); ttsStreams.delete(socket.id); }

      if (!text?.trim()) return;
      const ttsVoice = VALID_VOICES.includes(voice) ? voice : "alloy";
      const controller = new AbortController();
      ttsStreams.set(socket.id, controller);

      try {
        const response = await openai.audio.speech.create({
          model:           "tts-1",
          voice:           ttsVoice,
          input:           text.slice(0, 4096),
          response_format: "mp3",
        });

        // Pipe the ReadableStream body as base64 chunks
        for await (const chunk of response.body) {
          if (controller.signal.aborted) break;
          socket.emit("tts_audio_chunk", {
            chunk: Buffer.from(chunk).toString("base64"),
            seq,
          });
        }

        if (!controller.signal.aborted) {
          socket.emit("tts_stream_done", { seq });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(`[tts/stream] socket=${socket.id}`, err.message);
          socket.emit("tts_error", { message: err.message });
        }
      } finally {
        ttsStreams.delete(socket.id);
      }
    });

    /* ── stop_tts_stream (barge-in) ──────────────────────────────── */
    socket.on("stop_tts_stream", () => {
      const ctrl = ttsStreams.get(socket.id);
      if (ctrl) { ctrl.abort(); ttsStreams.delete(socket.id); }
      socket.emit("tts_stream_stopped");
    });

    /* ── cleanup on disconnect ───────────────────────────────────── */
    socket.on("disconnect", () => {
      const ctrl = ttsStreams.get(socket.id);
      if (ctrl) ctrl.abort();
      ttsStreams.delete(socket.id);
      closeLiveConnection(socket.id);
    });
  });
}
