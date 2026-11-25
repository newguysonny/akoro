// modules/courses/encodeDispatch.js
//
// The encode-lane seam. When MEDIA_WORKER_URL is set, course-video work is
// handed to the media container (media-worker/):
//   POST /jobs/inspect        → ffprobe + the variant list (fast, no lane)
//   POST /jobs/encode-variant → one variant on one container
//   GET  /jobs/:id            → poll a container job
//   POST /jobs/encode         → legacy one-container full encode (fallback)
// The container drives the same /api/stream/internal/* callbacks for the
// legacy path; the fan-out coordinator owns progress/finalisation itself.
//
// `instance` selects the Cloudflare Durable Object / container. A unique
// name per video/variant is what makes max_instances actually autoscale;
// omitting it keeps the old singleton behaviour (extract lane, tests).

const MEDIA = () => String(process.env.MEDIA_WORKER_URL || "").replace(/\/+$/, "");

const headers = () => ({
  "Content-Type": "application/json",
  "x-internal-secret": process.env.INTERNAL_SECRET ?? "",
});

/** A stable, DO-safe name. `video-<uuid>-360p` is 48 bytes. */
export function containerNameFor(videoId, suffix = "job") {
  const id = String(videoId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const tail = String(suffix || "job").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12);
  return `video-${id}-${tail}`;
}

const urlFor = (path, container) => {
  const base = `${MEDIA()}${path}`;
  return container ? `${base}?instance=${encodeURIComponent(container)}` : base;
};

async function post(path, body, { container, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(urlFor(path, container), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const err = new Error("The media worker's lane is busy — retry shortly.");
    err.code = "LANE_BUSY";
    throw err;
  }
  if (!res.ok) throw new Error(`The media worker rejected the job (${res.status}).`);
  const { data } = await res.json();
  if (!data?.jobId) throw new Error("The media worker did not return a job id.");
  return data.jobId;
}

/**
 * dispatchEncode — the legacy full-video job (one container, sequential
 * variants). Kept as the fallback when the queue/worker cannot run.
 */
export async function dispatchEncode({ videoId, courseId, sourceKey, container }, opts = {}) {
  return post("/jobs/encode", { videoId, courseId, sourceKey }, { ...opts, container });
}

/** One variant on its own container. */
export async function dispatchEncodeVariant(
  { videoId, courseId, sourceKey, variant, frameRate, container },
  opts = {},
) {
  return post("/jobs/encode-variant", { videoId, courseId, sourceKey, variant, frameRate }, { ...opts, container });
}

/** ffprobe the signed source and return { width, height, frameRate, duration, fileSize, variants }. */
export async function dispatchInspect({ videoId, container = "planner" }, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(urlFor("/jobs/inspect", container), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ videoId }),
  });
  if (!res.ok) throw new Error(`The media worker could not inspect the source (${res.status}).`);
  const { data } = await res.json();
  if (!data?.variants?.length) throw new Error("The media worker returned no variants.");
  return data;
}

/** Poll a job on the same container that accepted it. */
export async function getEncodeJob({ container, jobId }, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(urlFor(`/jobs/${encodeURIComponent(jobId)}`, container), {
    headers: { "x-internal-secret": process.env.INTERNAL_SECRET ?? "" },
  });
  if (res.status === 404) {
    const err = new Error("The media container no longer has this job.");
    err.code = "JOB_NOT_FOUND";
    throw err;
  }
  if (!res.ok) throw new Error(`Lost track of the media worker job (${res.status}).`);
  const { data } = await res.json();
  return data?.job ?? null;
}
