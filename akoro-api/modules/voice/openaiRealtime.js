/**
 * voice/openaiRealtime.js
 * ─────────────────────────────────────────────────────────────
 * OpenAI Realtime TRANSCRIPTION client.
 *
 * Audio in: base64 PCM16 mono @ 24kHz (input_audio_buffer.append).
 *
 * createRealtimeTranscriber({ onOpen, onDelta, onCompleted,
 *   onSpeechStarted, onSpeechStopped, onError, onClose })
 *   → { sendAudio(base64), close() }
 *
 * WHY THE URL HAS NO ?model=
 *
 * It used to, and that was the bug that made voice look broken in the teaching
 * session for months. A `model` query parameter tells the realtime endpoint to
 * open a CONVERSATION session; the transcription config we then send is not
 * valid for one, so the server rejects it — the socket opens, the client is
 * told it is ready, it streams audio into a session that will never transcribe,
 * and the only symptom is silence. The model belongs in the session payload,
 * never in the URL.
 *
 * The old comment in this file asserted the opposite — that ?intent=transcription
 * had been "removed in GA". It had not. Nothing tested it because testing it
 * needs a live key, and the failure was silent on every layer above.
 */

// Transcription-only session. No ?model= — see above.
// Overridable so the handshake can be pointed at a stand-in and actually
// tested; the state machine below is what broke, and it was untestable while
// the endpoint was hard-coded.
const REALTIME_URL = process.env.REALTIME_STT_URL
  || "wss://api.openai.com/v1/realtime?intent=transcription";

/** How long to wait for the session to be CONFIGURED before giving up. */
const CONFIG_TIMEOUT_MS = 8000;

export function createRealtimeTranscriber({
  onOpen          = () => {},
  onDelta         = () => {},   // (text)  — partial transcript of current utterance
  onCompleted     = () => {},   // (text)  — finalized utterance transcript
  onSpeechStarted = () => {},
  onSpeechStopped = () => {},
  onError         = () => {},
  onClose         = () => {},
  model           = process.env.REALTIME_STT_MODEL || "gpt-4o-mini-transcribe",
} = {}) {
  if (!process.env.OPENAI_API_KEY) {
    // Said immediately rather than as a websocket failure thirty seconds later.
    queueMicrotask(() => onError(new Error("Voice transcription is not configured on the server.")));
    return { sendAudio() {}, close() {} };
  }

  const ws = new WebSocket(REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let closed    = false;
  let ready     = false;   // session.updated seen — safe to send audio
  let configTimer = null;

  ws.addEventListener("open", () => {
    // GA transcription session shape: everything lives under audio.input.
    // The pre-GA flat form (modalities / input_audio_format /
    // input_audio_transcription at the top of `session`) is silently ignored,
    // which is the other half of why this produced no transcript and no error
    // anyone could see.
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model, language: "en" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
            noise_reduction: { type: "near_field" },
          },
        },
      },
    }));

    // NOT ready yet. onOpen used to fire here, on the socket opening, so the
    // client started streaming into a session that had not been configured and
    // might never be. Ready means configured.
    configTimer = setTimeout(() => {
      if (!ready && !closed) {
        onError(new Error("Voice transcription did not start — the session was never confirmed."));
        try { ws.close(); } catch { /* already going */ }
      }
    }, CONFIG_TIMEOUT_MS);
  });

  ws.addEventListener("message", (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      // The session is configured; only now is it worth sending audio.
      case "session.updated":
      case "transcription_session.updated":
        if (!ready) {
          ready = true;
          clearTimeout(configTimer);
          onOpen();
        }
        break;

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
        // Carry the provider's own wording through. "invalid_model" would have
        // named this bug on the first attempt if anything had been listening.
        onError(new Error(msg.error?.message || msg.error?.code || "Realtime transcription error"));
        break;
    }
  });

  ws.addEventListener("error", (e) => {
    if (!closed) onError(e.error || new Error("Realtime WebSocket error"));
  });

  ws.addEventListener("close", (e) => {
    clearTimeout(configTimer);
    // A rejected handshake closes with the reason in it — 401 for a bad key,
    // an invalid-model message for the wrong URL. Throwing that away is why
    // this was diagnosed by reading documentation rather than by reading logs.
    if (!closed && !ready) {
      onError(new Error(
        `Voice transcription closed before it started${e?.code ? ` (${e.code})` : ""}${e?.reason ? `: ${e.reason}` : ""}`));
    }
    closed = true;
    onClose();
  });

  return {
    sendAudio(base64) {
      // Gated on `ready`, not just on the socket being open: audio sent before
      // the session is configured is discarded by the server, so the first
      // words of every utterance would vanish.
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64 }));
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(configTimer);
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}
