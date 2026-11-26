---
title: Audit logging
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Audit logging

Audit logging answers one question after the fact: *who did what, to what,
when — and was it allowed?* This document separates what Akoro records
today from the unified audit trail that remains policy intent. The two
must not be confused: the records below exist and are used; a single,
queryable, platform-wide audit log does not yet exist.

## What is recorded today

- **Verification evidence.** Every verification-gate run records its
  target, scenario verdicts and assertion evidence, so a claim that a
  boundary held can be traced to the run that proved it (see
  [Regression testing](../10-testing-quality/regression-testing.md)).
- **Self-tooling events.** The learner tooling subsystem records lifecycle
  events for learner-built tools — offers made and accepted, builds,
  approvals and changes — in its own event store, so a tool's history can
  be reconstructed and a disputed action attributed.
- **Usage and spend records.** AI usage and spend are recorded per account
  for cost management and abuse investigation, and surfaced to admins in
  aggregate.
- **Administrative actions in owning modules.** Areas such as view
  registration and approval, tool-request review and verification
  real-user approvals keep the acting admin's decision with the artefact
  they acted on.
- **Authentication events.** Sign-in, refresh rotation, revocation and
  2FA events are handled by the auth module; token-family revocation on
  refresh reuse depends on this record.

## Policy for new audit-relevant actions

Any new action that is privileged, irreversible, crosses a tenant
boundary, moves money, or changes another actor's permissions must record,
in its owning module:

- the acting account and role (from the verified session, never from
  request input);
- the action and the target artefact;
- the outcome, including denials — a refused privileged attempt is
  audit-relevant, not noise;
- the confirmation or approval that authorised it, where
  [Human approval policy](human-approval-policy.md) applies;
- a timestamp from the server clock.

Audit records are append-only from the product's point of view: features
may not edit or delete another module's records, and records about a
learner are themselves Private data under
[Data classification](data-classification.md).

## What is not logged

- Secrets, tokens, passwords and full request bodies are never written to
  logs or audit records.
- Learner content (chat text, document text) is not copied into
  operational logs; investigations work from the artefact itself, under
  the access rules in [Learner data protection](learner-data-protection.md).

## Known gaps (policy intent, not yet mechanism)

- There is no unified, cross-module audit query; reconstructing an
  incident means consulting each owning module's records.
- Retention periods for audit and operational records are unset — see
  [Data retention](data-retention.md).
- Alerting on audit signals (repeated denials, unusual admin activity) is
  an owner decision, not a current mechanism.

## Related

- [Security policy](security-policy.md)
- [Access control](access-control.md)
- [Human approval policy](human-approval-policy.md)
- [Data retention](data-retention.md)
