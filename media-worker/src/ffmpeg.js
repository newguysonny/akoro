// media-worker/src/ffmpeg.js
//
// ffmpeg plumbing for the media worker — the SAME conventions the API's
// lanes use, extracted into pure arg builders so tests can pin them
// without a real binary:
//
//   · HLS encode  ← ported 1:1 from akoro-api/worker.js (variant table,
//     GOP, keyframes, 6s segments). Switched from a shell string to an
//     argv ARRAY (execFile) — same command, no quoting class to get wrong.
//   · 16 kHz mono audio + scene-change frames ← mirrored from
//     akoro-api/modules/records/avTranscribeLib.js (the §5 optimization:
//     STT-native rate, scene cuts not fixed intervals, hard frame cap).
//
// Nothing here touches the network or the filesystem outside the paths
// it is handed.

import { execFile } from "node:child_process";

export const FFMPEG_PATH  = process.env.FFMPEG_PATH  ?? "ffmpeg";
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? "ffprobe";

/** Spawn ffmpeg/ffprobe with an argv array; reject with the stderr tail. */
export function run(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const bin = args[0] === "ffprobe" ? FFPROBE_PATH : FFMPEG_PATH;
    const child = execFile(bin, args.slice(1), { maxBuffer: 16 * 1024 * 1024 }, (err) => {
      if (err) {
        err.message = `${bin} exited ${err.code}: ${(err.stderr || err.message || "").slice(-500)}`;
        reject(err);
      } else {
        resolve();
      }
    });
    if (onStderr) child.stderr.on("data", (d) => onStderr(String(d)));
  });
}

/* ── HLS encode (ported from worker.js) ─────────────────────────────────── */

export const BASE_VARIANTS = [
  { name: "360p",  resolution: "640x360",   bitrate: "800k",  maxrate: "1000k",  bufsize: "1600k",  profile: "main", level: "3.1" },
  { name: "480p",  resolution: "854x480",   bitrate: "1500k", maxrate: "2000k",  bufsize: "3200k",  profile: "main", level: "3.1" },
  { name: "720p",  resolution: "1280x720",  bitrate: "2500k", maxrate: "3500k",  bufsize: "5600k",  profile: "high", level: "4.0" },
  { name: "1080p", resolution: "1920x1080", bitrate: "5000k", maxrate: "7000k",  bufsize: "11200k", profile: "high", level: "4.2" },
];
export const VARIANT_4K = {
  name: "2160p", resolution: "3840x2160",
  bitrate: "12000k", maxrate: "16000k", bufsize: "25600k",
  profile: "high", level: "5.1",
};

/** One variant's ffmpeg argv — worker.js's command as an array. */
export function hlsVariantArgs(v, { inputPath, outputDir, gopSize }) {
  return [
    FFMPEG_PATH, "-y",
    "-i", inputPath,
    "-c:v", "libx264",
    "-preset", "medium",
    "-profile:v", v.profile,
    "-level:v", v.level,
    "-b:v", v.bitrate,
    "-maxrate", v.maxrate,
    "-bufsize", v.bufsize,
    "-s", v.resolution,
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-g", String(gopSize),
    "-keyint_min", String(gopSize),
    "-sc_threshold", "0",
    "-force_key_frames", "expr:gte(t,n_forced*4)",
    "-hls_time", "6",
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", `${outputDir}/${v.name}_%03d.ts`,
    `${outputDir}/${v.name}.m3u8`,
  ];
}

/** The master playlist body — same lines worker.js wrote. Pure. */
export function masterPlaylistBody(variants, frameRate) {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:6", ""];
  for (const v of variants) {
    const bw = parseInt(v.bitrate, 10) * 1000 + 128_000;
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${v.resolution},FRAME-RATE=${frameRate.toFixed(3)}`);
    lines.push(`${v.name}.m3u8`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Which variants a source gets — never upscale, 4K only from 4K. Pure. */
export function variantsFor(height) {
  return height >= 2160 ? [...BASE_VARIANTS, VARIANT_4K] : [...BASE_VARIANTS];
}

/* ── A/V extraction (mirrored from avTranscribeLib.js) ──────────────────── */

/** §5's optimization: 16 kHz mono — the rate STT is built around. */
export function extractAudioArgs(src, out) {
  return [FFMPEG_PATH, "-y", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", out];
}

/** Scene-change frames (NOT a fixed interval), downscaled, hard-capped. */
export function sampleSceneFramesArgs(src, outPattern, { maxFrames, threshold }) {
  return [
    FFMPEG_PATH, "-y", "-i", src,
    "-vf", `select='gt(scene,${threshold})',showinfo,scale=960:-2`,
    "-vsync", "vfr",
    "-frames:v", String(maxFrames),
    outPattern,
  ];
}

/** Parse ffmpeg showinfo's `pts_time:` stamps out of stderr — the scene
 *  cut timestamps, in stream order. Mirrors avTranscribeLib's parser. */
export function parseSceneTimes(stderr) {
  const times = [];
  const re = /pts_time:([0-9]+\.?[0-9]*)/g;
  let m;
  while ((m = re.exec(String(stderr || ""))) !== null) times.push(parseFloat(m[1]));
  return times;
}
