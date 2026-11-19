// =============================================================
// training/agentTraining.js
// Full training pipeline:
//   1. File upload       → Supabase Storage
//   2. Transcription     → OpenAI Whisper
//   3. Style extraction  → GPT-4o
//   4. Segment extraction → GPT-4o
//   5. Embedding         → text-embedding-3-small
//   6. Vector storage    → pgvector
//   7. Teacher profile   → edu.teacher_profiles
//   8. Orchestration     → edu.agent_orchestration_config  ← NEW
//   9. XP + summary
// =============================================================

import express from "express";
import multer  from "multer";
import db from "../../../db.js";
import { toFile } from "openai";
import { v4 as uuid } from "uuid";
import fs   from "fs";
import path from "path";
import { deriveAndSaveOrchestrationConfig } from "./agentOrchestration.js";
import { createRealtimeTranscriber } from "../../voice/openaiRealtime.js";
import { transcribeFileDeepgram, transcribeBufferDeepgram, hasDeepgram } from "../../voice/deepgram.js";

const router   = express.Router();
import { openai } from "../../../lib/aiModel.js";

// ── Multer ────────────────────────────────────────────────────
const UPLOAD_DIR = path.join("/tmp", "akoro-uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set([
  "audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/wave",
  "audio/x-m4a","audio/m4a","audio/mp4","audio/ogg","audio/webm",
  "audio/aac","audio/x-aac","audio/flac","audio/x-flac","audio/3gpp",
  "video/mp4","video/quicktime","video/x-matroska","video/webm",
  "video/x-msvideo","video/mpeg","video/x-ms-wmv","video/3gpp",
  "application/octet-stream", // fallback for undetected MIME types
]);

class UnsupportedFileError extends Error {
  constructor(mime) { super(`Unsupported file type: ${mime}`); this.status = 400; }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (_req,  file, cb) => cb(null, uuid() + path.extname(file.originalname)),
  }),
  limits:     { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ALLOWED_MIME.has(file.mimetype) ? cb(null, true) : cb(new UnsupportedFileError(file.mimetype)),
});

// ── In-memory run store ───────────────────────────────────────
const runs = new Map();

function createRun(runId, sessionId, teacherId, agentId, subject) {
  const run = {
    runId, sessionId, teacherId, agentId, subject,
    phase: "init", pct: 0, status: "running",
    logs: [], insights: [], summary: null,
    sseClients: new Set(),
    startedAt: new Date().toISOString(), completedAt: null,
  };
  runs.set(runId, run);
  return run;
}

function runLog(run, tag, message, value = null) {
  const entry = { id: uuid(), ts: new Date().toISOString(), tag, message, value };
  run.logs.push(entry);
  _broadcast(run, "log", entry);
  return entry;
}

function runProgress(run, phase, pct, message) {
  run.phase = phase; run.pct = pct;
  _broadcast(run, "progress", { phase, pct, message, ts: new Date().toISOString() });
}

function runInsight(run, insight) {
  const entry = { id: uuid(), ts: new Date().toISOString(), ...insight };
  run.insights.push(entry);
  _broadcast(run, "insight", entry);
  return entry;
}

function completeRun(run, summary) {
  run.status = "complete"; run.pct = 100;
  run.summary = summary; run.completedAt = new Date().toISOString();
  _broadcast(run, "complete", summary);
  setTimeout(() => { run.sseClients.forEach(c => { try { c.end(); } catch (_) {} }); run.sseClients.clear(); }, 3000);
}

function errorRun(run, message) {
  run.status = "error";
  runLog(run, "err", "Training run failed", message);
  _broadcast(run, "error", { message, ts: new Date().toISOString() });
  run.sseClients.forEach(c => { try { c.end(); } catch (_) {} });
  run.sseClients.clear();
}

function _broadcast(run, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  run.sseClients.forEach(c => { try { c.write(msg); } catch (_) {} });
}

// ── Helpers ───────────────────────────────────────────────────
const cleanTmp = (p) => { try { fs.unlinkSync(p); } catch (_) {} };

async function uploadToStorage(localPath, destPath, mimeType) {
  const buffer = fs.readFileSync(localPath);
  const { error } = await db.storage
    .from("training-assets")
    .upload(destPath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw error;
}

async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.substring(0, 8000),
  });
  return res.data[0].embedding;
}

async function storeChunk({ teacherId, agentId, sessionId, chunkText, chunkType, metadata, embedding }) {
  const { error } = await db.schema("edu").from("training_chunks").insert({
    id: uuid(), teacher_id: teacherId, agent_id: agentId,
    session_id: sessionId, chunk_text: chunkText, chunk_type: chunkType,
    metadata: metadata || {}, embedding, created_at: new Date(),
  });
  if (error) throw error;
}

