/**
 * voice/routes.js
 * ─────────────────────────────────────────────────────────────
 * Push-to-talk voice pipeline for teaching sessions.
 *
 * POST /api/voice/transcribe  — audio → Deepgram STT → transcript
 * POST /api/voice/speak       — text  → OpenAI TTS → audio stream
 * POST /api/voice/reply       — audio → STT → (session) → TTS → full response
 */

import { Router }       from "express";
import { createClient } from "@deepgram/sdk";
import OpenAI           from "openai";
import multer           from "multer";
import { authenticateToken } from "../auth/routes.js";

const router  = Router();
const dg      = createClient(process.env.DEEPGRAM_API_KEY);
const openai  = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_VOICES = ["alloy","echo","fable","onyx","nova","shimmer"];

/* ══════════════════════════════════════════════════════════════
   POST /api/voice/transcribe
   Receives: multipart/form-data { audio: <file>, language?: "en" }
   Returns:  { transcript, confidence, words[], duration }
   STT: Deepgram nova-2
══════════════════════════════════════════════════════════════ */
router.post("/transcribe", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });

    const { result, error } = await dg.listen.prerecorded.transcribeFile(
      req.file.buffer,
      {
        model:           "nova-2",
        language:        req.body.language || "en",
        smart_format:    true,
        punctuate:       true,
        filler_words:    false,
        diarize:         false,
        utterances:      false,
      }
    );

    if (error) throw new Error(error.message || "Deepgram transcription failed");

    const channel    = result.results?.channels?.[0];
    const alt        = channel?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() || "";
    const confidence = alt?.confidence ?? 0;
    const words      = alt?.words || [];
    const duration   = result.metadata?.duration ?? 0;

    res.json({ success: true, transcript, confidence, words, duration });

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

    // Default to alloy if voice is not set or invalid
    const ttsVoice = VALID_VOICES.includes(voice) ? voice : "alloy";

    const mp3 = await openai.audio.speech.create({
      model:  "tts-1",
      voice:  ttsVoice,
      input:  text.slice(0, 4096),    // OpenAI TTS limit
      speed:  Math.min(2.0, Math.max(0.25, speed)),
    });

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

    // STT — Deepgram
    const { result, error: dgError } = await dg.listen.prerecorded.transcribeFile(
      req.file.buffer,
      { model: "nova-2", smart_format: true, punctuate: true, language: "en" }
    );

    if (dgError) throw new Error(dgError.message);

    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
    if (!transcript) return res.json({ success: true, transcript: "", text: "" });

    res.json({ success: true, transcript, text: transcript });

  } catch (err) {
    console.error("[voice/reply]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
