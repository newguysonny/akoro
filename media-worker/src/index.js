// media-worker/src/index.js
//
// The container's HTTP surface. Small, boring, deliberate:
//
//   GET  /healthz              liveness (no auth — the platform probes it)
//   POST /jobs/encode          {videoId, courseId, sourceKey} — the course-video
//                              HLS pipeline (same flow/callbacks as the old
//                              BullMQ worker)
//   POST /jobs/extract-audio   {url, kind, maxFrames?, sceneThreshold?, jobId?}
//                              — the ffmpeg half of the A/V transcript lane
//   GET  /jobs/:id             snapshot { state, log, result }
//
// Every job endpoint answers 202 immediately; the API polls /jobs/:id.
// Every job endpoint requires x-internal-secret (the same shared secret
// the API's internal routes use) — this container can touch R2 and the
// API's internal callbacks, so it must never be publicly invokable.

import express from "express";
import { R2_ENABLED } from "./r2.js";
import { runEncodeJob } from "./encode.js";
import { runExtractJob } from "./extract.js";
import { startJob, getJob, listJobs, MAX_CONCURRENT_JOBS } from "./jobs.js";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "";
const PORT = parseInt(process.env.PORT ?? "8080", 10);

const app = express();
app.use(express.json({ limit: "256kb" }));

const configured = (_req, res, next) => {
  if (!INTERNAL_SECRET) return res.status(503).json({ success: false, error: "INTERNAL_SECRET is not set — the container is not usable yet." });
  if (!R2_ENABLED)      return res.status(503).json({ success: false, error: "R2 is not configured (R2_ACCESS_KEY_ID / R2_BUCKET_NAME)." });
  next();
};

const auth = (req, res, next) => {
  if (req.headers["x-internal-secret"] !== INTERNAL_SECRET) {
    return res.status(401).json({ success: false, error: "Bad internal secret" });
  }
  next();
};

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "akoro-media-worker", r2: R2_ENABLED, maxConcurrentJobs: MAX_CONCURRENT_JOBS });
});

app.post("/jobs/encode", configured, auth, (req, res) => {
  const { videoId, courseId, sourceKey } = req.body || {};
  if (!videoId || !courseId || !sourceKey) {
    return res.status(400).json({ success: false, error: "videoId, courseId and sourceKey are required." });
  }
  const { id, busy } = startJob("encode", ({ onLog, onProgress }) =>
    runEncodeJob({ videoId, courseId, sourceKey }, { onLog, onProgress }));
  if (!id) return res.status(409).json({ success: false, error: "All job lanes are busy.", busy });
  res.status(202).json({ success: true, data: { jobId: id } });
});

app.post("/jobs/extract-audio", configured, auth, (req, res) => {
  const { url, kind, maxFrames, sceneThreshold, prefix } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url is required." });
  const { id, busy } = startJob("extract", ({ onLog }) =>
    runExtractJob({ url, kind, maxFrames, sceneThreshold, prefix }, { onLog }));
  if (!id) return res.status(409).json({ success: false, error: "All job lanes are busy.", busy });
  res.status(202).json({ success: true, data: { jobId: id } });
});

app.get("/jobs/:id", configured, auth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: "No such job." });
  res.json({ success: true, data: { job } });
});

app.get("/jobs", configured, auth, (_req, res) => {
  res.json({ success: true, data: { jobs: listJobs(), maxConcurrentJobs: MAX_CONCURRENT_JOBS } });
});

app.use((_req, res) => res.status(404).json({ success: false, error: "Not found" }));

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "0.0.0.0", () => console.log(`[media-worker] listening on :${PORT}`));
}

export default app;
