// media-worker/src/r2.js
//
// The R2 client — same account, same bucket, same key layout the API's
// worker.js uses. The container holds the long-term credentials so the
// API never has to (and never streams media through itself).

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const R2_BUCKET  = process.env.R2_BUCKET_NAME ?? "";
export const R2_PUBLIC  = process.env.R2_PUBLIC_URL  ?? "";
export const R2_ENABLED = !!(process.env.R2_ACCESS_KEY_ID && R2_BUCKET);

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID     ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  },
});

const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return {
    ".m3u8": "application/vnd.apple.mpegurl",
    ".ts":   "video/MP2T",
    ".json": "application/json",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
  }[ext] ?? "application/octet-stream";
};

/** Upload one local file to R2. Public-read, like every HLS artifact. */
export async function uploadFileAt(localPath, key) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: await readFile(localPath),
    ContentType: getContentType(key),
    ACL: "public-read",
  }));
  return `${R2_PUBLIC}/${key}`;
}

/**
 * Run async work with a fixed ceiling. A one-hour HLS rendition is ~600
 * segments; four renditions means ~2,400 files. `Promise.all` opened all
 * 2,400 PUTs at once and could exhaust memory/sockets (and R2 rate limits).
 */
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items);
  const max = Math.max(1, Number(limit) || 1);
  let next = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(max, list.length) }, async () => {
    while (!stopped && next < list.length) {
      const i = next++;
      try {
        await fn(list[i], i);
      } catch (err) {
        stopped = true;
        throw err;
      }
    }
  });
  await Promise.all(workers);
}

export const R2_UPLOAD_CONCURRENCY = Math.max(1, Number(process.env.R2_UPLOAD_CONCURRENCY) || 8);

/** Upload every file in localDir under r2Prefix; returns the public keys. */
export async function uploadDir(localDir, r2Prefix) {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(localDir);
  await mapLimit(files, R2_UPLOAD_CONCURRENCY,
    (file) => uploadFileAt(path.join(localDir, file), `${r2Prefix}/${file}`));
  return files.map((file) => `${r2Prefix}/${file}`);
}

/** Upload every file in localDir under r2Prefix; returns the public master.m3u8 URL. */
export async function uploadDirToR2(localDir, r2Prefix) {
  await uploadDir(localDir, r2Prefix);
  return `${R2_PUBLIC}/${r2Prefix}/master.m3u8`;
}

export async function deleteR2Object(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

/** A short-lived GET for artifacts the API pulls right after the job —
 *  works whether or not the prefix is publicly readable. */
export async function presignGet(key, { expiresIn = 3600 } = {}) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn });
}
