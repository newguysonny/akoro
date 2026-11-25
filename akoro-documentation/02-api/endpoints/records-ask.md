---
title: POST /api/records/ask
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: records.ask
---

# POST /api/records/ask

Answers a question grounded in a record or folder, with citations.

## Authentication

Requires a learner session and access to the target.

## Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `question` | string | yes | Non-empty; length limited |
| `recordId` | UUID | one target | The learner's own record |
| `contentKey` | string | one target | Shared/catalogue content |
| `folderId` | UUID | one target | Ask across a folder |
| `selection` | object | no | A page/text selection to ground the answer |

Supply exactly one target.

## Streaming

Add `?stream=1` for Server-Sent Events:

- `status` — progress labels.
- `delta` — answer text chunks.
- `done` — answer, citations, coverage, message id.
- `error` — failure.

Without streaming, the response is JSON.

## Response

```json
{
  "success": true,
  "data": {
    "answer": "Answer with [1] citation markers.",
    "citations": [ { "marker": 1, "page": 2 } ],
    "messageId": "uuid",
    "passages": 4,
    "coverage": { "score": 0.8, "claims": 5, "cited": 4, "unknown": [] }
  }
}
```

## Errors

| Status | Meaning | Recovery |
| --- | --- | --- |
| 400 | Missing question or target | Fix the request |
| 401 | No session | Sign in |
| 404 | Record/folder not found or not visible | Check ownership |
| 409 | Document not searchable yet | Extract/transcribe, then retry |

## Side effects

The turn is saved to the learner's private ask history for that record/folder.

## Agent guidance

- Do not ask about a record before extraction/transcription is searchable.
- Do not invent citations; use the returned citation markers.
- Do not assume an answer is correct because it is fluent; verify against the
  cited passages when the task requires accuracy.

## Related

- [Extraction status](records-extract-status.md)
- [Library overview](../../01-features/records/overview.md)
- [OpenAPI](../openapi.yaml)
