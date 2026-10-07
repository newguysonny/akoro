/**
 * voice/routes.js
 * ─────────────────────────────────────────────────────────────
 * Push-to-talk voice pipeline for teaching sessions.
 *
 * POST /api/voice/transcribe  — audio → OpenAI Whisper STT → transcript
 * POST /api/voice/speak       — text  → OpenAI TTS → audio stream
 * POST /api/voice/reply       — audio → STT → (session) → TTS → full response
 * POST /api/voice/agent-token — mint a Deepgram token for the realtime
 *                                Agent (speech-to-speech) voice chat widget
 */

import { Router }        from "express";
import OpenAI, { toFile } from "openai";
import multer            from "multer";
import { authenticateToken } from "../auth/routes.js";
import { transcribeBufferDeepgram, hasDeepgram, grantAgentToken } from "./deepgram.js";
import { tutorSystemPrompt } from "../adaptive-learning/chat.js";
import { loadDoctrine } from "../agent-context/context-manager.js";
import { coinsAvailable, debitCoins, InsufficientCoins } from "../../lib/coins.js";
import { getAiBillTo } from "../../lib/aiContext.js";
import { estimateAudioMinutes, coinsForSttMinutes, coinsForTtsChars } from "../../lib/aiPricing.js";

const router  = Router();
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_VOICES = ["alloy","echo","fable","onyx","nova","shimmer"];

// Hard-block voice AI when the funding wallet is empty (402 → prompt a top-up).
// billTo (school portal → school account) comes from the AI context set in
// authenticateToken; else the user's own hybrid wallet.
async function ensureVoiceCoins(req, res) {
  const { ok } = await coinsAvailable({ userId: req.user.id, billTo: getAiBillTo(), min: 1 });
  if (!ok) { res.status(402).json({ error: "Insufficient coin balance", code: "INSUFFICIENT_COINS" }); return false; }
  return true;
}
// Fire-and-forget debit so a billing hiccup never fails the voice response.
function chargeVoice(userId, feature, model, coins) {
  debitCoins({ userId, coins, feature, model, billTo: getAiBillTo() }).catch((e) => {
    if (!(e instanceof InsufficientCoins)) console.warn("[coins] voice charge failed:", e.message);
  });
}

