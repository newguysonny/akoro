---
title: Public PharmD catalogue
status: beta
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: pharmd.get_programme
---

# Public PharmD catalogue

## GET /api/pharmd/programme

Returns the PharmD programme tree:

```json
{
  "success": true,
  "data": {
    "programme": { "code": "PHARMD", "name": "Doctor of Pharmacy", "subtitle": null },
    "years": [ { "number": 1, "label": "Year 1", "courses": [ { "id": "...", "code": "BIO 111", "title": "...", "topics": 12 } ] } ]
  }
}
```

## GET /api/pharmd/courses/{code}

Returns one course and its ordered topics. Topic fields include `id`, `position`,
`title`, `read_minutes`, `file_name`, `file_size` and file/reader hints.

## GET /api/pharmd/topics/{id}/file

Returns or redirects to the topic PDF. This is a public catalogue asset; it is
not a learner Library record.

## Status

The catalogue is implemented. Some learner-facing course/year content still
shows "coming soon" when the seed is incomplete. Treat missing content as
unavailable, not as an error to work around.

## Authenticated companion endpoints

- `POST /api/pharmd/ask`
- `GET /api/pharmd/progress`
- `POST /api/pharmd/topics/{id}/complete`

These require a learner session and are documented with the reader/learning
guides.

## Related

- [PharmD overview](../../01-features/pharmd/overview.md)
- [Programmes catalogue](programmes-public.md)
- [OpenAPI](../openapi.yaml)
