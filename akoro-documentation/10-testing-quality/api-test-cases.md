---
title: API test cases
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# API test cases

API testing in Akoro happens at three levels: contract tests that pin the
shape and rules of a module without a server, documentation/OpenAPI
validation that keeps the published contract honest, and live scenario and
smoke runs against the sandbox. This document describes each level and the
cases that matter most. Endpoint contracts themselves live in
[API authentication](../02-api/authentication.md),
[API errors](../02-api/errors.md) and the OpenAPI specification; this
document never restates them.

## Level 1 — Contract and behaviour tests (no server)

Co-located `*.contract.test.mjs` and `*.behavior.test.mjs` suites run with
`node --test` and pin, among others:

- **Auth** — admin 2FA, auth caching, email-code flows, portal-header
  handling, session-token seams, input validation, and the rule that no
  fallback secrets are accepted when configuration is missing.
- **Self-tooling** — build-consent flow, permission flow, decision flow,
  answer-only computed reads, domain actions and merged-domain behaviour,
  view-spec validation.
- **Structure** — module structure baselines and ESM link integrity, so a
  refactor cannot silently break the module graph.
- **Admin** — pilot login, migrations-at-boot, usage and content rules.

A contract test that only pattern-matches source text is treated as weak
evidence; where behaviour matters, the case drives the real function or
flow.

## Level 2 — Contract/documentation validation

`validate-docs.mjs` checks that the OpenAPI document parses, its references
resolve, registry capabilities point at real operations, and local
documentation links resolve. This catches the class of defect where the
documented API and the described API drift apart. It is explicitly not a
runtime contract test: it proves the documents agree with each other, not
that the server honours them.

## Level 3 — Live API cases (sandbox)

- **Verification-gate scenarios** exercise real routes over HTTP with
  demo accounts: success paths, validation failures (`422` with field
  errors), unauthenticated (`401`) and forbidden (`403`) access, not-found
  semantics for private resources (`404`), and rate-limit behaviour
  (`429`). The smoke suite includes the session-hygiene case that session
  endpoints issue tokens only in their documented form.
- **Sandbox smoke scripts** (see [Scripts README](../scripts/README.md))
  cover the write paths scenarios cannot: record create → ask → delete →
  cleanup; course create → video upload/encode → status → delete; the
  full auth lifecycle with a disposable user (TOTP setup/enable/login/
  disable, registration probe, reset validation, user deletion); and
  content validation with admin read-back. They require an explicit
  `--confirm` flag and refuse any host except the sandbox.

## Error-shape cases

Because the API does not yet have one universal error envelope (see
[API errors](../02-api/errors.md)), API cases assert the documented shape
per surface: the `success`/`message` envelope, the validation `fields`
form, or the legacy `error` form — and assert that internal stack traces
never reach a response body.

## Adding an API case

1. New route → contract or behaviour test in the owning module first.
2. Route with a permission boundary → a live denial case in the gate's
   security scenarios (see [Security testing](security-testing.md)).
3. New public operation → OpenAPI entry plus documentation validation.
4. Write path with cleanup risk → extend a smoke script, keeping the
   sandbox-only guard.

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Feature test cases](feature-test-cases.md)
- [API authentication](../02-api/authentication.md)
- [API errors](../02-api/errors.md)
- [Scripts README](../scripts/README.md)
