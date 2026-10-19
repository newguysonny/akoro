// Read-aloud (text to speech) through its real route, as a test learner
// (risk: write — one small TTS charge). Deepgram Aura speaks; OpenAI is only
// the fallback, so a fallback line in the server log fails the check.
import { readLogs, logSeq } from "../../../lib/logTap.js";

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