async function retrieveChunks(teacherId, queryEmbedding, limit = 6) {
  const { data, error } = await db.rpc("match_training_chunks", {
    p_teacher_id: teacherId, p_query_embedding: queryEmbedding, p_match_count: limit,
  });
  if (error) throw error;
  return data || [];
}

// ── GPT-4o helpers ────────────────────────────────────────────
async function gptJson(systemPrompt, userPrompt, maxTokens = 2000) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o", max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   },
    ],
  });
  const raw = res.choices[0].message.content.trim();
  return JSON.parse(raw.replace(/^```json?\n?/i, "").replace(/\n?```$/i, "").trim());
}

async function extractStyleProfile(transcript, subject) {
  return gptJson(
    `You are an expert in pedagogical analysis. Respond with valid JSON only.`,
    `Analyse this teaching transcript on "${subject}" and extract a pedagogical fingerprint.

Transcript: """${transcript.substring(0, 12000)}"""

Return this exact JSON:
{
  "pedagogical_pattern": "concept-first|problem-first|socratic|example-first|mixed",
  "vocabulary_level": "formal|conversational|mixed|simplified",
  "explanation_structure": "1-sentence description",
  "pacing_style": "fast|moderate|slow|variable",
  "analogies": ["quote1","quote2"],
  "transition_phrases": ["phrase1","phrase2","phrase3"],
  "confusion_handling_phrases": ["phrase1","phrase2"],
  "encouragement_phrases": ["phrase1","phrase2"],
  "correction_phrases": ["phrase1","phrase2"],
  "question_style": "rhetorical|direct|socratic|wait-time",
  "example_structure": "how teacher sets up examples",
  "misconceptions_flagged": ["misconception1","misconception2"],
  "key_concepts_taught": ["concept1","concept2"],
  "unique_teaching_patterns": ["pattern1","pattern2"],
  "tone": "strict|encouraging|casual|authoritative|warm",
  "overall_summary": "2-sentence summary"
}`, 2000);
}

async function extractSegments(transcript, subject) {
  const result = await gptJson(
    `You are an expert in pedagogical content analysis. Return valid JSON only.`,
    `From this transcript on "${subject}", extract all high-value teaching segments.

Transcript: """${transcript.substring(0, 14000)}"""

Return a JSON array:
[{
  "type": "analogy|worked_example|concept_explanation|correction|encouragement|question",
  "concept": "concept being taught",
  "text": "exact relevant quote",
  "why_valuable": "brief reason",
  "xp": 40
}]

XP values: worked_example=80, analogy=60, concept_explanation=40, correction=50, encouragement=20, question=30`, 3000);

  if (Array.isArray(result)) return result;
  const key = Object.keys(result).find(k => Array.isArray(result[k]));
  return key ? result[key] : [];
}

