// modules/records/mediaClient.js
//
// The seam to the media container (media-worker/ — Cloudflare Container
// or any Docker host). When MEDIA_WORKER_URL is set, the ffmpeg half of
// the transcription lane runs THERE and the API only ever downloads the
// small artifacts (a 16 kHz mono mp3 is ~7 MB/hour; frames are capped):
// no more full-length originals or ffmpeg sharing the API's memory.
//
// Unset → every caller falls back to the in-process path unchanged.

const MW = () => String(process.env.MEDIA_WORKER_URL || "").replace(/\/+$/, "");

export const mediaWorkerEnabled = () =>
  !!(process.env.MEDIA_WORKER_URL && process.env.INTERNAL_SECRET);

function mwFetch(path, opts = {}) {
  return fetch(`${MW()}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_SECRET ?? "",
      ...(opts.headers || {}),
    },
  });
}

/** Stream a URL (presigned R2) to a local path. */
export async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch the media artifact (${res.status})`);
  const { pipeline } = await import("node:stream/promises");
  const { createWriteStream } = await import("node:fs");
  await pipeline(res.body, createWriteStream(destPath));
}

/**
 * remoteExtractAudio — run the container's extract job and wait it out.
 * Returns the job result: { audio: {key, url}, frames: [{key, url, tSec}], durationSec }.
 * Polls every 3s (a 100-minute lecture's extraction is minutes, not hours).
 */
export async function remoteExtractAudio({ url, kind, maxFrames, sceneThreshold, prefix, onLog = () => {}, timeoutMs = 45 * 60 * 1000 }) {
  const safePrefix = String(prefix || `av-cache/${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const res = await mwFetch("/jobs/extract-audio", {
    method: "POST",
    body: JSON.stringify({ url, kind, maxFrames, sceneThreshold, prefix: safePrefix }),
  });
  if (res.status === 409) throw new Error("The media worker's lane is busy — retry in a moment.");
  if (!res.ok) throw new Error(`The media worker rejected the job (${res.status}).`);
  const { data } = await res.json();
  const jobId = data?.jobId;
  if (!jobId) throw new Error("The media worker did not return a job id.");

  const t0 = Date.now();
  let seenLogs = 0;
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("The media worker took too long — the job keeps running there, retry to re-read it.");
    await new Promise((r) => setTimeout(r, 3000));
    const st = await mwFetch(`/jobs/${encodeURIComponent(jobId)}`);
    if (!st.ok) throw new Error(`Lost track of the media worker job (${st.status}).`);
    const { data: { job } } = await st.json();
    const lines = job?.log || [];
    if (lines.length > seenLogs) { lines.slice(seenLogs).forEach((l) => onLog(`[mw] ${l}`)); seenLogs = lines.length; }
    if (job?.state === "done") return job.result;
    if (job?.state === "failed") throw new Error(job.error || "The media worker job failed.");
  }
}
