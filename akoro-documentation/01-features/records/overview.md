---
title: Library and records overview
status: implemented
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Library and records overview

The Library stores learner materials as **records**. A record can be an uploaded
file (PDF, Office document, text, image, audio or video), a pasted note or a
saved link.

Uploads go directly from the browser to object storage via a presigned URL. The
API never buffers the file bytes for the presigned path.

## Core flow

1. `POST /api/records/upload-url` with `{ name, mime, size }`.
2. PUT the file bytes to the returned `uploadUrl`.
3. `POST /api/records` with `{ kind: "upload", name, fileKey, size }` to create
   the record.
4. Extraction may run automatically. Poll `GET /api/records/extract/status` or
   read `GET /api/records/extract/:recordId`.
5. Read, search, ask, generate study material or add the record to a folder.

## Main endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/records/upload-url` | Presign an upload |
| POST | `/api/records` | Create an upload, paste or link record |
| GET | `/api/records` | List the caller's shelf |
| GET | `/api/records/search?q=` | Search the caller's own chunks |
| GET | `/api/records/discover` | Browse shared Discover records |
| POST | `/api/records/ask` | Ask a question grounded in a record |
| POST | `/api/records/guide` | Generate a guided reading/study response |
| GET | `/api/records/folders` | List folders |
| POST | `/api/records/folders` | Create a folder |
| POST | `/api/records/tools/:tool` | Run a study-material tool |
| GET | `/api/records/:id/file` | Open the stored file |
| GET | `/api/records/:id/preview` | Open the generated preview |

All record endpoints require an authenticated learner session and enforce
record ownership.

## Limits

- Regular records: up to 500 MB per file.
- Folder covers: image only, up to 5 MB.
- Shelf: up to 200 records.
- Deployments without R2 can store files up to 5 MB in Supabase Storage;
  larger files require R2.

## Extraction

Scanned PDFs and images use DeepSeek OCR with a vision-model fallback. Text
PDFs use the text layer. Audio/video can be transcribed. Extraction state is
per record and may be asynchronous.

## Capabilities

- `records.list`
- `records.request_upload`
- `records.ask`

## Related

- [API overview](../../02-api/README.md)
- [OpenAPI](../../02-api/openapi.yaml)
- [Courses and media](../courses/overview.md)
