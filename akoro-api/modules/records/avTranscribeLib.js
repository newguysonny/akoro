/**
 * modules/records/avTranscribeLib.js — the audio/video transcription lane.
 *
 * The Fortizo plan's §5, adapted to what akoro already runs:
 *   • ffmpeg — the same FFMPEG_PATH convention the video-encoding worker
 *     uses (worker.js), OPTIMIZED per the plan: audio goes out as 16 kHz
 *     mono (STT models are built around that rate — anything more is
 *     bandwidth and money for nothing), and video additionally samples
 *     frames at SCENE CHANGES (never a fixed interval — cut points are
 *     where slides change), capped and downscaled.
 *   • Deepgram — modules/voice/deepgram.js's transcribeFileDeepgram
 *     (nova-2, diarized, paragraph-timestamped). Its paragraph boundaries
 *     ARE the natural-pause segmentation the plan asks for; we never
 *     slice on a fixed time window.
 *   • Frame captions — by default OUR OWN hanji-parse worker on RunPod
 *     (extractLib.parsePageOnRunpod): lecture slides are documents, and
 *     OCR of the on-screen text is exactly what the plan wants captured.
 *     `AV_FRAME_PROVIDER=openai` switches to gpt-4o-mini descriptions;
 *     `off` keeps the lane speech-only.
 *
 * Results land in edu.content_transcripts — one row per segment, both
 * kinds in one table, chronological by start_ms, keyed by the STORAGE
 * FILE KEY: a learner's own upload has a user-scoped key (privacy
 * inherits), a SHARED file (discovery) has one key, so it transcribes
 * ONCE and every later opener reads the same rows for free. The reader
 * plays the ORIGINAL file while the transcript grounds the session and
 * drives click-to-seek. Delete-then-insert per run; re-running is
 * idempotent. claimContentJob (extractLib) keeps concurrent first-opens
 * from double-spending.
 *
 * The db client loads lazily (uploader.js pattern) so the pure shaping
 * helpers stay importable by tests without Supabase env.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasDeepgram, transcribeFileDeepgram } from "../voice/deepgram.js";
import { parsePageOnRunpod, recordsExtractionEnabled, claimContentJob, finishContentJob, getContentJob } from "./extractLib.js";

const FFMPEG_PATH   = () => process.env.FFMPEG_PATH   || "ffmpeg";
const FRAME_PROVIDER = () => (process.env.AV_FRAME_PROVIDER || "auto").toLowerCase();
const MAX_FRAMES     = () => Math.max(0, parseInt(process.env.AV_MAX_FRAMES, 10) || 10);
const SCENE_THRESHOLD = () => {
  const v = parseFloat(process.env.AV_SCENE_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.3;
};

export const avEnabled = () => hasDeepgram();

/* ── Pure shaping (exported for the contract test) ─────────────────────── */

/** Parse ffmpeg showinfo's `pts_time:` stamps out of stderr — the scene
 *  sampler's timestamps. Pure; the spawn test feeds it a fake stderr. */
export function parseSceneTimes(stderrText) {
  const times = [];
  const re = /pts_time:([0-9]+\.?[0-9]*)/g;
  let m;
  while ((m = re.exec(String(stderrText ?? ""))) !== null) {
    const t = parseFloat(m[1]);
    if (Number.isFinite(t) && t >= 0) times.push(t);
  }
  return times;
}

/**
 * shapeSegments — Deepgram's diarized paragraphs (+ sampled frame
 * captions) → transcript rows. Paragraphs are the natural-pause
 * segmentation; a lone fullText (short clips) becomes one segment.
 * Sorted by start_ms; speech first on ties. Pure.
 */