// ── Transcription ─────────────────────────────────────────────
// Deepgram (nova-2) is the primary STT — real speaker diarization and no
// 25MB cap. If DEEPGRAM_API_KEY is missing we fall back to OpenAI Whisper
// (25MB limit, no diarization) so the pipeline still runs.
async function transcribeFile(localPath, mimeType) {
  if (hasDeepgram()) {
    return transcribeFileDeepgram(localPath, mimeType);
  }

  const result = await openai.audio.transcriptions.create({
    file:     await toFile(fs.createReadStream(localPath), path.basename(localPath)),
    model:    "whisper-1",
    language: "en",
    prompt:   "calculus, differentiation, integration, theorem, WAEC, JAMB",
    response_format:         "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });

  const fullText = result.text || "";
  const words    = (result.words || []).map(w => ({
    word: w.word, start: w.start, end: w.end, confidence: 1, speaker: null,
  }));
  const paragraphs = (result.segments || []).map(s => ({
    speaker: null, start: s.start, end: s.end,
    sentences: [s.text.trim()],
  }));
  return { fullText, words, paragraphs };
}

// ── Teacher profile upsert ────────────────────────────────────
async function upsertTeacherProfile(teacherId, agentId, updates) {
  const { error } = await db
    .schema("edu").from("teacher_profiles")
    .upsert({ teacher_id: teacherId, agent_id: agentId, ...updates, updated_at: new Date() },
            { onConflict: "teacher_id" });
  if (error) throw error;
}

// =============================================================
// CORE PIPELINE
// =============================================================
async function runPipeline(run, file, teacherId, agentId, subject, sessionTitle) {
  let localPath = file.path;

  try {
    runLog(run, "sys",  "Training run started",   `${file.originalname} · ${subject}`);
    runLog(run, "info", "File received",           `${file.originalname} (${(file.size / (1024*1024)).toFixed(1)} MB)`);
    runLog(run, "ok",   "File validation passed");

    // ── Phase 1: Store ────────────────────────────────────────
    runProgress(run, "store", 5, "Uploading to secure storage");
    const storagePath = `training/${teacherId}/${run.sessionId}/${file.filename}`;
    await uploadToStorage(localPath, storagePath, file.mimetype);
    cleanTmp(localPath); localPath = null;
    runLog(run, "ok", "File stored", `storage://${storagePath}`);

    await db.schema("edu").from("training_sessions").insert({
      id: run.sessionId, teacher_id: teacherId, agent_id: agentId,
      title: sessionTitle || file.originalname, subject,
      file_path: storagePath,
      file_type: file.mimetype.startsWith("audio/") ? "audio" : "video",
      file_size: file.size, status: "processing", run_id: run.runId, created_at: new Date(),
    });
    runProgress(run, "store", 12, "File stored securely");

    // ── Phase 2: Transcribe ───────────────────────────────────
    runProgress(run, "transcribe", 14, hasDeepgram() ? "Transcribing with Deepgram" : "Transcribing with OpenAI Whisper");
    const { data: fileData } = await db.storage.from("training-assets").download(storagePath);
    const tmpForDg = path.join(UPLOAD_DIR, `${run.sessionId}_dg${path.extname(file.filename)}`);
    fs.writeFileSync(tmpForDg, Buffer.from(await fileData.arrayBuffer()));

    const { fullText, words, paragraphs } = await transcribeFile(tmpForDg, file.mimetype);
    cleanTmp(tmpForDg);

    const wordCount   = words.length;
    const durationSec = words.length > 0 ? Math.ceil(words[words.length - 1].end) : 0;
    const durationMin = Math.ceil(durationSec / 60);
    const speakers    = [...new Set(words.map(w => w.speaker).filter(Boolean))].length;

    runLog(run, "ok",   "Transcription complete", `${wordCount} words · ${durationMin} min`);
    runLog(run, "ok",   "Speaker diarization",    `${speakers} speaker(s)`);
    if (wordCount < 50) runLog(run, "warn", "Very short transcript — check audio quality");
    runProgress(run, "transcribe", 30, `Transcription complete — ${wordCount} words`);

    // ── Phase 3: Style extraction ─────────────────────────────
    runProgress(run, "extract", 32, "Extracting teaching style fingerprint");
    const styleProfile = await extractStyleProfile(fullText, subject);

    runLog(run, "ok",   "Pedagogical pattern",  styleProfile.pedagogical_pattern);
    runLog(run, "ok",   "Vocabulary level",     styleProfile.vocabulary_level);
    runLog(run, "ok",   "Tone",                 styleProfile.tone);
    runLog(run, "ok",   "Question style",       styleProfile.question_style);
    runLog(run, "info", "Analogies extracted",  `${styleProfile.analogies?.length || 0} found`);
    runLog(run, "info", "Transition phrases",   `${styleProfile.transition_phrases?.length || 0} captured`);
    runLog(run, "ok",   "Style profile complete", styleProfile.overall_summary);

    if (styleProfile.analogies?.length > 0) {
      runInsight(run, { type: "analogy", concept: "Teaching analogies",
        text: `${styleProfile.analogies.length} analogies captured — e.g. "${styleProfile.analogies[0]}"`,
        xp: styleProfile.analogies.length * 20 });
    }
    if (styleProfile.key_concepts_taught?.length > 0) {
      runInsight(run, { type: "concept_map", concept: "Key concepts",
        text: styleProfile.key_concepts_taught.slice(0, 5).join(", "),
        xp: styleProfile.key_concepts_taught.length * 15 });
    }
    runProgress(run, "extract", 52, "Style fingerprint complete");

    // ── Phase 4: Segment extraction ───────────────────────────
    runProgress(run, "segment", 54, "Extracting high-value segments");
    const segments = await extractSegments(fullText, subject);
    const countByType = segments.reduce((acc, s) => { acc[s.type] = (acc[s.type] || 0) + 1; return acc; }, {});

    runLog(run, "ok", "Segments extracted", `${segments.length} total`);
    for (const [type, count] of Object.entries(countByType)) {
      runLog(run, "ok", `  → ${type.replace(/_/g, " ")}`, `${count} found`);
    }
    segments.slice(0, 8).forEach(seg => runInsight(run, {
      type: seg.type, concept: seg.concept, text: seg.text, xp: seg.xp || 40,
    }));
    runProgress(run, "segment", 68, `${segments.length} segments extracted`);

    // ── Phase 5: Embed + store ────────────────────────────────
    runProgress(run, "embed", 70, "Embedding chunks into pgvector");
    let chunksStored = 0;
    const CHUNK_SIZE = 400, OVERLAP = 80;
    const tWords = fullText.split(" ");

    for (let i = 0; i < tWords.length; i += CHUNK_SIZE - OVERLAP) {
      const chunkText = tWords.slice(i, i + CHUNK_SIZE).join(" ");
      if (chunkText.trim().length < 40) continue;
      const embedding = await embed(chunkText);
      await storeChunk({ teacherId, agentId, sessionId: run.sessionId,
        chunkText, chunkType: "transcript", metadata: { subject, wordOffset: i }, embedding });
      chunksStored++;
      if (chunksStored % 5 === 0) runLog(run, "info", "Chunks embedded", `${chunksStored} stored`);
    }

    for (const seg of segments) {
      const embedding = await embed(`${seg.text} ${seg.concept || ""}`);
      await storeChunk({ teacherId, agentId, sessionId: run.sessionId,
        chunkText: seg.text, chunkType: seg.type,
        metadata: { concept: seg.concept, why: seg.why_valuable, subject }, embedding });
      chunksStored++;
    }

    runLog(run, "ok", "All chunks embedded", `${chunksStored} vectors stored`);
    runInsight(run, { type: "vector_store", concept: "Vector database",
      text: `${chunksStored} semantic chunks stored — agent retrieves relevant material at query time`,
      xp: chunksStored * 4 });
    runProgress(run, "embed", 85, "Vector storage complete");

    // ── Phase 6: Teacher profile ──────────────────────────────
    runProgress(run, "profile", 87, "Updating teacher profile");
    const { data: existing } = await db
      .schema("edu").from("teacher_profiles")
      .select("style_profile, total_hours_trained, session_count, concepts_taught")
      .eq("teacher_id", teacherId).maybeSingle();

    const mergedConcepts = [...new Set([
      ...(existing?.concepts_taught || []),
      ...(styleProfile.key_concepts_taught || []),
    ])];

    await upsertTeacherProfile(teacherId, agentId, {
      subject, style_profile: styleProfile, concepts_taught: mergedConcepts,
      total_hours_trained: ((existing?.total_hours_trained || 0) + durationSec / 3600),
      session_count: (existing?.session_count || 0) + 1, last_trained_at: new Date(),
    });

    const newSessionCount = (existing?.session_count || 0) + 1;
    runLog(run, "ok", "Teacher profile updated",
      `session ${newSessionCount} · ${mergedConcepts.length} total concepts`);
    runProgress(run, "profile", 89, "Teacher profile updated");

    // ── Phase 7: Orchestration config ────────────────────────
    // NEW: Derive and save unique orchestration config for this teacher
    runProgress(run, "orchestration", 90, "Deriving unique agent orchestration");
    runLog(run, "info", "Analysing pedagogical pattern for flow type",
      styleProfile.pedagogical_pattern);
    runLog(run, "info", "Generating custom teaching phases");
    runLog(run, "info", "Building guide personality config");
    runLog(run, "info", "Building control agent config");
    runLog(run, "info", "Building student agent tuning");

    const orchestrationConfig = await deriveAndSaveOrchestrationConfig({
      teacherId,
      agentId,
      runId:        run.runId,
      subject,
      styleProfile,
      transcript:   fullText,
    });

    const phaseCount = orchestrationConfig.phase_definitions?.phases?.length || 4;
    runLog(run, "ok", "Orchestration config saved",
      `${phaseCount} custom phases · flow: ${orchestrationConfig.flow_type}`);
    runLog(run, "ok", "Guide agent configured",
      `tone: ${orchestrationConfig.guide_config?.tone || "set"}`);
    runLog(run, "ok", "Control agent configured",
      `sensitivity: ${orchestrationConfig.control_config?.driftSensitivity || "set"}`);
    runLog(run, "ok", "Agent is now unique to this teacher");

    runInsight(run, {
      type: "orchestration", concept: "Unique Agent Identity",
      text: `This teacher now has their own ${orchestrationConfig.flow_type} flow with ${phaseCount} custom phases — completely independent of any other agent.`,
      xp: 200,
    });
    runProgress(run, "orchestration", 94, "Unique orchestration saved");

    await db.schema("edu").from("training_sessions")
      .update({ status: "complete", chunks_stored: chunksStored, completed_at: new Date() })
      .eq("id", run.sessionId);

    // ── Phase 8: XP ───────────────────────────────────────────
    runProgress(run, "calibrate", 97, "Calculating XP");
    const xpEarned = Math.floor(
      chunksStored * 4 +
      (countByType.analogy || 0) * 30 +
      (countByType.worked_example || 0) * 40 +
      (countByType.concept_explanation || 0) * 20 +
      durationSec * 0.5 + 200 // bonus for unique orchestration
    );
    runLog(run, "xp",  "XP earned this run", `+${xpEarned} XP`);
    runLog(run, "sys", "Training run complete", run.runId);

    runInsight(run, { type: "xp_summary", concept: "XP Earned",
      text: `+${xpEarned} XP · ${chunksStored} vectors · ${phaseCount} custom phases · unique agent identity created`,
      xp: xpEarned });

    const summary = {
      runId:           run.runId,
      sessionId:       run.sessionId,
      subject,
      fileOriginal:    file.originalname,
      durationMin,
      wordCount,
      speakers,
      chunksStored,
      segmentBreakdown: countByType,
      totalInsights:   run.insights.length,
      xpEarned,
      totalConcepts:   mergedConcepts.length,
      sessionCount:    newSessionCount,
      orchestration: {
        flowType:    orchestrationConfig.flow_type,
        phaseCount,
        guideConfig: orchestrationConfig.guide_config,
        isUnique:    true,
      },
      styleProfile: {
        pattern:    styleProfile.pedagogical_pattern,
        tone:       styleProfile.tone,
        vocabulary: styleProfile.vocabulary_level,
        summary:    styleProfile.overall_summary,
      },
      model:         "gpt-4o",
      transcription: hasDeepgram() ? "deepgram nova-2" : "whisper-1",
      embedding:     "text-embedding-3-small (1536 dim)",
      completedAt: new Date().toISOString(),
    };

    completeRun(run, summary);

  } catch (err) {
    console.error("[training/pipeline]", err);
    errorRun(run, err.message);
    if (localPath) cleanTmp(localPath);
    await db.schema("edu").from("training_sessions")
      .update({ status: "failed" }).eq("id", run.sessionId);
  }
}

// =============================================================
// ROUTES
// =============================================================

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /training/upload
router.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
      return res.status(status).json({ error: err.message });
    }
    next();
  });
}, asyncHandler(async (req, res) => {
  const teacherId = req.user.id;
  const { agentId, subject = "General", sessionTitle } = req.body;
  const file = req.file;
  if (!file)    return res.status(400).json({ error: "No file received" });
  if (!agentId) return res.status(400).json({ error: "agentId is required" });

  const runId = uuid(), sessionId = uuid();
  const run   = createRun(runId, sessionId, teacherId, agentId, subject);
  res.status(202).json({ runId, sessionId, message: "Training started — connect to SSE stream" });
  runPipeline(run, file, teacherId, agentId, subject, sessionTitle).catch(err => {
    errorRun(run, err.message); cleanTmp(file.path);
  });
}));

