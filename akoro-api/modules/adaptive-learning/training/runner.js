// =============================================================
// training/runner.js
// CORE PIPELINE: store → transcribe → extract → embed → profile →
// orchestration → XP, with every step written to the run's log and SSE.
// =============================================================

import db from "../../../db.js";
import fs   from "fs";
import path from "path";
import { deriveAndSaveOrchestrationConfig } from "./agentOrchestration.js";
import { hasDeepgram } from "../../voice/index.js";
import { runLog, runProgress, runInsight, completeRun, errorRun } from "./runs.js";
import { uploadToStorage, embed, storeChunk, upsertTeacherProfile } from "./store.js";
import { extractStyleProfile, extractSegments, transcribeFile } from "./extraction.js";
import { UPLOAD_DIR, cleanTmp } from "./upload.js";

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

export { runPipeline };
