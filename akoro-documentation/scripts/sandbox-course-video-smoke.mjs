#!/usr/bin/env node
/**
 * Disposable sandbox course + video pipeline smoke.
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-course-video-smoke.mjs --confirm
 *
 * Flow:
 *   1. Log in as the sandbox demo instructor.
 *   2. Create a disposable draft course.
 *   3. Generate a 2-second MP4 in /tmp with ffmpeg.
 *   4. POST /api/stream/upload-url, PUT the bytes, POST /api/stream/upload-complete.
 *   5. Poll GET /api/stream/status/:videoId (backoff, 8-minute cap).
 *   6. Verify the completed video URL through GET /api/stream/videos/:videoId.
 *   7. DELETE the video and the course, then verify both are gone.
 *
 * Cleanup runs in a `finally` block. If R2 or the media worker is unavailable,
 * the script reports the blocker and still removes the course and video row.
 * It refuses to run against anything except sandbox.akoro.ng.
 */
import { execFile } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const PORTAL = "instructor";
const EMAIL = process.env.SANDBOX_INSTRUCTOR_EMAIL || "teacher1@demo.akoro.app";
const PASSWORD = process.env.SANDBOX_INSTRUCTOR_PASSWORD || "Amara2026";
const POLL_BUDGET_MS = 8 * 60 * 1000;

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log("Would: login instructor -> create draft course -> ffmpeg 2s MP4 ->");
  console.log("upload-url -> PUT -> upload-complete -> poll status -> verify watch URL ->");
  console.log("delete video + course -> verify cleanup.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const headers = (extra = {}) => ({ "X-Akoro-Portal": PORTAL, "Content-Type": "application/json", ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const marker = `docs-video-smoke-${stamp}`;

let courseId = null;
let videoId = null;
let failed = false;
let blocked = false;

function note(message) { console.log(message); }
function problem(message, r) {
  failed = true;
  console.error(`FAIL: ${message}`);
  if (r) console.error(`HTTP ${r.status}: ${String(r.text).slice(0, 400)}`);
}

async function call(path, { method = "GET", cookie = "", body, portal } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers({ ...(cookie ? { Cookie: cookie } : {}), ...(portal ? { "X-Akoro-Portal": portal } : {}) }),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 400); }
  return { status: res.status, headers: res.headers, data, text };
}

function rateLimited(r) {
  return r.status === 429
    || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "")
    || /hibernate-rate-limited/i.test(String(r.text).slice(0, 400));
}
function cookiesOf(r) {
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
}

async function makeMp4() {
  const file = join(tmpdir(), `${marker}.mp4`);
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=160x120:r=10:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "32k", "-shortest",
    "-movflags", "+faststart", file,
  ], { timeout: 60_000 });
  const info = await stat(file);
  if (info.size < 1024) throw new Error(`ffmpeg produced an unexpectedly small file (${info.size} bytes)`);
  return { file, size: info.size };
}

async function cleanup() {
  if (videoId) {
    const del = await call(`/api/stream/videos/${encodeURIComponent(videoId)}`, { method: "DELETE", cookie: instructorCookie });
    if (del.status === 200 || del.status === 404) {
      const check = await call(`/api/stream/status/${encodeURIComponent(videoId)}`, { cookie: instructorCookie, portal: "instructor" });
      if (check.status === 404) note(`cleanup: video ${videoId} deleted and not found`);
      else { failed = true; console.error(`cleanup: video ${videoId} still readable (HTTP ${check.status})`); }
    } else {
      failed = true;
      console.error(`cleanup: video delete failed HTTP ${del.status}: ${String(del.text).slice(0, 300)}`);
    }
  }
  if (courseId) {
    const del = await call(`/api/instructor/courses/${encodeURIComponent(courseId)}`, { method: "DELETE", cookie: instructorCookie });
    if (del.status === 200 || del.status === 404) {
      const list = await call("/api/instructor/courses", { cookie: instructorCookie });
      const rows = Array.isArray(list.data?.data) ? list.data.data : [];
      if (list.status === 200 && !rows.some((row) => row.id === courseId)) {
        note(`cleanup: course ${courseId} deleted and not listed`);
      } else {
        failed = true;
        console.error(`cleanup: course ${courseId} is still listed (HTTP ${list.status})`);
      }
    } else {
      failed = true;
      console.error(`cleanup: course delete failed HTTP ${del.status}: ${String(del.text).slice(0, 300)}`);
    }
  }
}

let instructorCookie = "";
let mp4 = null;

