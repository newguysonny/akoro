/**
 * modules/voice/liveTranscriber.js — which provider transcribes the voice
 * socket live. No db: streaming.js and the tests both use it.
 */
import { createRealtimeTranscriber } from "./openaiRealtime.js";
import { createDeepgramTranscriber } from "./deepgramLive.js";

/**
 * Live transcription: Deepgram streaming first; OpenAI Realtime only as the
 * fallback — when Deepgram isn't set up, or fails before its socket opens.
 * `cb` takes both shapes: onInterim (Deepgram, whole text) and onDelta (OpenAI).
 * → { sendAudio, close, provider() }
 */
export function createLiveTranscriber(cb, { env = process.env, deepgram = createDeepgramTranscriber, openai = createRealtimeTranscriber, log = console } = {}) {
  let provider = null;
  let inner = null;
  const useOpenAI = () => {
    provider = "openai";
    inner = openai({ ...cb });
  };
  if (env.DEEPGRAM_API_KEY) {
    provider = "deepgram";
    inner = deepgram({
      ...cb,
      onError: (err) => {
        if (err?.beforeOpen && env.OPENAI_API_KEY && provider === "deepgram") {
          log.warn?.(`[voice/streaming] Deepgram live failed before opening, falling back to OpenAI: ${String(err?.message || err).slice(0, 160)}`);
          try { inner?.close(); } catch { /* already closed */ }
          useOpenAI();
          return;
        }
        cb.onError?.(err);
      },
      // A Deepgram socket we left for the fallback must not report "closed".
      onClose: () => { if (provider === "deepgram") cb.onClose?.(); },
    });
  } else {
    useOpenAI();
  }
  return {
    sendAudio: (b64) => inner?.sendAudio(b64),
    close: () => inner?.close(),
    provider: () => provider,
  };
}