export function shapeSegments({ paragraphs = [], fullText = "", duration = 0, frames = [], model = null }) {
  const rows = [];
  for (const p of paragraphs) {
    const text = (p.sentences || []).join(" ").trim();
    if (!text) continue;
    rows.push({
      kind: "speech",
      start_ms: Math.max(0, Math.round((p.start ?? 0) * 1000)),
      end_ms: p.end != null ? Math.round(p.end * 1000) : null,
      speaker: typeof p.speaker === "number" ? `Speaker ${p.speaker + 1}` : null,
      text,
    });
  }
  if (!rows.length && fullText && fullText.trim()) {
    rows.push({
      kind: "speech",
      start_ms: 0,
      end_ms: Math.round((duration || 0) * 1000) || null,
      speaker: null,
      text: fullText.trim(),
    });
  }
  for (const f of frames) {
    const text = String(f?.caption || "").trim();
    if (!text) continue;
    rows.push({
      kind: "visual",
      start_ms: Math.max(0, Math.round((f.tSec ?? 0) * 1000)),
      end_ms: null,
      speaker: null,
      text,
    });
  }
  rows.sort((a, b) => (a.start_ms - b.start_ms) || (a.kind === "speech" ? -1 : 1));
  return rows.map((r) => ({ ...r, model }));
}

/** The transcript's plain text — the session grounding (capped by caller). */
export const transcriptText = (segments) =>
  (segments || [])
    .map((s) => (s.speaker ? `[${s.speaker}] ${s.text}` : s.text))
    .join("\n\n");

/* ── ffmpeg helpers ────────────────────────────────────────────────────── */

function runFfmpeg(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 400_000) err = err.slice(-200_000);   // keep the tail
      onStderr?.(err);
    });
    child.on("error", (e) => reject(new Error(`ffmpeg unavailable (${e.message}) — set FFMPEG_PATH`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))));
  });
}

/** §5's optimization: 16 kHz mono — the rate STT is built around. */
export function extractAudioArgs(src, out) {
  return ["-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out];
}

/** Scene-change frames (NOT a fixed interval), downscaled, hard-capped.
 *  Returns [{ path, tSec }]; empty when the video yields no scene cuts
 *  (caller decides on a fallback). */
export function sampleSceneFramesArgs(src, outPattern, { maxFrames, threshold }) {
  return [
    "-y", "-i", src,
    "-vf", `select='gt(scene,${threshold})',showinfo,scale=960:-2`,
    "-vsync", "vfr",
    "-frames:v", String(maxFrames),
    outPattern,
  ];
}

/* ── Frame captions ────────────────────────────────────────────────────── */

async function captionFrame(framePath, tSec) {
  const provider = FRAME_PROVIDER();
  const useHanji  = provider === "hanji"  || (provider === "auto" && recordsExtractionEnabled());
  const useOpenai = provider === "openai" || (provider === "auto" && !useHanji && !!process.env.OPENAI_API_KEY);
  try {
    if (useHanji) {
      // Our parse worker IS an OCR engine — slides/whiteboards are its home turf.
      const b64 = (await readFile(framePath)).toString("base64");
      const { markdown } = await parsePageOnRunpod({ imageBase64: b64, maxNewTokens: 1024 });
      return markdown;
    }
    if (useOpenai) {
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const b64 = (await readFile(framePath)).toString("base64");
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "This is a frame from a lecture/recording. Transcribe any on-screen text, or describe the visual in one short line. Be terse." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        }],
      });
      return res?.choices?.[0]?.message?.content || "";
    }
  } catch (err) {
    // A frame that can't be captioned is a gap in the visual lane, never a
    // failure of the transcription — the speech lane carries the record.
    return `[frame at ${Math.round(tSec)}s — caption failed]`;
  }
  return null;
}

/* ── Persistence (lazy db — the uploader.js pattern) ───────────────────── */
const dbLazy = async () => (await import("../../db.js")).default;

export async function replaceTranscript(userId, contentKey, segments, model) {
  const db = await dbLazy();
  const del = await db.schema("edu").from("content_transcripts")
    .delete().eq("content_key", contentKey);
  if (del.error) throw del.error;
  if (!segments.length) return 0;
  const rows = segments.map((s) => ({
    content_key: contentKey, user_id: userId, kind: s.kind,
    start_ms: s.start_ms, end_ms: s.end_ms, speaker: s.speaker,
    text: s.text, model: s.model || model,
  }));
  for (let i = 0; i < rows.length; i += 100) {
    const ins = await db.schema("edu").from("record_transcripts").insert(rows.slice(i, i + 100));
    if (ins.error) throw ins.error;
  }
  return rows.length;
}

