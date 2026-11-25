/**
 * Pure/contract tests for the fan-out lane: named containers, the nested
 * master playlist, and the variant dispatch URL. The BullMQ coordinator
 * itself needs Redis + Cloudflare, so its retry/checkpoint structure is
 * pinned by the source-contract test next door.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { masterPlaylistBody } from "./mediaEncodeQueue.js";
import { containerNameFor, dispatchEncodeVariant, dispatchInspect } from "./encodeDispatch.js";

test("container names are DO-safe, unique per variant, and within 64 bytes", () => {
  const a = containerNameFor("a9026ed1-1ffd-4dde-b9a9-6ad1e81efcbc", "360p");
  const b = containerNameFor("a9026ed1-1ffd-4dde-b9a9-6ad1e81efcbc", "1080p");
  assert.match(a, /^video-[a-zA-Z0-9_-]+-360p$/);
  assert.notEqual(a, b);
  assert.ok(a.length <= 64 && b.length <= 64);
  assert.equal(containerNameFor("a/b c", "x/y"), "video-abc-xy");
});

test("the master playlist points at <variant>/<variant>.m3u8", () => {
  const body = masterPlaylistBody([
    { name: "360p", resolution: "640x360", bitrate: "800k" },
    { name: "1080p", resolution: "1920x1080", bitrate: "5000k" },
  ], 30);
  assert.match(body, /#EXT-X-STREAM-INF:BANDWIDTH=928000,RESOLUTION=640x360,FRAME-RATE=30\.000/);
  assert.match(body, /#EXT-X-STREAM-INF:BANDWIDTH=5128000,RESOLUTION=1920x1080,FRAME-RATE=30\.000/);
  assert.match(body, /^360p\/360p\.m3u8$/m);
  assert.match(body, /^1080p\/1080p\.m3u8$/m);
});

test("variant dispatch names its container and posts exactly one rendition", async () => {
  process.env.MEDIA_WORKER_URL = "https://mw.invalid";
  process.env.INTERNAL_SECRET = "test-secret";
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, data: { jobId: "j-v" } }), { status: 202 });
  };
  const variant = { name: "720p", resolution: "1280x720", bitrate: "2500k", maxrate: "3500k", bufsize: "5600k", profile: "high", level: "4.0" };
  const jobId = await dispatchEncodeVariant({
    videoId: "v1", courseId: "c1", sourceKey: "courses/c1/videos/v1/source.mp4",
    variant, frameRate: 30, container: "video-v1-720p",
  }, { fetchImpl });
  assert.equal(jobId, "j-v");
  assert.equal(seen[0].url, "https://mw.invalid/jobs/encode-variant?instance=video-v1-720p");
  assert.equal(seen[0].headers["x-internal-secret"], "test-secret");
  assert.equal(seen[0].body.variant.name, "720p");
  assert.equal(seen[0].body.frameRate, 30);
});

test("inspect asks the planner container for the variant plan", async () => {
  process.env.MEDIA_WORKER_URL = "https://mw.invalid";
  process.env.INTERNAL_SECRET = "test-secret";
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ success: true, data: {
      width: 1920, height: 1080, frameRate: 30, duration: 60, fileSize: 1000,
      variants: [{ name: "1080p", resolution: "1920x1080", bitrate: "5000k" }],
    } }), { status: 200 });
  };
  const plan = await dispatchInspect({ videoId: "v1" }, { fetchImpl });
  assert.equal(seen[0].url, "https://mw.invalid/jobs/inspect?instance=planner");
  assert.equal(seen[0].body.videoId, "v1");
  assert.equal(plan.variants[0].name, "1080p");
});

test("the coordinator resumes from job data and fans out one dispatch per rendition", async () => {
  const http = await import("node:http");
  const { processVideoJob } = await import("./mediaEncodeQueue.js");
  const { VideoStore } = await import("./video-store.js");

  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      calls.push({ url: req.url, body: raw ? JSON.parse(raw) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url.startsWith("/jobs/inspect")) {
        res.end(JSON.stringify({ success: true, data: {
          width: 1920, height: 1080, frameRate: 30, duration: 60, fileSize: 1000,
          variants: [
            { name: "360p", resolution: "640x360", bitrate: "800k", maxrate: "1000k", bufsize: "1600k", profile: "main", level: "3.1" },
            { name: "720p", resolution: "1280x720", bitrate: "2500k", maxrate: "3500k", bufsize: "5600k", profile: "high", level: "4.0" },
          ],
        } }));
      } else if (req.url.startsWith("/jobs/encode-variant")) {
        const body = JSON.parse(raw);
        res.end(JSON.stringify({ success: true, data: { jobId: `j-${body.variant.name}` } }));
      } else if (req.url.startsWith("/jobs/j-")) {
        const name = req.url.split("/jobs/j-")[1].split("?")[0];
        res.end(JSON.stringify({ success: true, data: { job: { state: "done", result: { variant: name } } } }));
      } else {
        res.end(JSON.stringify({ success: true, data: {} }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const prior = {
    media: process.env.MEDIA_WORKER_URL,
    secret: process.env.INTERNAL_SECRET,
    get: VideoStore.get,
    update: VideoStore.update,
  };
  process.env.MEDIA_WORKER_URL = `http://127.0.0.1:${port}`;
  process.env.INTERNAL_SECRET = "test-secret";
  const updates = [];
  VideoStore.get = async (id) => ({ id, courseId: "c1", encodingStatus: "queued" });
  VideoStore.update = async (id, patch) => { updates.push({ id, patch }); return { id, ...patch }; };

  const job = {
    data: { videoId: "v1", courseId: "c1", sourceKey: "courses/c1/videos/v1/source.mp4" },
    updateData: async (next) => { job.data = next; },
  };

  try {
    // R2 is deliberately unconfigured in this test: reaching the finaliser
    // proves dispatch + polling completed without needing Cloudflare/R2.
    await assert.rejects(() => processVideoJob(job), /R2 is not configured/);
  } finally {
    server.close();
    VideoStore.get = prior.get;
    VideoStore.update = prior.update;
    process.env.MEDIA_WORKER_URL = prior.media;
    process.env.INTERNAL_SECRET = prior.secret;
  }

  assert.equal(job.data.plan.variants.length, 2);
  assert.equal(job.data.variants["360p"].state, "completed");
  assert.equal(job.data.variants["720p"].state, "completed");
  assert.equal(calls.filter((c) => c.url.startsWith("/jobs/encode-variant")).length, 2);
  assert.ok(calls.some((c) => c.url.includes("instance=planner")));
  assert.ok(updates.some((u) => u.patch.encodingProgress > 0));
});
