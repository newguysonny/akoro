---
title: API errors
status: beta
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# API errors

Akoro does not yet have one universal error envelope across every module.
Phase 2 normalises the public surface. Until then, use these observed shapes.

## Auth and common service errors

```json
{
  "success": false,
  "message": "Human-readable message",
  "code": "optional_machine_code"
}
```

Validation failures may include a `fields` array:

```json
{
  "success": false,
  "message": "Please check the highlighted fields.",
  "errors": [
    { "field": "email", "message": "Enter a valid email address." }
  ]
}
```

Some catalogue and legacy handlers return:

```json
{ "error": "Human-readable message" }
```

## Status mapping

| Status | Meaning | Retry |
| --- | --- | --- |
| 400 | Invalid request | No, fix the request |
| 401 | Missing/invalid session | Refresh or sign in |
| 403 | Authenticated but not allowed | No |
| 404 | Resource not found or not visible | No |
| 409 | Conflict or busy lane | Retry only when documented |
| 413 | Payload too large | No |
| 422 | Validation failed | No, fix fields |
| 429 | Rate limited | Yes, after `Retry-After` |
| 500 | Unexpected server error | Maybe, with backoff |
| 502/503 | Dependency unavailable | Yes, with backoff |
| 504 | Timeout | Check whether the side effect occurred |

## Rules

- Read the actual error body; do not infer from status alone.
- Retry only idempotent operations or those with an idempotency key.
- Do not retry a permanent validation/permission error.
- After a timeout or 5xx, verify the side effect before retrying a write.
- Never expose internal stack traces to end users.

## Standardisation work

Phase 2 should define:

- a single error envelope;
- stable error codes per public endpoint;
- a public error catalogue;
- retryability metadata;
- validation field paths;
- documentation examples for every Tier-1 error.

## Related

- [API authentication](authentication.md)
- [OpenAPI](openapi.yaml)
