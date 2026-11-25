---
title: POST /api/records/upload-url
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: records.request_upload
---

# POST /api/records/upload-url

Creates a presigned PUT so the browser can upload a Library file directly to
object storage.

## Authentication

Requires a learner session.

## Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | File name, max 255 |
| `mime` | string | yes | Must be a supported record type |
| `size` | integer | yes | Bytes; regular records max 500 MB |
| `purpose` | string | no | `record` (default) or `folder-cover` |

Folder covers must be images and are capped at 5 MB.

## Response

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...",
    "fileKey": "records/<userId>/...",
    "store": "r2"
  }
}
```

`store` is `r2` or `supabase`. The fallback store caps records at 5 MB.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Missing/invalid name, size, MIME or cover type |
| 401 | No session |
| 503 | The deployment has no R2 and the file is larger than 5 MB |

## Flow

1. Call this endpoint.
2. PUT the raw bytes to `uploadUrl`.
3. Call [`POST /api/records`](records-create.md) with `kind: "upload"`,
   `fileKey`, `name`, `mime` and `size`.

The upload URL is single-use and expires.

## Ownership

The returned key is under the caller's own prefix. A key from another learner
is rejected by the create step.

## Verification

- The PUT returns 200.
- `POST /api/records` creates the record.
- `GET /api/records` shows the new record.

## Related

- [Create a record](records-create.md)
- [Library overview](../../01-features/records/overview.md)
