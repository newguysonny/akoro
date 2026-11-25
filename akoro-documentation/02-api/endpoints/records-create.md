---
title: POST /api/records
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: records.create
---

# POST /api/records

Creates a Library record after an upload, or creates a paste/link record.

## Authentication

Requires a learner session.

## Request body

One of three shapes.

### Upload

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string | yes | `upload` |
| `name` | string | yes | Max 255 |
| `fileKey` | string | yes | From `upload-url`, under the caller's prefix |
| `size` | integer | yes | Bytes |
| `mime` | string | recommended | Required for type detection |
| `duration` | number | no | Media duration in seconds |
| `legacy` | boolean | no | Detail-only device record; no stored bytes |

### Link

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string | yes | `link` |
| `url` | string | yes | `http(s)` URL |
| `name` | string | no | Defaults to the host |

### Paste

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | string | yes | `paste` |
| `content` | string | yes | Max 20,000 characters |
| `name` | string | no | Defaults to the first 60 characters |

## Response

`201` with the created record in `data`.

## Side effects

- Creates preview, index and extraction jobs asynchronously where applicable.
- Audio/video may transcribe automatically.
- Scanned PDFs/images may start OCR.
- Text PDFs/Office files may extract their text layer.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Invalid kind, missing fields, unsupported type, or shelf full |
| 401 | No session |
| 403 | `fileKey` does not belong to the caller |

## Verification

- `GET /api/records` includes the record.
- `GET /api/records/:id/file` works for uploads.
- Extraction status eventually leaves `running`.

## Related

- [Presign an upload](records-upload-url.md)
- [Extraction status](records-extract-status.md)
- [Ask about a record](records-ask.md)
