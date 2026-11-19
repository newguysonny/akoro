/**
 * modules/records/service-transcribe.js — audio/video transcription
 * (ffmpeg 16k-mono → Deepgram, scene frames → captions) and the
 * course-lesson lane.
 *
 * The job downloads the ORIGINAL via presigned URL, extracts audio at the
 * STT-native rate (16 kHz mono — never the raw video), transcribes with
 * nova-2 (diarized, paragraph-timestamped), samples scene-change frames
 * for slide captions, and writes edu.content_transcripts (delete-then-
 * insert — re-running is idempotent). One job per record at a time.
 */
import { createPresignedDownload } from "./lib/storage.js";
import { avEnabled, transcribeRecord, getTranscript } from "./avTranscribeLib.js";
import { claimContentJob, finishContentJob, getContentJob } from "./extractLib.js";
import { indexByContentKey } from "./searchLib.js";
import { avKindFor } from "./rules.js";
import { res400 } from "./http.js";
import * as store from "./store-records.js";
import { resolveAiContent } from "./service-extract.js";

/* ── Course-video transcription target ───────────────────────────────────────
 * A lesson's video_url (often a presigned, expiring HLS stream) transcribes
 * into the SAME shared cache a record uses, keyed `lesson:<id>` — one
 * transcription per lesson for everyone, claimed once. Access mirrors
 * GET /api/lessons/:id exactly: instructors/admins, active enrollees, and
 * preview lessons. */
export async function resolveLessonContent(lessonId, user, { requireVideo = true } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return { status: 400, message: "A valid lessonId is required." };
  const { data: lesson, error } = await store.getLessonWithCourse(lessonId);
  if (error) throw error;
  if (!lesson) return { status: 404, message: "Lesson not found." };
  if (requireVideo && !lesson.video_url) return { status: 400, message: "This lesson has no video to transcribe yet." };

  if (!lesson.is_preview && !["instructor", "admin"].includes(user.role)) {
    const courseId = lesson.course_modules?.course_id;
    const { data: enrollment } = await store.getActiveEnrollment(user.id, courseId);
    if (!enrollment) return { status: 403, message: "Enrol in this course to use this lesson." };
  }
  return {
    contentKey: `lesson:${lesson.id}`,
    name: lesson.title,
    mime: "video/mp4",
    fileUrl: lesson.video_url,
  };
}

const avJobs = new Map();   // recordId → { running, startedAt, finishedAt, log, result }
const avJobSnapshot = (j) => j && ({
  running: j.running, startedAt: j.startedAt, finishedAt: j.finishedAt,
  log: j.log.slice(-60), result: j.result,
});

export async function startTranscription(req, res) {
  if (!avEnabled()) {
    return res.status(501).json({ success: false, error: "Transcription isn't configured on this deployment yet." });
  }
  // Two target kinds share this lane: a library record (recordId/contentKey —
  // the file downloads via presigned URL) and a course lesson (lessonId — the
  // stream URL is already fetchable, HLS included; ffmpeg reads it directly).
  const lessonId = String(req.body?.lessonId || "");
  let target;
  if (lessonId) {
    target = await resolveLessonContent(lessonId, req.user);
    if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  } else {
    const id = await resolveAiContent(req);
    if (id.status) return res.status(id.status).json({ success: false, message: id.message });
    target = { ...id, fileUrl: await createPresignedDownload(id.contentKey, { downloadName: id.name }) };
  }
  const { contentKey, name: recName, fileUrl } = target;

  const mime = target.mime || "";
  const avKind = avKindFor(mime, recName || "");
  if (!avKind) return res400(res, "Only audio and video records transcribe.");

  // Cross-instance single flight (edu.content_jobs) — a shared recording
  // is transcribed ONCE no matter who opens it first.
  const claimed = await claimContentJob(contentKey, "av", req.user.id);
  if (!claimed) {
    return res.status(409).json({ success: false, error: "This recording is being transcribed right now — the shared transcript will appear in a moment.", job: await getContentJob(contentKey, "av") });
  }
  const job = { running: true, startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null };
  avJobs.set(contentKey, job);
  transcribeRecord({
    userId: req.user.id, contentKey, recordName: recName, kind: avKind, fileUrl,
    onLog: (line) => job.log.push(line),
  })
    .then((result) => {
      job.result = result;
      // Search index (owner's record; lesson keys resolve to no record and
      // are skipped) — never blocks the job's completion.
      void indexByContentKey({ contentKey, segments: result.segments });
      return finishContentJob(contentKey, "av", "done", { segments: result.segments });
    })
    .catch((err) => {
      job.log.push(`[av] FAILED: ${String(err?.message || err).slice(0, 220)}`);
      job.result = { ok: false, error: String(err?.message || err).slice(0, 220) };
      return finishContentJob(contentKey, "av", "failed", { error: String(err?.message || err).slice(0, 200) });
    })
    .finally(() => { job.running = false; job.finishedAt = new Date().toISOString(); });

  res.json({ success: true, data: { job: avJobSnapshot(job), kind: avKind } });
}

export async function getLessonTranscription(req, res) {
  const target = await resolveLessonContent(String(req.params.lessonId || ""), req.user, { requireVideo: false });
  if (target.status) return res.status(target.status).json({ success: false, message: target.message });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(target.contentKey) || null) || await getContentJob(target.contentKey, "av"),
    transcript: await getTranscript(target.contentKey),
  } });
}

export async function getRecordTranscription(req, res) {
  const recordId = String(req.params.recordId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res400(res, "A recordId is required.");
  const { data: rec, error } = await store.getRecordFileForOwner(recordId, req.user.id);
  if (error) throw error;
  if (!rec) return res.status(404).json({ success: false, message: "Record not found." });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(rec.file_key) || null),
    transcript: rec.file_key ? await getTranscript(rec.file_key) : { segments: [], text: "" },
  } });
}

export async function getContentTranscription(req, res) {
  const contentKey = String(req.params.key || "");
  if (!contentKey) return res400(res, "A content key is required.");
  const probe = { ...req, body: { contentKey } };
  const id = await resolveAiContent(probe);
  if (id.status) return res.status(id.status).json({ success: false, message: id.message });
  res.json({ success: true, data: {
    job: avJobSnapshot(avJobs.get(id.contentKey) || null) || await getContentJob(id.contentKey, "av"),
    transcript: await getTranscript(id.contentKey),
  } });
}
