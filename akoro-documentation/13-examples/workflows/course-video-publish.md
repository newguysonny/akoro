---
title: Publish a course video
status: beta
doc_status: overview
tier: 1
audience: [instructor, developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
workflow_id: courses.publish_video
capabilities: []
---

# Publish a course video

## Objective

Upload a course-video source directly to R2, queue encoding, wait for HLS, and
publish a playable lesson.

## Required context

- Instructor/admin session.
- Owned course id.
- Source file, MIME type and byte size (max 2 GB on the direct lane).
- R2 CORS configured for the instructor origin.

## Steps

| Step | API | Success condition |
| --- | --- | --- |
| 1 | `POST /api/stream/upload-url` `{courseId,title,fileName,mime,size}` | 201, `videoId` + `uploadUrl` |
| 2 | PUT bytes to `uploadUrl` with returned headers | 200 from R2 |
| 3 | `POST /api/stream/upload-complete` `{videoId}` | 202, queued/encoding |
| 4 | `GET /api/stream/status/:videoId` | Poll until `completed` or `failed` |
| 5 | `GET /api/stream/videos/:videoId` | Playback URL |
| 6 | Verify the master playlist and one rendition | Player loads |

## Decision rules

| Condition | Action |
| --- | --- |
| PUT fails | Request a new upload URL; do not reuse |
| `upload-complete` 400 | PUT the object first; the API HEADs it |
| Status `queued` | Wait; the queue may be processing other videos |
| Status `failed` | Read `errorMessage`; retry only after fixing the source |
| 2 GB exceeded | Reject before upload; do not attempt |

## Failure and retry

- The queue is durable: an API restart does not lose a job.
- A busy encoder queues rather than rejecting.
- Do not call `upload-complete` twice; the endpoint is idempotent but a second
  source upload needs a new `videoId`.
- Encoding is asynchronous; never assume immediate playback.

## Verification

- Status reaches `completed`.
- `variants` lists the expected renditions.
- The master playlist and segment URLs are reachable.
- The lesson now points at the completed video.

## Prohibited

- Do not upload to a course the instructor does not own.
- Do not use the legacy multipart route for large files.
- Do not delete the source while encoding is running.
- Do not publish a failed/partial encode.

## Related

- [Courses and media](../../01-features/courses/overview.md)
- [Media queue plan](../../../docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md)
