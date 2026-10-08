// modules/courses/encodeDispatch.js
//
// The encode-lane dispatch — one seam, kept free of stream.js's heavy
// imports so it stays unit-testable. When MEDIA_WORKER_URL is set, a
// course-video upload is handed to the media container (media-worker/):
// the container answers 202 with its own jobId and then drives the SAME
// /api/stream/internal/* callbacks the old BullMQ worker did — so the
// instructor's status polling and the auto-transcribe hook are unchanged,
// and the media bytes move container ↔ R2, never through this server.

const MEDIA = () => String(process.env.MEDIA_WORKER_URL || "").replace(/\/+$/, "");

/**
 * dispatchEncode — hand one encode job to the media container.
 * Returns the container's jobId. Throws (loudly) on a busy lane, a
 * rejection, or a malformed reply — the caller decides how honest to be.
 * fetchImpl is injection for tests.
 */
export async function dispatchEncode({ videoId, courseId, sourceKey }, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${MEDIA()}/jobs/encode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_SECRET ?? "",
    },
    body: JSON.stringify({ videoId, courseId, sourceKey }),
  });
  if (res.status === 409) throw new Error("The media worker's encode lane is busy — retry shortly.");
  if (!res.ok) throw new Error(`The media worker rejected the encode job (${res.status}).`);
  const { data } = await res.json();
  if (!data?.jobId) throw new Error("The media worker did not return a job id.");
  return data.jobId;
}
