/**
 * modules/records/lib/storage.js
 * File storage for library records — Cloudflare R2, the same store task
 * files and course videos use. Uploads never pass through the API: the
 * client PUTs the raw bytes straight to a presigned URL (works for
 * 500 MB lesson recordings on a phone), then registers the key. Reads
 * are presigned GETs served by the store with range support, so
 * <audio>/<video> seeking and pdf.js page fetches work without the API
 * proxying a single byte.
 *
 * Deployments WITHOUT R2 (the R2_* variables unset) still get a working
 * Library: files up to 5 MB ride the SUPABASE FALLBACK — a private
 * Supabase Storage bucket the API creates on first use. The protocol is
 * identical (signed upload URL up, signed GET down, bytes still never
 * touch the API), so the learner client neither knows nor cares which
 * store a record lives in.
 *
 * Which store an object lives in is encoded in its file_key:
 *   records/<userId>/…          → R2
 *   records-supabase/<userId>/… → the Supabase fallback bucket
 * so wiring R2 up later doesn't orphan pre-R2 records — reads and
 * deletes keep dispatching on the key, and only NEW uploads move to R2.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl }                       from "@aws-sdk/s3-request-presigner";
import config                                 from "../../../config/index.js";
import db                                     from "../../../db.js";
import { r2Send } from "../../../lib/r2Breaker.js";

const s3 = new S3Client({
  region:    "auto",
  endpoint:  `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});
const BUCKET = config.r2.bucketName;

/* ── Supabase fallback (pre-R2) ──────────────────────────────────────────── */
const FALLBACK_PREFIX = "records-supabase/";          // file_key prefix → store dispatch
const FALLBACK_BUCKET = config.supabase.recordsBucket;
const DOWNLOAD_TTL_SECONDS = 60 * 60 * 6;             // 6h — outlasts a long study sit

/** The most one fallback file may weigh — enough to use the Library before R2. */
export const MAX_FALLBACK_FILE_BYTES = 5 * 1024 * 1024;

export const recordsStorageEnabled = () => !!config.r2.enabled;

/** Does this key live in the Supabase fallback bucket? */
export const isFallbackFileKey = (fileKey) =>
  typeof fileKey === "string" && fileKey.startsWith(FALLBACK_PREFIX);

/** A key is the learner's own only under their own prefix — in either store. */
export function ownsRecordFileKey(fileKey, userId) {
  const key = String(fileKey || "");
  if (key.includes("..")) return false;   // no path traversal, in either store
  return key.startsWith(`records/${userId}/`) || key.startsWith(`${FALLBACK_PREFIX}${userId}/`);
}

/* The fallback bucket is created on demand — private, and hard-capped at
   5 MB by Supabase itself so the no-R2 path can't be used as free
   big-file hosting. The result is cached; a failed probe is forgotten so
   the next upload retries instead of being stuck on one bad moment. */
let fallbackBucketReady = null;
function ensureFallbackBucket() {
  if (!fallbackBucketReady) {
    fallbackBucketReady = db.storage
      .createBucket(FALLBACK_BUCKET, { public: false, fileSizeLimit: MAX_FALLBACK_FILE_BYTES })
      .then(({ error }) => {
        if (error && !/already exist|duplicate/i.test(String(error?.message || ""))) {
          throw new Error(`Supabase storage bucket "${FALLBACK_BUCKET}" is unavailable: ${error.message}`);
        }
        return true;
      });
    fallbackBucketReady.catch(() => { fallbackBucketReady = null; });  // retry on the next upload
  }
  return fallbackBucketReady;
}

/* ── R2 liveness ───────────────────────────────────────────────────────────
 * Presigning is OFFLINE SigV4 — it cannot detect an R2 outage. The only
 * way to know R2 will take the bytes before handing the client a URL is
 * a cheap HeadBucket through the SAME breaker every other R2 op uses, so
 * a tripped breaker answers instantly instead of hanging the upload-url
 * request. A success is trusted for 60s — one probe per minute, not one
 * per upload; if R2 dies inside that minute the client's PUT fails
 * exactly as it would have before this fallback existed. */
const R2_PROBE_OK_MS = 60 * 1000;
let r2ProbeOkUntil = 0;
async function r2Reachable() {
  if (Date.now() < r2ProbeOkUntil) return true;
  try {
    await r2Send(s3, new HeadBucketCommand({ Bucket: BUCKET }));
    r2ProbeOkUntil = Date.now() + R2_PROBE_OK_MS;
    return true;
  } catch (err) {
    console.error("[records/storage] R2 unreachable — files up to 5 MB will ride the Supabase fallback:", err.message);
    return false;
  }
}

