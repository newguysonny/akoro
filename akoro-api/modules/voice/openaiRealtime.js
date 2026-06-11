/**
 * voice/openaiRealtime.js
 * ─────────────────────────────────────────────────────────────
 * Shared OpenAI Realtime transcription client (replaces Deepgram live).
 * Uses Node 22's native WebSocket — no extra dependency.
 *
 * Audio in: base64 PCM16 mono @ 24kHz (input_audio_buffer.append).
 *
 * createRealtimeTranscriber({ onOpen, onDelta, onCompleted,
 *   onSpeechStarted, onSpeechStopped, onError, onClose })
 *   → { sendAudio(base64), close() }
 */

const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

export function createRealtimeTranscriber({
  onOpen          = () => {},
  onDelta         = () => {},   // (text)  — partial transcript of current utterance
  onCompleted     = () => {},   // (text)  — finalized utterance transcript
  onSpeechStarted = () => {},
  onSpeechStopped = () => {},
  onError         = () => {},
  onClose         = () => {},
} = {}) {
  const ws = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization:  `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta":  "realtime=v1",
    },
  });

  let closed = false;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      type: "transcription_session.update",
      session: {
        input_audio_format: "pcm16",
        input_audio_transcription: {
          model:    "gpt-4o-mini-transcribe",
          language: "en",
        },
        turn_detection: {
          type:                "server_vad",
          threshold:           0.5,
          prefix_padding_ms:   300,
          silence_duration_ms: 700,
        },
        input_audio_noise_reduction: { type: "near_field" },
      },
    }));
    onOpen();
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (msg.delta) onDelta(msg.delta);
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (msg.transcript?.trim()) onCompleted(msg.transcript.trim());
        break;
      case "input_audio_buffer.speech_started":
        onSpeechStarted();
        break;
      case "input_audio_buffer.speech_stopped":
        onSpeechStopped();
        break;
      case "error":
        onError(new Error(msg.error?.message || "Realtime transcription error"));
        break;
    }
  });

  ws.addEventListener("error", (e) => {
    if (!closed) onError(e.error || new Error("Realtime WebSocket error"));
  });

  ws.addEventListener("close", () => {
    closed = true;
    onClose();
  });

  return {
    sendAudio(base64) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
    },
    close() {
      if (closed) return;
      closed = true;
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}
