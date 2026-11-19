// Read-aloud (text to speech) through its real route, as a test learner
// (risk: write — one small TTS charge). Deepgram Aura speaks; OpenAI is only
// the fallback, so a fallback line in the server log fails the check.
import { readLogs, logSeq } from "../../../lib/logTap.js";
import { createDeepgramTranscriber } from "../../voice/index.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const voiceSpeak = {
  name: "voice.speak_deepgram", area: "voice", risk: "write",
  description: "Read-aloud returns MP3 audio spoken by Deepgram Aura, without falling back to OpenAI.",
  params: { learner: { default: "@tester17" } },
  async run(ctx, p) {
    const since = logSeq();
    const r = await ctx.http({ as: p.learner, method: "POST", path: "/api/voice/speak",
      body: { text: "Osmosis is the movement of water across a partially permeable membrane.", voice: "nova" } });
    const fellBack = readLogs({ since, filter: "[tts]" }).lines.map((l) => String(l.msg));
    for (const line of fellBack) ctx.note(`log: ${line.slice(0, 300)}`);
    ctx.expect.status("read-aloud answers 200", r, 200);
    ctx.expect.ok("…with MP3 audio", /audio\/mpeg/.test(r.headers?.["content-type"] || "") && String(r.body || "").length > 500, { type: r.headers?.["content-type"], bytes: String(r.body || "").length });
    ctx.expect.ok("…spoken by Deepgram (no OpenAI fallback)", !fellBack.some((l) => /falling back to OpenAI/.test(l)), fellBack);
  },
};

// Live transcription (the voice socket's STT) against real Deepgram: speech is
// made by Deepgram TTS as raw PCM16 mono 24 kHz — exactly what the app streams —
// and fed through the same client the socket uses, in real time.
export const voiceLive = {
  name: "voice.live_deepgram", area: "voice", risk: "write",
  description: "The voice socket's live transcription runs on Deepgram streaming: spoken audio in, the words back as interim and final text.",
  async run(ctx) {
    if (!process.env.DEEPGRAM_API_KEY) ctx.expect.blocked("DEEPGRAM_API_KEY is not set on this server");
    const sentence = "Osmosis is the movement of water across a partially permeable membrane.";
    const tts = await fetch("https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000&container=none", {
      method: "POST", headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence }),
    });
    if (!tts.ok) ctx.expect.blocked(`Deepgram TTS answered ${tts.status} — can't make test speech`);
    const pcm = Buffer.from(await tts.arrayBuffer());
    ctx.note(`speech: ${(pcm.length / 48000).toFixed(1)} s of PCM16 @ 24 kHz`);

    const got = { open: false, interim: [], finals: [], ended: false, errors: [] };
    const live = createDeepgramTranscriber({
      onOpen: () => { got.open = true; }, onInterim: (t) => got.interim.push(t), onCompleted: (t) => got.finals.push(t),
      onSpeechStopped: () => { got.ended = true; }, onError: (e) => got.errors.push(e.message),
    });
    for (let i = 0; i < 50 && !got.open && !got.errors.length; i++) await sleep(100);
    ctx.expect.ok("the Deepgram stream opens", got.open, got.errors);
    if (!got.open) return;
    const CHUNK = 4800;   // 100 ms
    for (let i = 0; i < pcm.length; i += CHUNK) { live.sendAudio(pcm.subarray(i, i + CHUNK).toString("base64")); await sleep(100); }
    live.sendAudio(Buffer.alloc(48000 * 2).toString("base64"));   // two seconds of silence: the utterance ends
    for (let i = 0; i < 40 && !got.ended; i++) await sleep(100);
    live.close();
    const text = got.finals.join(" ");
    ctx.note(`final: ${text}`);
    ctx.expect.ok("interim words arrive while speaking", got.interim.some((t) => t.trim()), got.interim.slice(0, 5));
    ctx.expect.ok("the final text is what was said", /osmosis/i.test(text) && /water/i.test(text) && /membrane/i.test(text), text);
    ctx.expect.ok("…and the pause ends the utterance", got.ended);
    ctx.expect.eq("no errors", got.errors.length, 0);
  },
};
