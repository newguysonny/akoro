---
title: Upload a library record and ask about it
status: implemented
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
workflow_id: records.upload_and_ask
capabilities: [records.request_upload, records.create, records.ask]
---

# Upload a library record and ask about it

## Objective

Upload a learner's document, register it in the Library, wait for extraction,
and ask a grounded question with citations.

## Required context

- Authenticated learner session.
- File, paste or link.
- Target record id or content key.

## Steps

| Step | Capability/API | Success condition |
| --- | --- | --- |
| 1 | `POST /api/records/upload-url` `{name,mime,size}` | `uploadUrl`, `fileKey`, `store` |
| 2 | PUT bytes to `uploadUrl` | 200 from storage |
| 3 | `POST /api/records` `{kind:"upload",name,mime,size,fileKey}` | 201, record id |
| 4 | `GET /api/records/extract/status?recordId=...` | Poll until `done` |
| 5 | `GET /api/records/extract/:recordId` if needed | Extracted pages available |
| 6 | `POST /api/records/ask` `{recordId,question}` | Answer + citations |
| 7 | Verify citations point to the source | Answer is grounded |

For a paste, skip steps 1–3 and create `{kind:"paste",content,name?}`. For a
link, create `{kind:"link",url,name?}` and wait for the snapshot/index.

## Decision rules

| Condition | Action |
| --- | --- |
| Upload PUT fails | Request a new upload URL; do not reuse |
| `store: supabase` and file >5 MB | Block and request R2 configuration |
| Extraction still running | Back off and poll; do not start a duplicate |
| `ask` returns 409 | Extraction is not searchable yet; wait |
| No citations | Do not present the answer as sourced |
| Record not found/403 | Stop; do not guess another id |

## Failure and retry

- A failed PUT is safe to retry with a fresh URL.
- Creating the same record twice creates duplicates; check the shelf first.
- Poll extraction with backoff; do not hammer.
- `ask` has side effects (saves history), so do not retry blindly after a
  timeout; check the history or ask again with a new question.

## Verification

- `GET /api/records` contains the record.
- The file endpoint opens the stored file.
- Extraction status is `done`.
- The answer's citations resolve to pages in the record.

## Prohibited

- Do not upload another learner's file.
- Do not register a `fileKey` outside the caller's prefix.
- Do not invent citations or claim the document says something it does not.
- Do not retry a permanent 400/403.

## Related

- [Presign upload](../../02-api/endpoints/records-upload-url.md)
- [Create record](../../02-api/endpoints/records-create.md)
- [Extraction status](../../02-api/endpoints/records-extract-status.md)
- [Ask](../../02-api/endpoints/records-ask.md)
- [Library overview](../../01-features/records/overview.md)