export async function getTranscript(contentKey) {
  const db = await dbLazy();
  const { data, error } = await db.schema("edu").from("content_transcripts")
    .select("kind, start_ms, end_ms, speaker, text, model")
    .eq("content_key", contentKey)
    .order("start_ms", { ascending: true });
  if (error) throw error;
  const segments = (data || []).map((r) => ({
    kind: r.kind, startMs: Number(r.start_ms), endMs: r.end_ms != null ? Number(r.end_ms) : null,
    speaker: r.speaker, text: r.text || "", model: r.model,
  }));
  return { segments, text: transcriptText(segments) };
}

/* ── The job ───────────────────────────────────────────────────────────── */

/**
 * transcribeRecord — one record's bytes → transcript rows.
 * `fileUrl` is the presigned download the route resolved (ownership
 * checked there). Reports through onLog; returns a summary.
 */
export async function transcribeRecord({ userId, contentKey, recordName, kind, fileUrl, onLog = () => {} }) {
  const started = Date.now();
  const label = recordName || contentKey;
  onLog(`[av] ${label} — downloading the original…`);
  const dir = await mkdtemp(join(tmpdir(), "ak-av-"));
  try {
    const srcPath = join(dir, "source");
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Could not fetch the record (${res.status})`);
    await pipeline(res.body, createWriteStream(srcPath));
    onLog(`[av] extracted → ${kind === "video" ? "audio + scene frames" : "audio 16 kHz mono"}`);

    // 1 · Audio lane — 16 kHz mono, the §5 optimization.
    const audioPath = join(dir, "audio.mp3");
    await runFfmpeg(extractAudioArgs(srcPath, audioPath));
    onLog("[av] transcribing with Deepgram nova-2 (diarized)…");
    const dg = await transcribeFileDeepgram(audioPath, "audio/mpeg");
    onLog(`[av] speech: ${dg.paragraphs?.length || 0} paragraphs · ${(dg.fullText || "").split(/\s+/).filter(Boolean).length} words`);

    // 2 · Visual lane — scene-change frames, capped (video only).
    const frameRows = [];
    if (kind === "video" && MAX_FRAMES() > 0) {
      try {
        const outPattern = join(dir, "frame-%03d.jpg");
        let stderrTail = "";
        await runFfmpeg(sampleSceneFramesArgs(srcPath, outPattern, {
          maxFrames: MAX_FRAMES(), threshold: SCENE_THRESHOLD(),
        }), { onStderr: (s) => { stderrTail = s; } });
        const times = parseSceneTimes(stderrTail);
        const files = (await readdir(dir)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort();
        onLog(`[av] ${files.length} scene frame(s) sampled — captioning via ${FRAME_PROVIDER()}…`);
        for (const [i, f] of files.entries()) {
          const tSec = times[i] ?? 0;
          const caption = await captionFrame(join(dir, f), tSec);
          if (caption) frameRows.push({ tSec, caption });
        }
      } catch (err) {
        onLog(`[av] frame sampling skipped: ${String(err?.message || err).slice(0, 140)}`);
      }
    }

    const model = "deepgram/nova-2";
    const segments = shapeSegments({
      paragraphs: dg.paragraphs, fullText: dg.fullText, duration: dg.duration,
      frames: frameRows, model,
    });
    if (!segments.length) throw new Error("No speech or captions came out of this recording.");
    const saved = await replaceTranscript(userId, contentKey, segments, model);
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    onLog(`[av] done — ${saved} segment(s) in ${seconds}s`);
    return { segments: saved, durationSec: Math.round(dg.duration || 0), durationMs: Date.now() - started };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
