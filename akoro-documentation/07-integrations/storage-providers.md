---
title: Storage providers
status: implemented
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Storage providers

## Purpose

All file storage — learner library uploads, course media, generated
artefacts — lives in **Cloudflare R2**, accessed through its S3-compatible
API. The API uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`;
there is no other object-storage provider in the codebase (in particular,
Supabase Storage is not used — see [Supabase](supabase.md)).

## How it is wired

- Clients never receive storage credentials. The API checks authentication
  and ownership first, then issues a short-lived presigned URL (SigV4) for
  the exact object: a presigned PUT for upload, a presigned GET for reads of
  private objects. The PUT to the presigned URL is object-storage transport,
  not an Akoro API operation.
- Buckets are private. A private or premium record returns 404 to a
  non-owner, so object existence does not leak through the API.
- CORS for browser uploads is configured on the bucket side (`lib/r2Cors.js`)
  to allow the platform's own origins.
- Public course media may be served from the bucket's public URL; private
  learner content is never on a public URL.

## Configuration surface (names only)

| Variable | Role |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account hosting the bucket |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | S3-compatible credentials, server-side only |
| `R2_BUCKET_NAME` | The platform bucket |
| `R2_PUBLIC_URL` | Public base URL for published media |

## Failure handling

- R2 calls pass through a dedicated circuit breaker (`lib/r2Breaker.js`):
  when storage is failing, callers get a clean error instead of stacked
  timeouts, and uploads can be retried by the client.
- An upload is not complete when the bytes land; the record is created
  through the API afterwards, and extraction status is tracked separately,
  so a stored-but-unprocessed file is a visible state, not a silent success.
- There is no fallback storage provider. An R2 outage blocks uploads and
  private-file reads; already-issued presigned URLs remain valid until they
  expire.

## Data shared and privacy impact

R2 holds the actual file bytes: learner documents, images, audio and course
media. Access control is entirely Akoro-side — R2 itself only sees
presigned, single-object, short-lived grants. Because presigning happens
only after the API's ownership check, the privacy boundary is the API, and
any change that hands out presigned URLs without that check breaks it. One
known exception is tracked in the platform plan: course video streaming
currently hands an authenticated user the permanent public CDN URL without
an enrolment check; it is noted for fixing before paid video courses ship.

## Related

- [Supabase](supabase.md)
- [Educational content](educational-content.md)
- [Agent permissions](../06-agents/agent-permissions.md)
