---
title: Complete workflows
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Complete workflows

Index of the end-to-end workflow documents in [workflows/](workflows/).
Each workflow lists prerequisites, steps, decision rules, side effects,
failure handling, verification and prohibited actions. This page summarises
what each one proves; the workflow file itself is the specification.

## The five workflows

### 1. [Sign in and maintain a session](workflows/auth-sign-in.md) — Tier 1, implemented

Authenticate in the correct portal, handle the verification and 2FA
branches, refresh before expiry, and sign out safely. Proves: portal-scoped
cookies, token rotation, and the rule that a learner token is never sent to
another portal. Start here — every other workflow assumes this session.

### 2. [Upload a library record and ask about it](workflows/records-upload-and-ask.md) — Tier 1, implemented

Presign an upload, PUT the bytes to storage, register the record, poll
extraction to `done`, then ask a grounded question and verify its
citations. Covers the paste and link variants, the 409 "not searchable
yet" wait state, and the rule that an answer without citations is not
presented as sourced.

### 3. [Plan and complete a Study Prep session](workflows/study-prep.md) — Tier 2, beta

The learning loop: plan a session from the learner's materials and goals,
work through it, and produce mastery evidence. Beta — the methodology is
implemented but still being refined; verify current behaviour against the
feature docs before relying on details.

### 4. [Publish a course video](workflows/course-video-publish.md) — Tier 1 surface, beta

Instructor-side publishing: create the course video, upload and encode it,
poll processing status, and confirm playback. Includes the cleanup path
(delete video/course) used by the sandbox smoke scripts.

### 5. [Discover and execute an agent capability](workflows/agent-capability.md) — Tier 3, internal

The agent's own operating loop: find a capability in the registry, check
status and permissions, invoke read tools directly, route writes through
confirmation, and verify side effects. Internal only — never present this
as public API. Worked traces of this loop are in
[Agent examples](agent-examples.md).

## How the pieces fit

| Need | Start with |
| --- | --- |
| A single call, with its failure shapes | [API examples](api-examples.md) |
| An agent decision trace | [Agent examples](agent-examples.md) |
| A multi-step task with verification | The workflow above that matches |
| The contract behind any step | [OpenAPI](../02-api/openapi.yaml) and the [endpoint reference](../02-api/endpoints/README.md) |

## Rules

- Demo accounts and sandbox data only; never production credentials.
- A workflow is complete only when its side effects are verified, not when
  its last call returns 200.
- If a step's capability is `planned` or `disabled` in the registry, stop
  and report the gap instead of improvising.

## Related

- [Examples index](README.md)
- [Workflows index](workflows/README.md)
