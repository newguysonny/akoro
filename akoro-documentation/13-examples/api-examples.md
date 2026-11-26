---
title: API examples
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# API examples

Worked request/response pairs for the documented Tier-1 surface. All
examples use the sandbox base (`https://sandbox.akoro.ng/api`) and demo
data only. Shapes follow [OpenAPI](../02-api/openapi.yaml); conventions are
in [Request and response schemas](../02-api/request-response-schemas.md).

## 1. Sign in (success)

```http
POST /api/auth/login
X-Akoro-Portal: student
Content-Type: application/json

{ "email": "tester01@demo.akoro.app", "password": "Password123!" }
```

```json
{
  "success": true,
  "data": {
    "accessToken": "<token>",
    "refreshToken": "<token>",
    "accessExpiresAt": 1795600000000,
    "user": { "id": "…", "email": "tester01@demo.akoro.app", "role": "student" }
  }
}
```

The response also sets the portal cookies. A sign-in can instead return a
verification or 2FA challenge — handle those branches; see the
[sign-in workflow](workflows/auth-sign-in.md).

## 2. Missing parameter (failure)

```http
POST /api/auth/login
X-Akoro-Portal: student

{ "email": "tester01@demo.akoro.app" }
```

```json
{
  "success": false,
  "message": "Please check the highlighted fields.",
  "errors": [ { "field": "password", "message": "Password is required." } ]
}
```

HTTP 422. Fix the named field; do not retry the same body.

## 3. List records, paged (success + empty result)

```http
GET /api/records?paged=true&limit=12
X-Akoro-Portal: student
Authorization: Bearer <accessToken>
```

```json
{
  "success": true,
  "data": { "records": [ { "id": "…", "kind": "upload", "name": "Notes.pdf" } ], "total": 1, "nextCursor": null }
}
```

For a learner with no records, the same call succeeds with an empty page —
an empty result is not an error:

```json
{ "success": true, "data": { "records": [], "total": 0, "nextCursor": null } }
```

Paging rules: [Pagination](../02-api/pagination.md).

## 4. Permission failure (failure)

Asking about a record the caller does not own:

```http
POST /api/records/ask
X-Akoro-Portal: student
Authorization: Bearer <accessToken>

{ "recordId": "<another learner's record id>", "question": "Summarise this" }
```

Result: HTTP 403 (or 404 for a private record whose existence is not
disclosed). Stop. Do not try other ids, and do not treat the 404 variant as
"the record was deleted" — see [Authorization](../02-api/authorization.md).

## 5. Duplicate request (failure mode)

Creating the same upload record twice:

```http
POST /api/records  { "kind": "upload", "name": "Notes.pdf", "mime": "application/pdf", "size": 10240, "fileKey": "<key from upload-url>" }
```

Record creation is **not idempotent**: the second call creates a second
record. Before creating, list the shelf (`GET /api/records`) and reuse the
existing record if the same `fileKey`/name is already registered. The same
applies to any write without a documented idempotency key — after a timeout,
verify the side effect before retrying (see [Errors](../02-api/errors.md)).

## 6. Asynchronous operation: extraction polling

```http
GET /api/records/extract/status?recordId=<id>
```

Poll with backoff until the status is `done`. Asking too early is a
documented conflict, not a failure:

```http
POST /api/records/ask  { "recordId": "<id>", "question": "What is osmosis?" }
→ 409 while extraction is not yet searchable
```

Wait for `done`, then ask. Poll inside the standard rate-limit budget —
see [Rate limits](../02-api/rate-limits.md).

## 7. Rate limited (failure)

```http
POST /api/auth/login   (sixth failed attempt inside 15 minutes)
→ 429
{ "success": false, "code": "rate_limited", "message": "Too many attempts. Please try again in 15 minutes." }
```

Back off for the window; do not rotate identities or portals to escape the
bucket.

## Related

- [Endpoint reference](../02-api/endpoints/README.md)
- [Agent examples](agent-examples.md)
- [Complete workflows](complete-workflows.md)
