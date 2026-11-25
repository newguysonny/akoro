# Phase 2 Write-Path Test Fixtures

| Field | Value |
| --- | --- |
| Status | Records paste path executed 2026-11-25; course video and shared-write paths pending |
| Target | Sandbox `https://sandbox.akoro.ng` |
| Requirement | Every write uses disposable data and a cleanup path |
| Blocker | None for the records path; sandbox was live at build `8083074a` |

---

## 1. Safe to test with cleanup

### 1.1 Library paste → extract → ask → delete

Use the demo learner `stu.jss11@demo.akoro.app`. Executed successfully with the script `akoro-documentation/scripts/sandbox-write-smoke.mjs --confirm`; cleanup was verified.

1. `POST /api/records` with a unique paste name and a short factual note.
2. Poll `GET /api/records/extract/status?recordId=...`.
3. `POST /api/records/ask` with a question answerable from the note.
4. Verify citations.
5. `DELETE /api/records/:id`.
6. Verify the record is gone from `GET /api/records`.

Cleanup risk: the record may be soft-deleted and derived chunks/chat history may
remain. Use the sandbox only; do not run against production.

### 1.2 Course video upload → encode → delete

Use an instructor demo account and an owned test course.

1. `POST /api/stream/upload-url` with a small 3–5 second MP4.
2. PUT to the presigned URL.
3. `POST /api/stream/upload-complete`.
4. Poll `GET /api/stream/status/:videoId` until completed/failed.
5. `GET /api/stream/videos/:videoId`.
6. `DELETE /api/stream/videos/:videoId`.
7. Verify the video is removed and the R2 prefix is deleted.

Cleanup risk: R2 artifacts must be deleted by the delete route; verify by
checking the playback URL returns 404.

## 2. Do not test without an admin cleanup tool

These write to shared queues/inboxes and have no safe public delete:

- contact messages
- pilot applications
- blog subscriptions
- job applications
- account registration
- password reset / email verification
- 2FA setup/disable

Test only validation (`422`/`400`) unless an admin cleanup path is added.

## 3. Recommended fixture design

Add a test-only, secret-guarded cleanup endpoint or script that removes:

- test users and their sessions;
- test records and chunks/chat history;
- test videos and R2 prefixes;
- contact/pilot/blog/job test rows;
- test courses.

It must be disabled in production or require an explicit sandbox flag.

## 4. Execution order when sandbox clears

1. Confirm the build SHA.
2. Login as demo learner and instructor.
3. Run 1.1, then 1.2.
4. Clean up and verify.
5. Record results in `phase-2-verification.md`.
6. Update capability registry verification statuses.

## 5. Acceptance

- No write test leaves visible data.
- Cleanup is verified, not assumed.
- Failures include the exact response and the cleanup result.
