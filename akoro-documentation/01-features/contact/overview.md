---
title: Contact and partner intake
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Contact and partner intake

The contact module accepts public messages and partner enquiries. The admin
inbox is separate and requires an admin session.

## Public endpoint

`POST /api/contact`

| Field | Type | Required | Limits |
| --- | --- | --- | --- |
| `name` | string | yes | 1–200 |
| `email` | string | yes | valid email |
| `message` | string | yes | 1–5000 |
| `kind` | string | no | `contact` or `partner`; default `contact` |
| `organisation` | string | no | max 200 |
| `subject` | string | no | max 200 |

Success returns `201 { "success": true }`. Validation failure returns `422` with
a user-facing message.

## Admin surface

`GET /api/contact/messages` lists the inbox and is admin-only. It is not part of
the public API reference.

## Capabilities

- `contact.submit`

## Related

- [Pilot applications](../pilot-applications/overview.md)
- [OpenAPI](../../02-api/openapi.yaml)