/**
 * A training run is its teacher's (or an admin's) to watch: the logs and
 * insights carry the uploaded material. Any run id used to answer anyone
 * (Phase 15 item 6). Someone else's run reads as not found.
 */
function ownRun(req, res) {
  const run = runs.get(req.params.runId);
  if (!run || (run.teacherId !== req.user.id && req.user.role !== "admin")) {
    res.status(404).json({ error: "Run not found" });
    return null;
  }
  return run;
}

// GET /training/run/:runId/stream  (SSE)
router.get("/run/:runId/stream", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  run.logs.forEach(e     => res.write(`event: log\ndata: ${JSON.stringify(e)}\n\n`));
  run.insights.forEach(e => res.write(`event: insight\ndata: ${JSON.stringify(e)}\n\n`));
  res.write(`event: progress\ndata: ${JSON.stringify({ phase: run.phase, pct: run.pct, ts: new Date().toISOString() })}\n\n`);

  if (run.status === "complete") { res.write(`event: complete\ndata: ${JSON.stringify(run.summary)}\n\n`); return res.end(); }
  if (run.status === "error")    { res.write(`event: error\ndata: ${JSON.stringify({ message: "Run failed" })}\n\n`);   return res.end(); }

  run.sseClients.add(res);
  req.on("close", () => run.sseClients.delete(res));
});

