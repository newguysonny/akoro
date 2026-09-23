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

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl }                       from "@aws-sdk/s3-request-presigner";
import config                                 from "../../../config/index.js";
import db                                     from "../../../db.js";

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

/** Presign a PUT for one record file. Key is always under the owner's prefix. */
export async function createPresignedUpload(fileName, fileType, userId) {
  const safe = String(fileName || "record").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);

  if (recordsStorageEnabled()) {
    const key  = `records/${userId}/${Date.now()}-${safe}`;
    const cmd  = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType || "application/octet-stream" });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
    return { uploadUrl, fileKey: key };
  }

  // No R2 on this deployment — small files go to the Supabase fallback.
  // Supabase's signed upload URL takes the same raw PUT the client already
  // sends (Content-Type and all), so nothing on the learner changes.
  const key = `${FALLBACK_PREFIX}${userId}/${Date.now()}-${safe}`;
  await ensureFallbackBucket();
  const { data, error } = await db.storage.from(FALLBACK_BUCKET).createSignedUploadUrl(key);
  if (error || !/^https?:\/\//i.test(String(data?.signedUrl || ""))) {
    throw new Error(`Supabase storage could not sign the upload: ${error?.message || "no signed URL returned"}`);
  }
  return { uploadUrl: data.signedUrl, fileKey: key };
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
  try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey })); }
  catch (err) { console.error("[records/storage] delete failed:", err.message); }
}
