// media-worker/src/encode.js
//
// The course-video encode job — ported from akoro-api/worker.js with the
// BullMQ shell swapped for an HTTP trigger. The FLOW is identical, so the
// API's stream endpoints don't change at all:
//
//   ask the API for a signed source URL → download → ffmpeg HLS
//   (never upscale, 6s segments) → upload to R2 → delete staging →
//   POST /api/stream/internal/update with the same payload shape.

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { promisify } from "node:util";
import { FFPROBE_PATH, hlsVariantArgs, masterPlaylistBody, variantsFor, run } from "./ffmpeg.js";
import { R2_BUCKET, uploadDir, uploadDirToR2, deleteR2Object } from "./r2.js";

export const apiBaseUrl = () => process.env.API_BASE_URL ?? "http://localhost:4000";
const internalSecret = () => process.env.INTERNAL_SECRET ?? "";

const execAsync = promisify(execFile);

/** Ask the API for a 1-hour signed R2 URL for the staged source. */
export async function getSourceUrl(videoId) {
  const res = await fetch(`${apiBaseUrl()}/api/stream/internal/source-url/${videoId}`, {
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret() },
  });
  if (!res.ok) throw new Error(`getSourceUrl failed ${res.status}: ${await res.text()}`);
  return res.json();   // { signedUrl, sourceKey }
}

