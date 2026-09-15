/**
 * voice/streaming.js
 * ─────────────────────────────────────────────────────────────
 * Realtime voice streaming via Deepgram nova-2.
 * Acts as a server-side proxy between the client socket and
 * Deepgram's streaming API — API key never exposed to browser.
 *
 * Socket events (client → server):
 *   start_voice_stream          — open Deepgram live connection
 *   voice_audio_chunk { audio } — base64 PCM/webm chunk (every 250ms)
 *   stop_voice_stream           — close connection, emit voice_complete
 *
 * Socket events (server → client):
 *   voice_stream_ready          — Deepgram connection open, start sending chunks
 *   voice_interim  { text, accumulated }   — word forming (grey text)
 *   voice_final    { text, accumulated }   — sentence confirmed (black text)
 *   voice_utterance_end { transcript }     — silence gap detected
 *   voice_complete { transcript }          — stream closed, full text ready
 *   voice_error    { message }             — transcription error
 */

import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

const dg = createClient(process.env.DEEPGRAM_API_KEY);

// socketId → { live: DeepgramLive, transcript: string }
const liveConnections = new Map();

function closeLiveConnection(socketId) {
  const conn = liveConnections.get(socketId);
  if (conn?.live) {
    try { conn.live.finish(); } catch { /* already closed */ }
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

      const live = dg.listen.live({
        model:            "nova-2",
        language:         "en",
        smart_format:     true,
        punctuate:        true,
        interim_results:  true,   // enables grey-text interim words
        utterance_end_ms: 1200,   // silence gap triggers utterance end
        vad_events:       true,   // voice activity detection
        encoding:         "linear16",
        sample_rate:      16000,
      });

      liveConnections.set(socket.id, { live, transcript: "" });

      live.on(LiveTranscriptionEvents.Open, () => {
        // Tell frontend Deepgram is ready — start sending audio chunks
        socket.emit("voice_stream_ready");
      });

      live.on(LiveTranscriptionEvents.Transcript, (data) => {
        const text = data.channel?.alternatives?.[0]?.transcript?.trim();
        if (!text) return;

        if (!data.is_final) {
          // Interim — words still forming, show as grey ghost text
          socket.emit("voice_interim", {
            text,
            accumulated,
          });
        } else {
          // Final — sentence complete, add to accumulator
          accumulated = accumulated
            ? `${accumulated} ${text}`
            : text;

          const conn = liveConnections.get(socket.id);
          if (conn) conn.transcript = accumulated;

          socket.emit("voice_final", {
            text,
            accumulated,
          });
        }
      });

      live.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        // Silence gap detected — interim trigger for auto-submit if desired
        const conn = liveConnections.get(socket.id);
        if (conn?.transcript) {
          socket.emit("voice_utterance_end", {
            transcript: conn.transcript,
          });
        }
      });

      live.on(LiveTranscriptionEvents.SpeechStarted, () => {
        socket.emit("voice_speech_started");
      });

      live.on(LiveTranscriptionEvents.Error, (err) => {
        console.error(`[voice/streaming] socket=${socket.id}`, err);
        socket.emit("voice_error", {
          message: err?.message || "Transcription error",
        });
        closeLiveConnection(socket.id);
      });

      live.on(LiveTranscriptionEvents.Close, () => {
        liveConnections.delete(socket.id);
      });
    });

    /* ── voice_audio_chunk ───────────────────────────────────────── */
    socket.on("voice_audio_chunk", ({ audio }) => {
      const conn = liveConnections.get(socket.id);
      if (!conn?.live) return;

      try {
        const buffer = Buffer.from(audio, "base64");
        conn.live.send(buffer);
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

    /* ── cleanup on disconnect ───────────────────────────────────── */
    socket.on("disconnect", () => {
      closeLiveConnection(socket.id);
    });
  });
}
