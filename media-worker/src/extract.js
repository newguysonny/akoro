// media-worker/src/extract.js
//
// The A/V extraction job — the ffmpeg HALF of the API's transcription
// lane, lifted out of the API process. The API claims the content job,
// hands this container a URL, and gets back:
//
//   { audio: {key, url}, frames: [{key, url, tSec}], durationSec }
//
// — a 16 kHz mono mp3 (STT-native, tiny: ~7 MB/hour) and hard-capped
// scene-change frames. Deepgram, captions, transcripts and the database
// stay in the API; only the heavy media handling lives here.
//
// Sources: any fetchable URL. HLS playlists (course streams) are NOT
// downloaded — ffmpeg demuxes them natively; plain files stream to disk.

import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { extractAudioArgs, sampleSceneFramesArgs, parseSceneTimes, run } from "./ffmpeg.js";
import { uploadFileAt, presignGet } from "./r2.js";

export const isHlsUrl = (url) => /\.m3u8($|\?)/i.test(url || "");

export const downloadTo = (url, destPath) =>
  new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(destPath).catch(() => {});
        return reject(new Error(`download failed ${res.statusCode} for ${url.split("?")[0]}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => { fs.unlink(destPath).catch(() => {}); reject(err); });
  });

/** ffprobe's duration as seconds (best-effort — 0 when it can't tell). */
export async function probeDuration(inputPath) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { FFPROBE_PATH } = await import("./ffmpeg.js");
  try {
    const { stdout } = await promisify(execFile)(FFPROBE_PATH,
      ["-v", "quiet", "-print_format", "json", "-show_format", inputPath]);
    return parseFloat(JSON.parse(stdout).format?.duration ?? "0") || 0;
  } catch { return 0; }
}

/**
 * runExtractJob — extract audio + scene frames from one source.
 * { url, kind: 'audio'|'video', maxFrames?, sceneThreshold?, prefix? }
 * Returns { audio, frames, durationSec }; throws on hard failure.
 */
export async function runExtractJob(
  { url, kind = "video", maxFrames, sceneThreshold, prefix },
  { onLog = () => {} } = {},
) {
  if (!url) throw new Error("url is required");
  const isVideo = kind !== "audio";
  const maxFramesCap = Math.max(0, Math.min(Number(maxFrames) || 24, 60));
  const threshold = Number.isFinite(Number(sceneThreshold)) ? Number(sceneThreshold) : 0.4;
  const base = prefix || `av-cache/${randomUUID()}`;

  const dir = await fs.mkdtemp(path.join(process.env.TEMP_DIR ?? "/tmp", "ak-av-"));
  try {
    // Source: HLS reads straight through ffmpeg; other URLs download first.
    const srcPath = isHlsUrl(url) ? url : path.join(dir, "source");
    if (!isHlsUrl(url)) {
      onLog(`[extract] downloading source`);
      await downloadTo(url, srcPath);
    }

    // 1 · Audio — 16 kHz mono (the small artifact the API transcribes).
    const audioPath = path.join(dir, "audio.mp3");
    onLog(`[extract] ffmpeg → 16 kHz mono mp3`);
    await run(extractAudioArgs(srcPath, audioPath));

    // 2 · Visual lane — scene-change frames, capped (video only).
    const frames = [];
    if (isVideo && maxFramesCap > 0) {
      try {
        const outPattern = path.join(dir, "frame-%03d.jpg");
        let stderrTail = "";
        onLog(`[extract] sampling scene frames`);
        await run(sampleSceneFramesArgs(srcPath, outPattern, { maxFrames: maxFramesCap, threshold }),
          { onStderr: (s) => { stderrTail += s; } });
        const times = parseSceneTimes(stderrTail);
        const files = (await fs.readdir(dir)).filter((f) => /^frame-\d+\.jpg$/.test(f)).sort();
        for (const [i, f] of files.entries()) {
          const tSec = times[i] ?? 0;
          const key = `${base}/${f}`;
          await uploadFileAt(path.join(dir, f), key);
          frames.push({ key, url: await presignGet(key), tSec });
        }
        onLog(`[extract] ${frames.length} frame(s)`);
      } catch (err) {
        onLog(`[extract] frame sampling skipped: ${String(err?.message || err).slice(0, 140)}`);
      }
    }

    const audioKey = `${base}/audio.mp3`;
    await uploadFileAt(audioPath, audioKey);
    const durationSec = await probeDuration(isHlsUrl(url) ? srcPath : audioPath).catch(() => 0);
    onLog(`[extract] done — audio + ${frames.length} frame(s) → ${base}/`);

    return {
      audio: { key: audioKey, url: await presignGet(audioKey) },
      frames,
      durationSec,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
