---
title: GET /api/records/extract/status
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: records.request_upload
---

# GET /api/records/extract/status

Reports whether extraction is still running and which pages remain.

## Authentication

Requires a learner session and access to the record/content key.

## Query parameters

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `recordId` | UUID | one of | The learner's own record |
| `contentKey` | string | one of | Shared/catalogue content key |

Use `recordId` for Library records. `contentKey` is for shared or catalogue
content that the caller can access.

## Response

The `data` shape varies by extraction lane. Common fields:

| Field | Meaning |
| --- | --- |
| `contentKey` | Extraction key |
| `done` | No work remains |
| `running` | A job is active |
| `pages` | Completed pages when available |
| `pending` | Page numbers still pending |
| `failed` | Page failures |

Downloading pages is a separate endpoint: `GET /api/records/extract/:recordId`
or `/extract/content/:key`.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Invalid/missing target |
| 401 | No session |
| 404 | Record not found or not visible |
| 501 | Extraction is not configured |

## Polling

Poll with backoff (for example 1s, 2s, 4s, then 10s). Do not poll faster than
once per second. Stop when `done` is true or a permanent error is returned.

## Related

- [Create a record](records-create.md)
- [Ask about a record](records-ask.md)
- [Library overview](../../01-features/records/overview.md)
