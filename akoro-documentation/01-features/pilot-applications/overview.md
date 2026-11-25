---
title: Pilot applications
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Pilot applications

The public pilot-school application form is the single unauthenticated write
endpoint of the Tiers & Credits plan.

## Public endpoint

`POST /api/public/pilot-applications`

The endpoint validates school and contact details, rejects duplicate
applications for the same school and contact email within 24 hours, and stores
the application for the admin review queue.

Validation failures return `422` with a `fields` map. A recent duplicate returns
`409` with code `duplicate_application`. Success returns `201`.

## Field validation

The canonical validator is `validatePilotApplication` in
`akoro-api/lib/tiersModel.js`. Documentation must derive the field list from that
validator, not from memory. The validator covers school name, state/city,
estimated students and contact details.

## Admin surface

Admin review and approval live in the admin application and are not part of the
public API reference.

## Capabilities

- `pilot.apply`

## Related

- [Contact](../contact/overview.md)
- [OpenAPI](../../02-api/openapi.yaml)
