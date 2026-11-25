---
title: Contact and pilot intake
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: contact.submit
---

# Contact and pilot intake

## POST /api/contact

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | 1–200 |
| `email` | string | yes | Valid email |
| `message` | string | yes | 1–5000 |
| `kind` | string | no | `contact` or `partner` |
| `organisation` | string | no | Max 200 |
| `subject` | string | no | Max 200 |

`201` on success; `422` with a field message on validation failure.

## POST /api/public/pilot-applications

Public pilot-school application. The canonical validator is
`validatePilotApplication` in `akoro-api/lib/tiersModel.js`; the field list and
limits must be taken from there.

`201` on success. Duplicate school/email within 24 hours returns `409` with
`code: duplicate_application`. Validation failure returns `422` with `fields`.

## Rules

- These are write endpoints; use test data that can be removed.
- Do not submit real personal data in examples.
- Do not retry a duplicate pilot application; treat `409` as already received.
- Contact messages are visible to the admin inbox only.

## Related

- [Contact overview](../../01-features/contact/overview.md)
- [Pilot applications](../../01-features/pilot-applications/overview.md)
- [OpenAPI](../openapi.yaml)
