---
title: Data classification
status: planned
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Data classification

This document defines the classification scheme Akoro applies to platform
data and the handling rules each class carries. The scheme is policy: parts
of it are already reflected in code (ownership checks, private-by-default
storage, role gates), but a formal per-field classification register does
not yet exist. Engineers classify new data using this scheme at design time;
when a field does not fit, they escalate to the policy owners rather than
guessing.

## Classes

| Class | Definition | Examples |
| --- | --- | --- |
| Public | Approved for anyone to read | Published courses and programmes, blog and careers content, public catalogue data |
| Internal | Platform operational data with no personal content | Feature configuration, content metadata, aggregate analytics, documentation |
| Private (personal) | Belongs to one identified user; visible to that user and to roles with a documented relationship to them | Learner uploads and library, chat history, goals, tasks, assessment attempts, mastery evidence, wallet balance |
| Restricted | Data whose exposure would cause serious harm; access is role-scoped, minimal and reviewed | Credentials and session material, payment instruments and payout details, school finance and payroll records, pupil health records, safeguarding-relevant records |

## Handling rules

- **Public** — may appear in the public API contract and public docs. Still
  no personal data: a published artefact must not embed a private name,
  email or learner record.
- **Internal** — authenticated platform surfaces only. May be used in
  aggregate reporting; aggregates must not be sliceable down to one
  identifiable learner.
- **Private (personal)** — every read and write passes an ownership or
  relationship check in the backend. Downloads of stored files are issued
  only after that check passes. Private resources return "not found" rather
  than "forbidden" to actors with no relationship, so existence is not
  leaked. Cross-tenant reads are governed by
  [Tenant isolation](tenant-isolation.md).
- **Restricted** — never returned by general-purpose endpoints; each access
  path is individually role-gated (see [Access control](access-control.md)).
  Restricted values are never written to documentation, examples, logs or
  agent prompts. School finance, payroll and health records sit behind
  school-role scopes that even other school staff roles do not automatically
  inherit — this separation is exercised by the verification gate's security
  scenarios.

## Classification at the boundaries

- **Uploads** start as Private, owned by the uploader. Publishing is an
  explicit owner action that reclassifies the artefact as Public.
- **AI processing** does not change classification. Private content sent to
  a model for a learner's own task remains Private; generated outputs
  inherit the classification of their inputs unless a human publishes them.
- **Exports and reports** inherit the most restrictive class of their
  inputs.
- **Test and sandbox data** is synthetic and unclassified, but must never
  be produced by copying production records.

## Review

New modules declare the classes they store in their feature documentation.
The policy owners review the scheme when a new integration (payments,
storage, AI provider, email) starts carrying a new class of data.

## Related

- [Privacy policy](privacy-policy.md)
- [Learner data protection](learner-data-protection.md)
- [Access control](access-control.md)
- [Data retention](data-retention.md)