// GET /training/run/:runId/logs
router.get("/run/:runId/logs", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const from = parseInt(req.query.from || "0", 10);
  const tag  = req.query.tag;
  let logs   = run.logs.slice(from);
  if (tag) logs = logs.filter(l => l.tag === tag);
  res.json({
    runId: run.runId, status: run.status, phase: run.phase, pct: run.pct,
    total: run.logs.length, from, logs,
    stats: {
      ok:   run.logs.filter(l => l.tag === "ok").length,
      info: run.logs.filter(l => l.tag === "info").length,
      warn: run.logs.filter(l => l.tag === "warn").length,
      err:  run.logs.filter(l => l.tag === "err").length,
      xp:   run.logs.filter(l => l.tag === "xp").length,
      sys:  run.logs.filter(l => l.tag === "sys").length,
    },
  });
});

// GET /training/run/:runId/insights
router.get("/run/:runId/insights", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const from = parseInt(req.query.from || "0", 10);
  const type = req.query.type;
  let ins    = run.insights.slice(from);
  if (type) ins = ins.filter(i => i.type === type);
  const totalXP = run.insights.reduce((s, i) => s + (i.xp || 0), 0);
  res.json({
    runId: run.runId, status: run.status, total: run.insights.length, totalXP, from, insights: ins,
    breakdown: run.insights.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {}),
  });
});

// GET /training/run/:runId/status
router.get("/run/:runId/status", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const lastError = [...run.logs].reverse().find(l => l.tag === "err");
  res.json({
    runId: run.runId, sessionId: run.sessionId, subject: run.subject,
    status: run.status, phase: run.phase, pct: run.pct,
    startedAt: run.startedAt, completedAt: run.completedAt,
    logCount: run.logs.length, insightCount: run.insights.length,
    totalXP: run.insights.reduce((s, i) => s + (i.xp || 0), 0),
    error: run.status === "error" ? (lastError?.value || lastError?.message || "Training run failed") : null,
    summary: run.summary,
  });
});

