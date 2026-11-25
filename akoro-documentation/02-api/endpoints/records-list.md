---
title: GET /api/records
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: records.list
---

# GET /api/records

Lists the authenticated learner's own Library records.

## Authentication

Requires a learner session. The caller only sees records they own.

## Query parameters

| Name | Type | Default | Meaning |
| --- | --- | --- | --- |
| `paged` | boolean | false | Return a paged envelope |
| `limit` | integer | 12 | Page size, max 100 |
| `cursor` | string | none | Cursor from the previous page |

Without `paged`, the endpoint returns up to 200 records as a plain array.

## Response

Unpaged:

```json
{ "success": true, "data": [ { "id": "...", "kind": "upload", "name": "Notes.pdf" } ] }
```

Paged:

```json
{
  "success": true,
  "data": {
    "records": [ { "id": "...", "kind": "upload", "name": "Notes.pdf" } ],
    "total": 42,
    "nextCursor": "..."
  }
}
```

Each record may include `mime`, `size`, `duration`, `progress`, `fileType`,
`hasPreview`, `fileMissing`, `url`, `fileUrl`, link metadata, and `sources`.
Upload records receive a fresh presigned file URL.

## Errors

| Status | Meaning |
| --- | --- |
| 401 | No valid session |

## Ownership

The query is scoped to `req.user.id`. Do not attempt to list another learner's
records by passing a user id; there is no such parameter.

## Verification

- The response contains only the caller's records.
- A paged request returns `total` and `nextCursor`.
- `GET /api/records/:id/file` works only for an owned record.

## Related

- [Presign an upload](records-upload-url.md)
- [Create a record](records-create.md)
- [Library overview](../../01-features/records/overview.md)