/* ══════════════════════════════════════════════════════════════
   POST /api/voice/transcribe
   Receives: multipart/form-data { audio: <file>, language?: "en" }
   Returns:  { transcript, confidence, words[], duration }
   STT: OpenAI whisper-1
══════════════════════════════════════════════════════════════ */
router.post("/transcribe", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    if (!(await ensureVoiceCoins(req, res))) return;
    const language = req.body.language || "en";

    let transcript, words, duration;
    const model = hasDeepgram() ? "deepgram" : "whisper-1";
    if (hasDeepgram()) {
      ({ transcript, words, duration } = await transcribeBufferDeepgram(req.file.buffer, { language }));
    } else {
      const result = await openai.audio.transcriptions.create({
        file:     await toFile(req.file.buffer, req.file.originalname || "audio.webm"),
        model:    "whisper-1",
        language,
        response_format:         "verbose_json",
        timestamp_granularities: ["word"],
      });
      transcript = result.text?.trim() || "";
      words      = (result.words || []).map(w => ({ word: w.word, start: w.start, end: w.end }));
      duration   = result.duration ?? 0;
    }

    const minutes = duration > 0 ? duration / 60 : estimateAudioMinutes(req.file.buffer.length);
    chargeVoice(req.user.id, "voice_stt", model, coinsForSttMinutes(model, minutes));
    res.json({ success: true, transcript, confidence: transcript ? 1 : 0, words, duration });

  } catch (err) {
    console.error("[voice/transcribe]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/voice/speak
   Receives: { text, voice?, speed? }
   Returns:  audio/mpeg stream
   TTS: OpenAI tts-1
   voice defaults to "alloy" if not provided or invalid
══════════════════════════════════════════════════════════════ */
router.post("/speak", authenticateToken, async (req, res) => {
  try {
    const { text, voice, speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: "text required" });
    if (!(await ensureVoiceCoins(req, res))) return;

    // Default to alloy if voice is not set or invalid
    const ttsVoice = VALID_VOICES.includes(voice) ? voice : "alloy";
    const input = text.slice(0, 4096);   // OpenAI TTS limit

    const mp3 = await openai.audio.speech.create({
      model:  "tts-1",
      voice:  ttsVoice,
      input,
      speed:  Math.min(2.0, Math.max(0.25, speed)),
    });

    chargeVoice(req.user.id, "voice_tts", "tts-1", coinsForTtsChars("tts-1", input.length));
    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-cache");
    res.send(buffer);

  } catch (err) {
    console.error("[voice/speak]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/voice/reply
   Full voice pipeline: audio → STT → transcript text
   Returns: { transcript, text } — frontend uses transcript to
   send as teaching message via existing WS flow.
   TTS is handled separately by the frontend after receiving
   turn_complete blocks.
══════════════════════════════════════════════════════════════ */
router.post("/reply", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    if (!(await ensureVoiceCoins(req, res))) return;

    // STT — Deepgram (falls back to OpenAI Whisper if no key)
    let transcript;
    const model = hasDeepgram() ? "deepgram" : "whisper-1";
    if (hasDeepgram()) {
      ({ transcript } = await transcribeBufferDeepgram(req.file.buffer));
    } else {
      const result = await openai.audio.transcriptions.create({
        file:     await toFile(req.file.buffer, req.file.originalname || "audio.webm"),
        model:    "whisper-1",
        language: "en",
      });
      transcript = result.text?.trim() || "";
    }
    chargeVoice(req.user.id, "voice_stt", model, coinsForSttMinutes(model, estimateAudioMinutes(req.file.buffer.length)));
    if (!transcript) return res.json({ success: true, transcript: "", text: "" });

    res.json({ success: true, transcript, text: transcript });

  } catch (err) {
    console.error("[voice/reply]", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   POST /api/voice/agent-token
   Mints a short-lived Deepgram token so the client can open the
   realtime Agent (speech-to-speech) WebSocket directly, plus the
   role-aware tutor prompt/greeting to configure that session.
   Returns: { access_token, prompt, greeting, agentName }
══════════════════════════════════════════════════════════════ */
router.post("/agent-token", authenticateToken, async (req, res) => {
  try {
    if (!hasDeepgram()) return res.status(503).json({ error: "Voice chat is not configured" });

    const role = req.user?.role === "student" ? "student" : "instructor";
    const firstName = (req.user?.fullName || "").split(" ")[0] || "";

    let token;
    try {
      token = await grantAgentToken();
    } catch (err) {
      // Surface the real Deepgram reason (e.g. FORBIDDEN) so the cause is clear.
      console.error("[voice/agent-token] grant failed:", err.message);
      return res.status(502).json({
        error: `Voice chat could not start: ${err.message}. The Deepgram API key needs permission to grant tokens (or set DEEPGRAM_ALLOW_RAW_KEY=true).`,
      });
    }
    if (!token?.access_token) return res.status(502).json({ error: "Could not start voice session" });

    res.json({
      success: true,
      access_token: token.access_token,
      token_type: token.token_type,
      agentName: "Akoro",
      greeting: `Hi${firstName ? " " + firstName : ""}! I'm your school's AI study assistant. Ask me anything — go ahead, I'm listening.`,
      // P1 (Context Layer Adoption): the chat persona loads from the
      // akoro-agent/ workspace (tutorSystemPrompt is async now); the speech
      // channel rules live in channels/SPEECH.md.
      prompt: (await tutorSystemPrompt({ agentName: "Akoro", role }))
        + " " + (await loadDoctrine("channels/SPEECH.md")),
    });
  } catch (err) {
    console.error("[voice/agent-token]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
