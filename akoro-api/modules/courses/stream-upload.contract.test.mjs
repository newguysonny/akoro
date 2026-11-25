/**
 * modules/courses/stream-upload.contract.test.mjs
 *
 * Guards the two upload fixes:
 *   • course videos go browser → R2 (presigned), so the API never buffers
 *     a lecture recording; the legacy inline route is capped small;
 *   • video rows live in Postgres, not a module array, so an API restart
 *     during a long encode does not make the worker's callback a 404.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  MAX_INLINE_BYTES, MAX_SOURCE_BYTES, ALLOWED_VIDEO_MIME, sourceExt, sourceKeyFor,
} from "./stream-presign.js";
import { rowToVideo, videoToRow, parseVariants } from "./video-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const [streamSrc, presignSrc] = await Promise.all([
  read("stream.js"),
  read("stream-presign.js"),
]);

test("direct upload keeps the worker's key layout and accepts only video types", () => {
  assert.equal(MAX_SOURCE_BYTES, 2 * 1024 * 1024 * 1024);
  assert.equal(MAX_INLINE_BYTES, 64 * 1024 * 1024);
  assert.ok(ALLOWED_VIDEO_MIME.has("video/mp4"));
  assert.equal(sourceExt("lecture.MP4", "video/mp4"), ".mp4");
  assert.equal(sourceExt("lecture", "video/webm"), ".webm");
  assert.equal(
    sourceKeyFor({ courseId: "c1", videoId: "v1", fileName: "a.mov", mime: "video/quicktime" }),
    "courses/c1/videos/v1/source.mov",
  );
});

test("the API no longer buffers a large course video", () => {
  assert.match(streamSrc, /import makeStreamUploadRouter,[\s\S]*?MAX_INLINE_BYTES/, "the direct lane is mounted");
  assert.match(streamSrc, /router\.use\(makeStreamUploadRouter\(\{ r2, bucket: R2_BUCKET, encodingQueue \}\)\)/);
  assert.match(streamSrc, /limits:\s*\{ fileSize: MAX_INLINE_BYTES \}/, "legacy inline route is capped");
  assert.doesNotMatch(streamSrc, /2 \* 1024 \* 1024 \* 1024/, "the old 2 GB memory buffer is gone");
  assert.match(presignSrc, /router\.post\("\/upload-url"/, "presign endpoint");
  assert.match(presignSrc, /router\.post\("\/upload-complete"/, "completion endpoint");
  assert.match(presignSrc, /canManageCourse\(req\.user, courseId\)/, "only the course owner can stage");
  assert.match(presignSrc, /HeadObjectCommand/, "completion checks the object that actually landed");
  assert.match(presignSrc, /enqueueMediaEncode\(/, "completion queues the fan-out lane");
  assert.match(presignSrc, /dispatchEncode\(\{ videoId, courseId: video\.courseId, sourceKey: video\.sourceKey \}\)/, "direct dispatch remains the fallback");
});

test("video rows map to/from Postgres without leaking storage fields", () => {
  const row = rowToVideo({
    id: "v1", course_id: "c1", title: "Lesson", order_index: 2,
    is_preview: true, source_key: "courses/c1/videos/v1/source.mp4",
    variants: '["360p","720p"]', encoding_status: "queued", encoding_progress: 0,
    file_size: 123, created_at: "t", updated_at: "t",
  });
  assert.equal(row.courseId, "c1");
  assert.equal(row.orderIndex, 2);
  assert.equal(row.isPreview, true);
  assert.deepEqual(row.variants, ["360p", "720p"]);
  assert.equal(row.encodingStatus, "queued");

  const patch = videoToRow({
    encodingStatus: "completed", encodingProgress: 100,
    variants: ["360p"], sourceKey: null, nonsense: "drop me",
  });
  assert.deepEqual(patch, {
    encoding_status: "completed", encoding_progress: 100,
    variants: ["360p"], source_key: null,
  });
  assert.equal(parseVariants("not json"), "not json");
});