// GET /training/run/:runId/export
router.get("/run/:runId/export", (req, res) => {
  const run = ownRun(req, res);
  if (!run) return;
  const lines = [
    "=== Piabam Agent Training Log ===",
    `Run ID:  ${run.runId}`, `Subject: ${run.subject}`,
    `Status:  ${run.status}`, `Started: ${run.startedAt}`,
    `Ended:   ${run.completedAt || "in progress"}`, "=".repeat(50), "",
    ...run.logs.map(l => `[${l.ts}] [${l.tag.toUpperCase().padEnd(4)}] ${l.message}${l.value ? "  →  " + l.value : ""}`),
    "", "=== INSIGHTS ===",
    ...run.insights.map(i => `[${i.ts}] [${i.type}] ${i.concept}: ${i.text} (+${i.xp || 0} XP)`),
  ];
  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", `attachment; filename="training-run-${run.runId}.txt"`);
  res.send(lines.join("\n"));
});

// POST /training/stream-start
router.post("/stream-start", async (req, res) => {
  const teacherId = req.user.id;   // caller trains their OWN agent only
  const { agentId, subject = "General" } = req.body;
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  const sessionId = uuid(), wsToken = uuid(), runId = uuid();
  await db.schema("edu").from("training_sessions").insert({
    id: sessionId, teacher_id: teacherId, agent_id: agentId,
    subject, title: "Live stream — " + new Date().toLocaleString(),
    file_type: "live", status: "streaming", run_id: runId, created_at: new Date(),
  });
  await db.schema("edu").from("stream_tokens").insert({
    token: wsToken, session_id: sessionId, teacher_id: teacherId,
    agent_id: agentId, subject, run_id: runId,
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
  });
  createRun(runId, sessionId, teacherId, agentId, subject);
  res.json({ runId, sessionId, wsToken });
});

