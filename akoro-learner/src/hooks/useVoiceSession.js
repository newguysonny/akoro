/**
 * useVoiceSession.js
 *
 * Reusable voice I/O over an existing Socket.IO connection, backed by the
 * server's voice streaming module (modules/voice/streaming.js):
 *
 *   Capture (STT):  start_voice_stream → voice_audio_chunk(PCM16@24k) → voice_complete
 *   Playback (TTS): start_tts_stream → tts_audio_chunk(base64 mp3) → tts_stream_done
 *
 * The caller supplies a ref to a connected socket and an onTranscript callback.
 * This hook owns the mic capture graph, the MediaSource playback pipeline, and
 * the seq guard that prevents stale audio from a previous turn playing over a
 * new one. It's transport-only — no assessment/teaching logic lives here.
 */

import { useRef, useState, useCallback, useEffect } from "react";

export function useVoiceSession({ wsRef, onTranscript, ttsVoice = "alloy" }) {
  const [listening, setListening] = useState(false);
  const [interim,   setInterim]   = useState("");
  const [speaking,  setSpeaking]  = useState(false);   // agent TTS is playing

  const captureRef  = useRef(null);   // { stop() }
  const readyRef    = useRef(false);  // server STT connection open
  const seqRef      = useRef(0);      // per-utterance guard for TTS

  // TTS pipeline refs
  const audioRef = useRef(null);
  const msRef    = useRef(null);
  const sbRef    = useRef(null);
  const queueRef = useRef([]);
  const doneRef  = useRef(false);

  /* ── TTS playback ────────────────────────────────────────── */
  // ONE persistent <audio> element for all utterances. Mobile autoplay policy
  // blocks .play() on an element that has never played from a user gesture —
  // creating a fresh Audio() per socket-driven utterance meant TTS was
  // silently blocked. primeAudio() unlocks this element during a real tap
  // (e.g. the voice-mode toggle); after that, replays on the SAME element are
  // allowed even when triggered by socket events.
  const ensureAudioEl = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.playsInline = true;
      a.addEventListener("ended", () => setSpeaking(false));
      a.addEventListener("pause", () => { if (a.ended || !a.src) setSpeaking(false); });
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const primeAudio = useCallback(() => {
    const a = ensureAudioEl();
    // Shortest valid silent WAV — played muted inside the gesture to unlock.
    a.muted = true;
    a.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
    a.play().then(() => { a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
  }, [ensureAudioEl]);

  const stopSpeaking = useCallback(() => {
    setSpeaking(false);
    wsRef.current?.emit("stop_tts_stream");
    if (audioRef.current) {
      audioRef.current.pause();
      try { URL.revokeObjectURL(audioRef.current.src); } catch {}
      audioRef.current.removeAttribute("src");
    }
    msRef.current = null; sbRef.current = null; queueRef.current = []; doneRef.current = false;
  }, [wsRef]);

  const speak = useCallback((text) => {
    if (!wsRef.current?.connected || !text) return;
    stopSpeaking();
    const seq = ++seqRef.current;

    const ms = new MediaSource();
    const audio = ensureAudioEl();
    msRef.current = ms; queueRef.current = []; doneRef.current = false;
    audio.src = URL.createObjectURL(ms);

    ms.addEventListener("sourceopen", () => {
      let sb;
      try { sb = ms.addSourceBuffer("audio/mpeg"); } catch { return; }
      sbRef.current = sb;
      const flush = () => { if (!sb.updating && queueRef.current.length) sb.appendBuffer(queueRef.current.shift()); };
      sb.addEventListener("updateend", () => {
        if (sbRef.current !== sb) return;
        if (queueRef.current.length) { flush(); return; }
        if (doneRef.current && !sb.updating) { try { ms.endOfStream(); } catch {} }
      });
      flush();
    }, { once: true });

    audio.play().catch(() => {});
    setSpeaking(true);
    wsRef.current.emit("start_tts_stream", { text, voice: ttsVoice, seq });
  }, [wsRef, ttsVoice, stopSpeaking, ensureAudioEl]);

  /* ── Mic capture (PCM16 mono @24k — what the server expects) ─ */
  const startListening = useCallback(async () => {
    if (listening) return;
    primeAudio();     // user gesture — unlock TTS playback for this session
    stopSpeaking();   // barge-in
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      // Prefer a 24k context (what the server expects); some mobile browsers
      // reject a custom sampleRate, so fall back to the device default and
      // downsample each buffer to 24k before sending.
      const AC = window.AudioContext || window.webkitAudioContext;
      let ctx;
      try { ctx = new AC({ sampleRate: 24000 }); } catch { ctx = new AC(); }
      const src  = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);

      const toRate = 24000;
      const downsample = (buf, fromRate) => {
        if (fromRate === toRate) return buf;
        const ratio = fromRate / toRate;
        const out = new Float32Array(Math.round(buf.length / ratio));
        for (let i = 0; i < out.length; i++) {
          const start = Math.round(i * ratio), end = Math.min(buf.length, Math.round((i + 1) * ratio));
          let sum = 0, n = 0;
          for (let j = start; j < end; j++) { sum += buf[j]; n++; }
          out[i] = n ? sum / n : 0;
        }
        return out;
      };

      proc.onaudioprocess = (e) => {
        if (!readyRef.current || !wsRef.current?.connected) return;
        const f32 = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate);
        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          const s = Math.max(-1, Math.min(1, f32[i]));
          i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(i16.buffer);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
        wsRef.current.emit("voice_audio_chunk", { audio: btoa(bin) });
      };

      src.connect(proc); proc.connect(ctx.destination);
      captureRef.current = {
        stop() {
          readyRef.current = false;
          try { proc.disconnect(); src.disconnect(); } catch {}
          stream.getTracks().forEach(t => t.stop());
          ctx.close().catch(() => {});
        },
      };

      wsRef.current?.emit("start_voice_stream");
      setListening(true); setInterim("");
    } catch {
      setListening(false);
    }
  }, [listening, wsRef, stopSpeaking, primeAudio]);

  const stopListening = useCallback(() => {
    captureRef.current?.stop(); captureRef.current = null;
    wsRef.current?.emit("stop_voice_stream");
    setListening(false);
  }, [wsRef]);

  /* ── Bind socket events (caller's socket is already connected) ─ */
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    const onReady    = () => { readyRef.current = true; };
    const onInterim  = ({ text, accumulated }) => setInterim((accumulated ? accumulated + " " : "") + text);
    const onFinal    = ({ accumulated }) => setInterim(accumulated);
    const onUttEnd   = ({ transcript }) => setInterim(transcript);
    const onComplete = ({ transcript }) => {
      setListening(false); setInterim("");
      if (transcript?.trim()) onTranscript?.(transcript.trim());
    };
    const onVoiceErr = () => { setListening(false); setInterim(""); };

    const onChunk = ({ chunk, seq }) => {
      if (seq !== seqRef.current) return;
      const bytes = Uint8Array.from(atob(chunk), c => c.charCodeAt(0));
      const sb = sbRef.current;
      if (!sb) { queueRef.current.push(bytes.buffer); return; }
      if (sb.updating) queueRef.current.push(bytes.buffer); else sb.appendBuffer(bytes.buffer);
    };
    const onTtsDone = ({ seq }) => {
      if (seq !== seqRef.current) return;
      doneRef.current = true;
      const sb = sbRef.current;
      if (sb && !sb.updating && !queueRef.current.length) { try { msRef.current?.endOfStream(); } catch {} }
    };

    ws.on("voice_stream_ready", onReady);
    ws.on("voice_interim", onInterim);
    ws.on("voice_final", onFinal);
    ws.on("voice_utterance_end", onUttEnd);
    ws.on("voice_complete", onComplete);
    ws.on("voice_error", onVoiceErr);
    ws.on("tts_audio_chunk", onChunk);
    ws.on("tts_stream_done", onTtsDone);

    return () => {
      ws.off("voice_stream_ready", onReady);
      ws.off("voice_interim", onInterim);
      ws.off("voice_final", onFinal);
      ws.off("voice_utterance_end", onUttEnd);
      ws.off("voice_complete", onComplete);
      ws.off("voice_error", onVoiceErr);
      ws.off("tts_audio_chunk", onChunk);
      ws.off("tts_stream_done", onTtsDone);
    };
  }, [wsRef, onTranscript]);

  // Cleanup on unmount.
  useEffect(() => () => { captureRef.current?.stop(); stopSpeaking(); }, [stopSpeaking]);

  return { listening, interim, speaking, startListening, stopListening, speak, stopSpeaking, primeAudio };
}
