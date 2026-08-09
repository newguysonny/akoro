/**
 * utils/micCapture.js — one microphone capture, used everywhere.
 *
 * There were two. useVoiceSession.js had a correct one; TeachAgentModal.jsx had
 * its own inline copy that did this:
 *
 *     new AudioContext({ sampleRate: 24000 })
 *
 * with no fallback and no resampling. That fails two ways, and the teaching
 * session hit both:
 *
 *  · Mobile browsers reject a custom sampleRate outright. The constructor
 *    throws, the whole try block unwinds into `catch { console.warn(...) }`,
 *    and voice streaming is never switched on. Tapping the mic did nothing at
 *    all — no error, no state change, one line in a console nobody has open.
 *
 *  · Where the browser instead IGNORES the request and hands back a 48kHz
 *    context, the samples are sent as-is and declared to be 24kHz. The server
 *    transcribes audio running at half speed, which returns either nonsense or
 *    nothing. That one looks like a transcription problem rather than a capture
 *    problem, which is why it survived so long.
 *
 * The working copy asks for 24k, accepts whatever it gets, and downsamples each
 * buffer before sending. This file is that copy, extracted — so there is no
 * second implementation left to drift.
 *
 * It also reports a level, which neither copy did: a mic with no meter cannot
 * be told apart from a mic that is not working, and "is it hearing me?" is the
 * first question anyone asks.
 */

const TARGET_RATE = 24000;   // what the realtime transcriber expects

/** Average-and-decimate down to TARGET_RATE. Averaging, not sampling, so
 *  high-frequency content folds down instead of aliasing into a whistle. */
function downsample(buf, fromRate) {
  if (fromRate === TARGET_RATE) return buf;
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.round(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.round(i * ratio);
    const end = Math.min(buf.length, Math.round((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = start; j < end; j++) { sum += buf[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Float32 → base64 PCM16, chunked so a long buffer cannot blow the arg limit. */
function toBase64PCM16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const bytes = new Uint8Array(i16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

/**
 * Open the mic and stream PCM16 @24k.
 *
 * @param {object}   o
 * @param {Function} o.onChunk  (base64) => void — only called when `isReady()` is true
 * @param {Function} [o.isReady] gate, so audio is not sent before the server is listening
 * @param {Function} [o.onLevel] (0..1) => void, ~20fps, for the meter
 * @returns {Promise<{stop: Function, sampleRate: number}>}
 * @throws  if the mic is denied or unavailable — callers must SHOW that, not swallow it
 */
export async function startMicCapture({ onChunk, isReady = () => true, onLevel = null }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  // Ask for 24k, take what we are given. Never let the request itself be fatal.
  try { ctx = new AC({ sampleRate: TARGET_RATE }); } catch { ctx = new AC(); }
  // Autoplay policy can hand back a suspended context even inside a gesture.
  if (ctx.state === "suspended") { try { await ctx.resume(); } catch { /* best effort */ } }

  const src  = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);

  let raf = null;
  let analyser = null;
  if (onLevel) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      // RMS around the 128 midpoint. Peak would spike on a door slam and read
      // full while someone is silent.
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      // Speech RMS sits low; scaled so ordinary talking fills most of the bar
      // rather than nudging the first segment.
      onLevel(Math.min(1, rms * 6));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  proc.onaudioprocess = (e) => {
    if (!isReady()) return;
    onChunk(toBase64PCM16(downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate)));
  };

  src.connect(proc);
  proc.connect(ctx.destination);

  return {
    sampleRate: ctx.sampleRate,
    stop() {
      if (raf) cancelAnimationFrame(raf);
      try { proc.disconnect(); src.disconnect(); analyser?.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      onLevel?.(0);
    },
  };
}