/** Presign a PUT for one record file. Key is always under the owner's prefix.
 *  R2 is PRIMARY. `sizeBytes` (when the caller knows it) decides the failure
 *  lane: files over MAX_FALLBACK_FILE_BYTES are R2-only and skip the probe
 *  entirely — nothing else can hold them, so if R2 is down their PUT fails
 *  with R2's own error; files up to the cap fall back to Supabase whenever
 *  R2 is unreachable. Unknown size conservatively stays fallback-eligible —
 *  Supabase's own fileSizeLimit backstops the PUT. Returns
 *  { uploadUrl, fileKey, store } — store is "r2" or "supabase". */
export async function createPresignedUpload(fileName, fileType, userId, { sizeBytes } = {}) {
  const safe = String(fileName || "record").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

  if (recordsStorageEnabled()) {
    const tooBigForFallback = Number.isFinite(sizeBytes) && sizeBytes > MAX_FALLBACK_FILE_BYTES;
    if (tooBigForFallback || (await r2Reachable())) {
      const key  = `records/${userId}/${Date.now()}-${safe}`;
      const cmd  = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType || "application/octet-stream" });
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
      return { uploadUrl, fileKey: key, store: "r2" };
    }
    console.warn("[records/storage] R2 down — this upload rides the Supabase fallback");
  }

  // No R2 on this deployment — or R2 is down and the file fits the fallback.
  // Supabase's signed upload URL takes the same raw PUT the client already
  // sends (Content-Type and all), so nothing on the learner changes.
  const key = `${FALLBACK_PREFIX}${userId}/${Date.now()}-${safe}`;
  await ensureFallbackBucket();
  const { data, error } = await db.storage.from(FALLBACK_BUCKET).createSignedUploadUrl(key);
  if (error || !/^https?:\/\//i.test(String(data?.signedUrl || ""))) {
    throw new Error(`Supabase storage could not sign the upload: ${error?.message || "no signed URL returned"}`);
  }
  return { uploadUrl: data.signedUrl, fileKey: key, store: "supabase" };
}

/** A readable URL for the file — inline for the viewer (media/pdf),
 *  attachment when downloading. Dispatches on the key's store prefix. */
export async function createPresignedDownload(fileKey, { downloadName } = {}) {
  if (isFallbackFileKey(fileKey)) {
    const name = downloadName
      ? String(downloadName).replace(/[^a-zA-Z0-9 ._ -]/g, "_").slice(0, 150)
      : null;
    const { data, error } = await db.storage.from(FALLBACK_BUCKET)
      .createSignedUrl(fileKey, DOWNLOAD_TTL_SECONDS, name ? { download: name } : {});
    if (error || !data?.signedUrl) {
      throw new Error(`Supabase storage could not sign the file: ${error?.message || "no signed URL returned"}`);
    }
    return data.signedUrl;
  }
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    fileKey,
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${String(downloadName).replace(/[^a-zA-Z0-9 ._ -]/g, "_").slice(0, 150)}"` }
      : {}),
  });
  return getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL_SECONDS });  // 6h — outlasts a long study sit
}

/**
 * Write bytes the SERVER made (a generated podcast episode) under the
 * learner's own prefix → the key. R2 when configured, else the Supabase
 * fallback (which refuses anything over its 5 MB cap). `name` is a short
 * label, e.g. "podcasts/<id>.mp3".
 */
export async function putRecordObject({ userId, name, body, contentType }) {
  const safe = String(name || "object").replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\.+/g, ".").slice(-160);
  if (recordsStorageEnabled()) {
    const key = `records/${userId}/${Date.now()}-${safe}`;
    await r2Send(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
    return key;
  }
  if (body.length > MAX_FALLBACK_FILE_BYTES) {
    throw new Error("This episode is too large for the built-in storage (5 MB) — choose a shorter length.");
  }
  const key = `${FALLBACK_PREFIX}${userId}/${Date.now()}-${safe}`;
  await ensureFallbackBucket();
  const { error } = await db.storage.from(FALLBACK_BUCKET).upload(key, body, { contentType, upsert: false });
  if (error) throw new Error(`Supabase storage could not save the file: ${error.message}`);
  return key;
}

/** Best-effort remove — a deleted record never blocks on storage. */
export async function removeRecordFile(fileKey) {
  if (!fileKey) return;
  if (isFallbackFileKey(fileKey)) {
    try {
      const { error } = await db.storage.from(FALLBACK_BUCKET).remove([fileKey]);
      if (error) throw error;
    } catch (err) { console.error("[records/storage] fallback delete failed:", err.message); }
    return;
  }
  try { await r2Send(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey })); }
  catch (err) { console.error("[records/storage] delete failed:", err.message); }
}