// POST /training/query
router.post("/query", async (req, res) => {
  const teacherId = req.user.id;
  const { agentId, studentQuery } = req.body;
  if (!studentQuery) return res.status(400).json({ error: "studentQuery required" });
  try {
    const { buildAgentSystemPrompt } = await import("./agentPromptBuilder.js");
    const systemPrompt = await buildAgentSystemPrompt(teacherId, agentId, studentQuery);
    res.json({ systemPrompt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /training/correct
router.post("/correct", async (req, res) => {
  // Corrections write into the teacher's own knowledge base — bind to the
  // authenticated user so nobody can inject training data into another agent.
  const teacherId = req.user.id;
  const { agentId, studentQuery, agentResponse, correction, subject } = req.body;
  if (!correction) return res.status(400).json({ error: "correction required" });
  try {
    const correctionText = `Student asked: "${studentQuery}"\nAgent said (wrong): "${agentResponse}"\nTeacher correction: "${correction}"`;
    const embedding = await embed(correctionText);
    await storeChunk({ teacherId, agentId, sessionId: uuid(), chunkText: correction,
      chunkType: "correction", metadata: { originalQuery: studentQuery, wrongResponse: agentResponse, subject, priority: "high" }, embedding });
    res.json({ stored: true, message: "Correction stored as high-priority training example" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /training/sessions/:teacherId
router.get("/sessions/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { limit = 20, offset = 0 } = req.query;
  const { data, error } = await db
    .schema("edu").from("training_sessions")
    .select("id, run_id, title, subject, file_type, status, chunks_stored, created_at, completed_at")
    .eq("teacher_id", req.params.teacherId)
    .order("created_at", { ascending: false })
    .range(Number(offset), Number(offset) + Number(limit) - 1);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data });
});

// GET /training/profile/:teacherId
router.get("/profile/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { data, error } = await db
    .schema("edu").from("teacher_profiles").select("*")
    .eq("teacher_id", req.params.teacherId).maybeSingle();
  if (error) return res.status(404).json({ error: "Profile not found" });
  res.json({ profile: data });
});

// GET /training/orchestration/:agentId
router.get("/orchestration/:agentId", async (req, res) => {
  const { data, error } = await db
    .schema("edu").from("agent_orchestration_config").select("*")
    .eq("agent_id", req.params.agentId).maybeSingle();
  if (error) return res.status(404).json({ error: "Orchestration config not found" });
  res.json({ config: data });
});

// GET /training/chunks/:teacherId
router.get("/chunks/:teacherId", async (req, res) => {
  if (req.params.teacherId !== req.user.id && req.user.role !== "admin")
    return res.status(403).json({ error: "Not authorised" });
  const { q, limit = 5 } = req.query;
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const embedding = await embed(q);
    const chunks    = await retrieveChunks(req.params.teacherId, embedding, Number(limit));
    res.json({ chunks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /training/session/:sessionId
router.delete("/session/:sessionId", async (req, res) => {
  const teacherId = req.user.id;
  const { data: session } = await db.schema("edu").from("training_sessions")
    .select("teacher_id, file_path").eq("id", req.params.sessionId).single();
  if (!session || (session.teacher_id !== teacherId && req.user.role !== "admin"))
    return res.status(403).json({ error: "Not authorised" });
  if (session.file_path) await db.storage.from("training-assets").remove([session.file_path]);
  await db.schema("edu").from("training_chunks").delete().eq("session_id", req.params.sessionId);
  await db.schema("edu").from("training_sessions").delete().eq("id", req.params.sessionId);
  res.json({ deleted: true });
});

// =============================================================
// WEBSOCKET — live streaming training
// =============================================================
export function attachTrainingWS(wss) {
  wss.on("connection", (ws) => {
    let sttConnection = null, run = null, authenticated = false;
    let transcript = "", teacherId, agentId, subject, sessionId;
    const send = (event, data) => ws.send(JSON.stringify({ event, data }));

    const handleSegment = async (segment) => {
      transcript += " " + segment;
      send("transcript", { text: segment });
      if (run) runLog(run, "info", "Transcript segment received", `${Math.ceil(transcript.split(" ").length)} words`);
      if (Math.ceil(transcript.split(" ").length) % 500 === 0) {
        try {
          const embedding = await embed(segment);
          await storeChunk({ teacherId, agentId, sessionId, chunkText: segment, chunkType: "transcript", metadata: { subject, live: true }, embedding });
          if (run) runLog(run, "ok", "Live chunk embedded");
        } catch (e) { if (run) runLog(run, "err", "Live chunk embed failed", e.message); }
      }
    };

    ws.on("message", async (raw, isBinary) => {
      try {
        // Binary frames are raw PCM16 mono 24kHz audio
        if (isBinary && authenticated && sttConnection) {
          sttConnection.sendAudio(Buffer.from(raw).toString("base64"));
          return;
        }
        const msg = JSON.parse(raw.toString());

        if (msg.type === "auth") {
          const { data: tok } = await db.schema("edu").from("stream_tokens").select("*")
            .eq("token", msg.token).gte("expires_at", new Date().toISOString()).single();
          if (!tok) { send("error", { message: "Invalid or expired token" }); return ws.close(); }

          teacherId = tok.teacher_id; agentId = tok.agent_id;
          subject   = tok.subject;   sessionId = tok.session_id;
          authenticated = true; run = runs.get(tok.run_id);

          let interim = "";
          sttConnection = createRealtimeTranscriber({
            onOpen:  () => { send("status", { message: "Transcription open — streaming" }); if (run) runLog(run, "ok", "OpenAI realtime transcription open"); },
            onDelta: (delta) => { interim += delta; send("interim", { text: interim }); },
            onCompleted: async (segment) => { interim = ""; await handleSegment(segment); },
            onError: (e) => { send("error", { message: e.message }); },
            onClose: ()  => { send("status", { message: "Transcription closed" }); },
          });
          send("auth_ok", { sessionId, runId: tok.run_id, message: "Ready — send audio chunks (PCM16 mono 24kHz)" });
          return;
        }

        if (msg.type === "end" && authenticated) {
          if (sttConnection) sttConnection.close();
          if (run) runLog(run, "sys", "Live stream ended — running final extraction");
          if (transcript.trim().length > 100) {
            const [styleProfile, segments] = await Promise.all([
              extractStyleProfile(transcript, subject),
              extractSegments(transcript, subject),
            ]);
            for (const seg of segments) {
              const embedding = await embed(seg.text);
              await storeChunk({ teacherId, agentId, sessionId, chunkText: seg.text, chunkType: seg.type, metadata: { concept: seg.concept, subject, live: true }, embedding });
              if (run) runInsight(run, { type: seg.type, concept: seg.concept, text: seg.text, xp: seg.xp || 40 });
            }
            await upsertTeacherProfile(teacherId, agentId, { subject, style_profile: styleProfile, last_trained_at: new Date() });

            // Derive orchestration from live session too
            const orchConfig = await deriveAndSaveOrchestrationConfig({
              teacherId, agentId, runId: run?.runId, subject, styleProfile, transcript,
            }).catch(e => { console.warn("[Live] Orchestration save failed:", e.message); return null; });

            await db.schema("edu").from("training_sessions").update({ status: "complete", completed_at: new Date() }).eq("id", sessionId);
            const summary = { sessionId, styleProfile, segmentsFound: segments.length, orchestrationSaved: !!orchConfig };
            if (run) completeRun(run, summary);
            send("complete", summary);
          } else {
            send("complete", { sessionId, message: "Session too short" });
            if (run) completeRun(run, { sessionId, message: "Session too short" });
          }
          ws.close();
        }
      } catch (err) {
        console.error("[training/ws]", err);
        send("error", { message: err.message });
      }
    });
    ws.on("close", () => { if (sttConnection) { try { sttConnection.close(); } catch (_) {} } });
  });
}

export default router;

// ─── Live stream training endpoint ───────────────────────────────────────────

/**
 * POST /api/adaptive/training/stream/start
 * Starts a live microphone/device stream training session.
 * The client sends audio chunks via POST /api/adaptive/training/stream/chunk.
 * Each chunk is transcribed via OpenAI Whisper and added to the training session.
 * Finalize via POST /api/adaptive/training/stream/end
 */
export async function startLiveStream(req, res) {
  const { subject } = req.body;
  const teacherId = req.user?.id;   // caller trains their own agent — no body override
  if (!teacherId) return res.status(400).json({ error: "auth required" });

  const { data: session, error } = await db.schema("edu").from("training_sessions").insert({
    teacher_id:    teacherId,
    source_type:   "live_stream",
    subject:       subject ?? "General",
    status:        "processing",
    file_count:    0,
    total_chunks:  0,
    started_at:    new Date().toISOString(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  // Store session in Redis for chunk accumulation
  try {
    const redis = (await import("../learner/student-state.js")).getRedis();
    await redis.setex(
      `live_stream:${session.id}`,
      3600,
      JSON.stringify({ sessionId: session.id, teacherId, subject, chunks: [], startedAt: Date.now() })
    );
  } catch (e) {
    console.warn("[training/stream] Redis cache failed:", e.message);
  }

  res.status(201).json({ session_id: session.id, status: "streaming", message: "Send audio chunks to /api/adaptive/training/stream/chunk" });
}

/**
 * POST /api/adaptive/training/stream/chunk
 * Receives a raw audio chunk (base64 or buffer) from the client.
 * Transcribes via OpenAI Whisper and appends text to the live session.
 */
export async function receiveChunk(req, res) {
  const { session_id, audio_base64, text } = req.body;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  let transcribed = text ?? "";

  // If audio provided, transcribe (Deepgram primary, Whisper fallback)
  if (audio_base64 && !text) {
    try {
      const buffer = Buffer.from(audio_base64, "base64");
      if (hasDeepgram()) {
        ({ transcript: transcribed } = await transcribeBufferDeepgram(buffer));
      } else {
        const result = await openai.audio.transcriptions.create({
          file:     await toFile(buffer, "chunk.webm"),
          model:    "whisper-1",
          language: "en",
        });
        transcribed = result.text ?? "";
      }
    } catch (e) {
      console.warn("[training/stream] transcription failed:", e.message);
      return res.status(500).json({ error: "Transcription failed: " + e.message });
    }
  }

  if (!transcribed.trim()) return res.json({ received: true, transcribed: "" });

  // Append to Redis session
  try {
    const redis = (await import("../learner/student-state.js")).getRedis();
    const raw   = await redis.get(`live_stream:${session_id}`);
    if (raw) {
      const state = JSON.parse(raw);
      state.chunks.push({ text: transcribed, ts: Date.now() });
      await redis.setex(`live_stream:${session_id}`, 3600, JSON.stringify(state));
    }
  } catch (e) {
    console.warn("[training/stream] Redis append failed:", e.message);
  }

  res.json({ received: true, transcribed, length: transcribed.length });
}

/**
 * POST /api/adaptive/training/stream/end
 * Finalises the live stream session.
 * Concatenates all chunks → runs through the training pipeline.
 */
export async function endLiveStream(req, res) {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  let fullText = "";
  let teacherId, subject;

  try {
    const redis = (await import("../learner/student-state.js")).getRedis();
    const raw   = await redis.get(`live_stream:${session_id}`);
    if (raw) {
      const state = JSON.parse(raw);
      fullText  = state.chunks.map((c) => c.text).join(" ");
      teacherId = state.teacherId;
      subject   = state.subject;
      await redis.del(`live_stream:${session_id}`);
    }
  } catch (e) {
    console.warn("[training/stream] Redis read failed:", e.message);
  }

  if (!fullText.trim()) {
    await db.schema("edu").from("training_sessions").update({ status: "failed" }).eq("id", session_id);
    return res.status(400).json({ error: "No audio content received — session empty" });
  }

  // Store transcript as a training chunk and finish
  await db.schema("edu").from("training_sessions").update({
    status:       "completed",
    total_chunks: 1,
    completed_at: new Date().toISOString(),
  }).eq("id", session_id);

  try {
    await db.schema("edu").from("stream_tokens").insert({
      session_id,
      token_text:  fullText,
      token_index: 0,
    });
  } catch {}

  res.json({
    session_id,
    status:           "completed",
    transcript_words: fullText.split(/\s+/).length,
    message:          "Live stream session processed. Run /api/adaptive/training/start to embed into agent.",
  });
}