try {
  const login = await call("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  if (rateLimited(login)) {
    blocked = true;
    console.error("BLOCKED: sandbox is hibernate-rate-limited. No writes performed.");
    process.exit(2);
  }
  if (login.status !== 200) { problem("instructor login failed", login); throw new Error("login"); }
  instructorCookie = cookiesOf(login);
  if (!instructorCookie) { problem("login returned no session cookie", login); throw new Error("login cookie"); }
  note("1/7 instructor login ok");

  const created = await call("/api/instructor/courses", {
    method: "POST",
    cookie: instructorCookie,
    body: {
      title: marker,
      description: "Disposable sandbox verification course. Safe to delete.",
      level: "all",
      type: "on-demand",
      status: "draft",
      price: 0,
      isFree: true,
    },
  });
  if (rateLimited(created)) {
    blocked = true;
    console.error("BLOCKED: sandbox became hibernate-rate-limited during course creation.");
    throw new Error("rate-limited");
  }
  if (created.status !== 201) { problem("course creation failed", created); throw new Error("course"); }
  courseId = created.data?.data?.id;
  if (!courseId) { problem("course response had no id", created); throw new Error("course id"); }
  note(`2/7 course created ${courseId}`);

  mp4 = await makeMp4();
  note(`3/7 generated ${(mp4.size / 1024).toFixed(1)} KiB MP4 at ${mp4.file}`);

  const signed = await call("/api/stream/upload-url", {
    method: "POST",
    cookie: instructorCookie,
    body: {
      courseId,
      title: marker,
      fileName: `${marker}.mp4`,
      mime: "video/mp4",
      size: mp4.size,
    },
  });
  if (rateLimited(signed)) {
    blocked = true;
    console.error("BLOCKED: sandbox became hibernate-rate-limited during upload-url.");
    throw new Error("rate-limited");
  }
  if (signed.status !== 201) { problem("upload-url failed", signed); throw new Error("upload-url"); }
  videoId = signed.data?.data?.videoId;
  const uploadUrl = signed.data?.data?.uploadUrl;
  if (!videoId || !uploadUrl) { problem("upload-url response missing videoId/uploadUrl", signed); throw new Error("upload-url shape"); }

  const bytes = await import("node:fs/promises").then((m) => m.readFile(mp4.file));
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", ...(signed.data?.data?.headers || {}) },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) {
    const text = await put.text().catch(() => "");
    problem(`R2 PUT failed HTTP ${put.status}: ${String(text).slice(0, 300)}`);
    throw new Error("put");
  }
  note(`4/7 PUT ${bytes.length} bytes to signed URL`);

  const complete = await call("/api/stream/upload-complete", {
    method: "POST",
    cookie: instructorCookie,
    body: { videoId },
  });
  const completeData = complete.data?.data || {};
  note(`5/7 upload-complete HTTP ${complete.status} encodingStatus=${completeData.encodingStatus ?? "?"} via=${completeData.via ?? "?"}`);
  if (complete.status !== 200 && complete.status !== 202) {
    problem("upload-complete failed", complete);
    throw new Error("upload-complete");
  }
  if (completeData.encodingStatus === "failed") {
    console.error(`BLOCKED: encoder unavailable — ${completeData.message || "upload-complete reported failed"}`);
    blocked = true;
    throw new Error("encoder");
  }

  const deadline = Date.now() + POLL_BUDGET_MS;
  let delay = 2000;
  let status = null;
  let lastState = "";
  while (Date.now() < deadline) {
    status = await call(`/api/stream/status/${encodeURIComponent(videoId)}`, { cookie: instructorCookie, portal: "instructor" });
    if (rateLimited(status)) {
      blocked = true;
      console.error("BLOCKED: sandbox became hibernate-rate-limited during status polling.");
      throw new Error("rate-limited");
    }
    if (status.status !== 200) { problem("status polling failed", status); throw new Error("status"); }
    const data = status.data?.data || {};
    const state = `${data.encodingStatus ?? "?"}:${data.encodingProgress ?? "?"}`;
    if (state !== lastState) { note(`   status ${state}`); lastState = state; }
    if (data.encodingStatus === "completed") {
      if (!data.videoUrl) { problem("completed status has no videoUrl", status); throw new Error("no videoUrl"); }
      const watch = await call(`/api/stream/videos/${encodeURIComponent(videoId)}`, { cookie: instructorCookie });
      if (watch.status !== 200 || !watch.data?.data?.url) {
        problem("watch endpoint did not return a completed video URL", watch);
        throw new Error("watch");
      }
      note(`6/7 encoding complete in ${Math.round((POLL_BUDGET_MS - (deadline - Date.now())) / 1000)}s; watch URL present`);
      break;
    }
    if (data.encodingStatus === "failed") {
      blocked = true;
      console.error(`BLOCKED: encoding reported failed (progress ${data.encodingProgress ?? "?"})`);
      throw new Error("encoding failed");
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.6), 20_000);
  }
  if (status?.data?.data?.encodingStatus !== "completed") {
    blocked = true;
    console.error(`BLOCKED: encoding did not finish within ${POLL_BUDGET_MS / 60000} minutes (last ${lastState})`);
  } else {
    note("7/7 course-video pipeline verified");
  }
} catch (e) {
  if (!failed) console.error(`STOPPED: ${e.message}`);
} finally {
  if (instructorCookie) await cleanup().catch((e) => { failed = true; console.error(`cleanup error: ${e.message}`); });
  if (mp4?.file) await unlink(mp4.file).catch(() => {});
}

if (failed) process.exit(1);
if (blocked) process.exit(2);