/** Push progress/status back to the API — same endpoint, same payload. */
export async function updateVideoStatus(videoId, data) {
  const res = await fetch(`${apiBaseUrl()}/api/stream/internal/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret() },
    body: JSON.stringify({ videoId, ...data }),
  });
  if (!res.ok) throw new Error(`updateVideoStatus failed ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

/** Stream a URL to disk (native http/https — no extra deps, small memory). */
export const downloadFromSignedUrl = (signedUrl, destPath) =>
  new Promise((resolve, reject) => {
    const proto = signedUrl.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);
    proto.get(signedUrl, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath).catch(() => {});
        return reject(new Error(`download failed ${res.statusCode} for ${signedUrl.split("?")[0]}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => { fs.unlink(destPath).catch(() => {}); reject(err); });
  });

/** ffprobe the source — { width, height, frameRate, duration, fileSize }. */
export async function probeVideo(inputPath) {
  const { stdout } = await execAsync(FFPROBE_PATH, [
    "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", inputPath,
  ], { maxBuffer: 16 * 1024 * 1024 });
  const info = JSON.parse(stdout);
  const vs = info.streams.find((s) => s.codec_type === "video");
  if (!vs) throw new Error("no video stream found");
  const [num, den] = (vs.avg_frame_rate ?? "30/1").split("/").map(Number);
  const stats = await fs.stat(inputPath);
  return {
    width: vs.width,
    height: vs.height,
    frameRate: den ? num / den : 30,
    duration: parseFloat(info.format.duration ?? "0"),
    fileSize: stats.size,
  };
}

/**
 * encodeToHLS — adaptive HLS at multiple resolutions.
 * Never upscales; 4K only from 4K; 6-second segments; onProgress(0-100).
 * Returns { variants[], duration, fileSize }.
 */
export async function encodeToHLS(inputPath, outputDir, videoId, onProgress = async () => {}) {
  const { width, height, frameRate, duration, fileSize } = await probeVideo(inputPath);
  const gopSize = Math.floor(frameRate * 4);
  const all = variantsFor(height);

  await fs.mkdir(outputDir, { recursive: true });

  const encoded = [];
  for (let i = 0; i < all.length; i++) {
    const v = all[i];
    const [vW] = v.resolution.split("x").map(Number);
    if (vW > width) continue;   // never upscale
    await onProgress(Math.floor((i / all.length) * 85));
    await run(hlsVariantArgs(v, { inputPath, outputDir, gopSize }));
    encoded.push(v);
  }
  if (!encoded.length) throw new Error(`source (${width}px wide) is narrower than every variant`);

  await fs.writeFile(path.join(outputDir, "master.m3u8"), masterPlaylistBody(encoded, frameRate));
  await fs.writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({
    duration, resolution: `${width}x${height}`, frameRate,
    variants: encoded.map((v) => v.name), encodedAt: new Date().toISOString(),
  }, null, 2));

  await onProgress(90);
  return { variants: encoded.map((v) => v.name), duration, fileSize };
}

/**
 * runEncodeJob — the whole pipeline for one video. Throws on failure;
 * the caller (jobs registry) records the error and notifies the API.
 */
export async function runEncodeJob({ videoId, courseId, sourceKey }, { onLog = () => {}, onProgress = async () => {} } = {}) {
  onLog(`[encode] ${videoId} — requesting signed URL`);
  const { signedUrl } = await getSourceUrl(videoId);
  await updateVideoStatus(videoId, { encodingStatus: "encoding", encodingProgress: 0 }).catch(() => {});

  const jobTempDir = path.join(process.env.TEMP_DIR ?? "/tmp", videoId);
  const outputDir  = path.join(process.env.TEMP_DIR ?? "/tmp", `encoded_${videoId}`);
  await fs.mkdir(jobTempDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  let completed = false;
  try {
    const ext = path.extname(sourceKey) || ".mp4";
    const sourcePath = path.join(jobTempDir, `source${ext}`);
    onLog(`[encode] downloading source (${R2_BUCKET}/${sourceKey})`);
    await downloadFromSignedUrl(signedUrl, sourcePath);
    await updateVideoStatus(videoId, { encodingProgress: 5 }).catch(() => {});

    const result = await encodeToHLS(sourcePath, outputDir, videoId, onProgress);
    onLog(`[encode] variants: ${result.variants.join(",")}`);

    const r2Prefix = `courses/${courseId}/videos/${videoId}/hls`;
    await updateVideoStatus(videoId, { encodingProgress: 92 }).catch(() => {});
    const videoUrl = await uploadDirToR2(outputDir, r2Prefix);
    onLog(`[encode] HLS uploaded → ${videoUrl}`);

    await deleteR2Object(sourceKey).catch(() => {});
    await updateVideoStatus(videoId, {
      encodingStatus: "completed",
      encodingProgress: 100,
      videoUrl,
      hlsPath: r2Prefix,
      duration: result.duration,
      fileSize: result.fileSize,
      variants: JSON.stringify(result.variants),
      sourceKey: null,   // staging is deleted
    });
    completed = true;
    onLog(`[encode] ${videoId} complete`);
    return { videoUrl, variants: result.variants, duration: result.duration, fileSize: result.fileSize };
  } catch (err) {
    // The old BullMQ "failed" listener told the API. Without this the
    // video sits at "encoding" forever after an ffmpeg/R2/API failure.
    if (!completed) {
      await updateVideoStatus(videoId, {
        encodingStatus: "failed",
        errorMessage: String(err?.message || err).slice(0, 500),
      }).catch(() => {});
    }
    throw err;
  } finally {
    await fs.rm(jobTempDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
}


/** ffprobe a signed source URL without downloading it — the fan-out planner. */
export async function probeSourceUrl(signedUrl) {
  const { stdout } = await execAsync(FFPROBE_PATH, [
    "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", signedUrl,
  ], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
  const info = JSON.parse(stdout);
  const vs = info.streams?.find((s) => s.codec_type === "video");
  if (!vs?.width || !vs?.height) throw new Error("no video stream found in the staged source");
  const [num, den] = String(vs.avg_frame_rate ?? vs.r_frame_rate ?? "30/1").split("/").map(Number);
  const variants = variantsFor(vs.height).filter((v) => {
    const [w, h] = v.resolution.split("x").map(Number);
    return w <= vs.width && h <= vs.height;   // never upscale either axis
  });
  return {
    width: vs.width,
    height: vs.height,
    frameRate: den ? num / den : 30,
    duration: parseFloat(info.format?.duration ?? "0") || 0,
    fileSize: Number(info.format?.size ?? 0) || 0,
    variants,
  };
}

/**
 * runVariantJob — encode exactly one rendition on this container. The API
 * coordinator fans a video out to one container per variant, then writes
 * the master playlist. No /internal/update calls: progress belongs to the
 * coordinator (several containers would race the same video row).
 */
export async function runVariantJob(
  { videoId, courseId, sourceKey, variant, frameRate },
  { onLog = () => {}, onProgress = async () => {} } = {},
) {
  if (!variant?.name || !variant?.resolution) throw new Error("a variant is required");
  const { signedUrl } = await getSourceUrl(videoId);
  const tempRoot = path.join(process.env.TEMP_DIR ?? "/tmp", `variant_${videoId}_${variant.name}_${Date.now()}`);
  const outputDir = path.join(tempRoot, "out");
  await fs.mkdir(outputDir, { recursive: true });
  try {
    const ext = path.extname(sourceKey || "") || ".mp4";
    const sourcePath = path.join(tempRoot, `source${ext}`);
    onLog(`[variant] ${variant.name} — downloading source`);
    await onProgress(5);
    await downloadFromSignedUrl(signedUrl, sourcePath);
    await onProgress(20);

    const gopSize = Math.max(1, Math.floor((Number(frameRate) || 30) * 4));
    onLog(`[variant] ${variant.name} — ffmpeg ${variant.resolution}`);
    await run(hlsVariantArgs(variant, { inputPath: sourcePath, outputDir, gopSize }));
    await onProgress(90);

    const r2Prefix = `courses/${courseId}/videos/${videoId}/hls/${variant.name}`;
    const keys = await uploadDir(outputDir, r2Prefix);
    onLog(`[variant] ${variant.name} — uploaded ${keys.length} files`);
    await onProgress(98);
    return { variant: variant.name, r2Prefix, files: keys.length };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}
