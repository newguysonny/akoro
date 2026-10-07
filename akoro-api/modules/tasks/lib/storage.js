/**
 * modules/tasks/lib/storage.js
 * File storage for task files — uses Cloudflare R2 (same as video uploads).
 * Reuses R2 config from config/index.js.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import config           from "../../../config/index.js";
import { r2Send } from "../../../lib/r2Breaker.js";

const s3 = new S3Client({
  region:      "auto",
  endpoint:    `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey },
});
const BUCKET = config.r2.bucketName;

export async function createPresignedUpload(fileName, fileType, teacherId) {
  const key = `task-files/${teacherId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const cmd = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType });
  const url = await getSignedUrl(s3, cmd, { expiresIn: 900 });
  return { uploadUrl: url, fileKey: key, publicUrl: `${config.r2.publicUrl}/${key}` };
}

export async function deleteFile(fileKey) {
  await r2Send(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: fileKey }));
}
