---
title: Pagination
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Pagination

Akoro does not yet have one pagination style across every list endpoint.
This page documents the conventions that exist in the verified Tier-1
surface. Always check the endpoint page or [OpenAPI](openapi.yaml) for the
style an individual operation uses — do not assume.

## Style 1: cursor paging (Library records)

`GET /api/records` is the reference implementation.

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `paged` | boolean | `false` | Ask for the paged envelope |
| `limit` | integer | 12 | Page size; minimum 1, maximum 100 |
| `cursor` | string | none | Opaque cursor from the previous page |

Behaviour:

- Without `paged`, the endpoint returns a plain array in `data`, capped at
  200 records. This unpaged form exists for the Library shelf and is not a
  pattern to copy into new endpoints.
- With `paged=true`, `data` is an object:

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

- `total` is the full count for the query, not the page size.
- `nextCursor` is opaque: pass it back unchanged as `cursor` to get the next
  page. A missing/null `nextCursor` means there are no more pages. Never
  parse, construct or increment a cursor.
- Pages are scoped to the caller — a cursor only ever walks the caller's own
  records (see [Authorization](authorization.md)).

## Style 2: limit/offset (public catalogue lists)

Some public content lists (for example the blog post list in
[Content](endpoints/content-public.md)) accept `limit` and `offset` query
parameters alongside their filters. These endpoints return the items for the
requested window; consult the endpoint page for defaults and maximums, which
are per-endpoint and not harmonised yet.

## Rules for clients and agents

- Prefer the paged form for anything user-visible or large; the unpaged
  records form silently truncates at 200.
- Treat `limit` above the documented maximum as clamped or rejected per the
  endpoint — request within the documented range (1–100 for records).
- Do not page by guessing ids or by incrementing `offset` past a short page:
  a page shorter than `limit` (offset style) or a null `nextCursor` (cursor
  style) is the end of the list.
- An empty first page is a valid result, not an error: return "no results"
  to the user rather than retrying with looser parameters.
- Ordering is endpoint-defined and not guaranteed stable across calls unless
  the endpoint page says so; do not build logic that depends on an item's
  position.

## Not yet standardised

- No platform-wide default page size outside the records convention above.
- No `Link`-header paging; cursors travel in the response body.
- Offset-style and cursor-style endpoints coexist; a future Phase-2
  standardisation is expected to converge on cursor paging. Until then this
  page is descriptive, not prescriptive.

## Related

- [List records](endpoints/records-list.md)
- [Request and response schemas](request-response-schemas.md)
- [OpenAPI](openapi.yaml)
