/**
 * modules/voice/deepgramLive.js — live transcription for the voice socket on
 * Deepgram streaming (wss /v1/listen), the same shape as openaiRealtime.js:
 *
 *   createDeepgramTranscriber({ onOpen, onInterim, onCompleted,
 *     onSpeechStarted, onSpeechStopped, onError, onClose })
 *   → { sendAudio(base64), close() }
 *
 * Audio in: base64 PCM16 mono @ 24 kHz — what the client already sends.
 * Deepgram sends the WHOLE interim text of the current segment each time
 * (onInterim replaces, unlike OpenAI's deltas), final segments (onCompleted),
 * SpeechStarted, and UtteranceEnd after a pause (onSpeechStopped).
 * A KeepAlive goes out while no audio flows, or Deepgram closes after ~10 s.
 *
 * Env: DEEPGRAM_API_KEY; DEEPGRAM_LIVE_MODEL (default nova-3); DEEPGRAM_LIVE_LANGUAGE (default en).
 */
import WebSocket from "ws";

export const LIVE = Object.freeze({ SAMPLE_RATE: 24000, UTTERANCE_END_MS: 1200, ENDPOINTING_MS: 300, KEEPALIVE_MS: 8000 });

export function deepgramLiveUrl(env = process.env) {
  const q = new URLSearchParams({
    model: env.DEEPGRAM_LIVE_MODEL || "nova-3", language: env.DEEPGRAM_LIVE_LANGUAGE || "en",
    encoding: "linear16", sample_rate: String(LIVE.SAMPLE_RATE), channels: "1",
    interim_results: "true", smart_format: "true", punctuate: "true",
    vad_events: "true", utterance_end_ms: String(LIVE.UTTERANCE_END_MS), endpointing: String(LIVE.ENDPOINTING_MS),
  });
  return `wss://api.deepgram.com/v1/listen?${q}`;
}

/** One Deepgram message → what the voice socket hears. Pure (the tests feed it messages). */
export function readDeepgramMessage(raw) {
  let m;
  try { m = JSON.parse(String(raw)); } catch { return null; }
  if (m.type === "SpeechStarted") return { kind: "speech_started" };
  if (m.type === "UtteranceEnd") return { kind: "utterance_end" };
  if (m.type === "Results") {
    const text = String(m.channel?.alternatives?.[0]?.transcript || "").trim();
    if (m.is_final) return text ? { kind: "final", text } : null;
    return { kind: "interim", text };
  }
  if (m.type === "Error" || m.err_code) return { kind: "error", message: m.description || m.err_msg || m.message || "Deepgram transcription error" };
  return null;
}

export function createDeepgramTranscriber({
  onOpen = () => {}, onInterim = () => {}, onCompleted = () => {},
  onSpeechStarted = () => {}, onSpeechStopped = () => {}, onError = () => {}, onClose = () => {},
  env = process.env, WS = WebSocket,
} = {}) {
  if (!env.DEEPGRAM_API_KEY) {
    queueMicrotask(() => onError(new Error("Deepgram is not configured on the server.")));
    return { sendAudio() {}, close() {} };
  }
  const ws = new WS(deepgramLiveUrl(env), { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } });
  let closed = false;
  let open = false;
  let lastAudio = Date.now();
  const keepAlive = setInterval(() => {
    if (open && !closed && Date.now() - lastAudio > LIVE.KEEPALIVE_MS - 1000) {
      try { ws.send(JSON.stringify({ type: "KeepAlive" })); } catch { /* closing */ }
    }
  }, LIVE.KEEPALIVE_MS);
  keepAlive.unref?.();

  ws.on("open", () => { open = true; onOpen(); });
  ws.on("message", (raw) => {
    const ev = readDeepgramMessage(raw);
    if (!ev) return;
    if (ev.kind === "interim") onInterim(ev.text);
    else if (ev.kind === "final") onCompleted(ev.text);
    else if (ev.kind === "speech_started") onSpeechStarted();
    else if (ev.kind === "utterance_end") onSpeechStopped();
    else if (ev.kind === "error") onError(new Error(ev.message));
  });
  ws.on("error", (err) => { if (!closed) onError(Object.assign(err instanceof Error ? err : new Error(String(err)), { beforeOpen: !open })); });
  ws.on("close", () => { closed = true; clearInterval(keepAlive); onClose(); });

  return {
    sendAudio(base64) {
      if (!open || closed || !base64) return;
      lastAudio = Date.now();
      ws.send(Buffer.from(base64, "base64"));
    },
    close() {
      if (closed) return;
      // Ask Deepgram to flush the last words, then close.
      try { if (open) ws.send(JSON.stringify({ type: "CloseStream" })); } catch { /* already gone */ }
      setTimeout(() => { try { ws.close(); } catch { /* already gone */ } }, 300).unref?.();
      clearInterval(keepAlive);
    },
  };
}
