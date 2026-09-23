/**
 * modules/records/lib/storage.js
 * File storage for library records — Cloudflare R2, the same store task
 * files and course videos use. Uploads never pass through the API: the
 * client PUTs the raw bytes straight to a presigned URL (works for
 * 500 MB lesson recordings on a phone), then registers the key. Reads
 * are presigned GETs served by Cloudflare with range support, so
 * <audio>/<video> seeking and pdf.js page fetches work without the API
 * proxying a single byte.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl }                       from "@aws-sdk/s3-request-presigner";
import config                                 from "../../../config/index.js";

const s3 = new S3Client({
  region:    "auto",
  endpoint:  `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});
const BUCKET = config.r2.bucketName;

export const recordsStorageEnabled = () => !!config.r2.enabled;

/** Presign a PUT for one record file. Key is always records/<userId>/… */
export async function createPresignedUpload(fileName, fileType, userId) {
  const safe = String(fileName || "record").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const key  = `records/${userId}/${Date.now()}-${safe}`;
  const cmd  = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType || "application/octet-stream" });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  return { uploadUrl, fileKey: key };
}

/** Presign a GET — inline for the viewer (media/pdf), attachment when downloading. */
export function createPresignedDownload(fileKey, { downloadName } = {}) {
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key:    fileKey,
    ...(downloadName
      ? { ResponseContentDisposition: `attachment; filename="${String(downloadName).replace(/[^a-zA-Z0-9 ._ -]/g, "_").slice(0, 150)}"` }
      : {}),
  });
  return getSignedUrl(s3, cmd, { expiresIn: 60 * 60 * 6 });  // 6h — outlasts a long study sit
}

/** Best-effort remove — a deleted record never blocks on storage. */
export async function removeRecordFile(fileKey) {
  if (!fileKey) return;
  try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey })); }
  catch (err) { console.error("[records/storage] delete failed:", err.message); }
}
