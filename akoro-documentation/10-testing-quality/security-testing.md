---
title: Security testing
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Security testing

Security correctness — *did the system enforce the required permissions?* —
is tested as behaviour, on the live system, not inferred from code review.
This document describes the security test assets that exist and the rules
for adding to them. It names boundaries and expected verdicts only; it
contains no exploit detail, per
[Security policy](../09-security-governance/security-policy.md).

## The security scenario set

The verification gate's `security.js` scenario file runs against the
sandbox with demo accounts and asserts, among others:

| Scenario | Boundary asserted |
| --- | --- |
| `security.teacher_school_reads` | An approved teacher reads their school's classroom records and receives `403` on finance, payroll, staff, health, admissions, dashboard and pupil-location records; the school admin still reads them |
| `security.ownership_reads` | Learner-owned records are readable by their owner and not by unrelated accounts |
| `security.payments_single_mount` | Payment surfaces are mounted exactly once, under their guarded path |
| `security.course_invite_join` | Course invites grant exactly the membership they name |
| `security.shared_secrets_fail_closed` | Internal shared-secret guards deny when the secret is absent or wrong |
| `security.no_fallback_secrets` | Missing secret configuration never falls back to a default or derived value |

Related cases live with their features: `network.privacy_edges` (agent
network discovery/contact privacy), `battles.entry_gates` (battle
participation gates), `school.struggles_scope` (school-scoped records stay
in scope), and the self-tooling containment case
(`selftool.sandbox_contained`).

## Contract-level security tests

Co-located suites pin security rules without a server:

- **Auth module** — admin 2FA enforcement, email-code handling, portal
  header rules, session-token seams, and a dedicated no-fallback-secrets
  contract test.
- **Self-tooling module** — build-consent, permission-flow and
  decision-flow contracts: an unapproved build stays inactive, an
  unconfirmed write does not execute, and an approved change applies only
  to its approved targets.
- **View-spec gate tests** — registered data views are validated against
  the live schema and refused when they reach for sensitive columns or an
  unapproved area.

## Smoke-level security checks

The sandbox auth smoke script exercises the full credential lifecycle with
a disposable user — TOTP setup, enable, login, disable, registration and
reset probes — and deletes the user afterwards. Smoke scripts refuse to
run against any host except the sandbox (see
[Scripts README](../scripts/README.md)).

## Rules for security tests

1. **Every new boundary ships a denial case.** If a change adds a route,
   role or scope, it adds the test that proves the forbidden access
   fails — allowed-path tests alone do not cover a boundary.
2. **Test with real role pairs.** Denial cases use two real demo accounts
   of different roles/tenancies, not a mocked context; scope bugs live in
   the seams mocks hide.
3. **Denials assert the documented response.** `401` unauthenticated,
   `403` authenticated-but-forbidden, `404` for private resources outside
   the caller's scope (see [API errors](../02-api/errors.md)).
4. **No production probing.** Security verification runs on the sandbox.
   Production is read-only for the gate, and its policy requires explicit
   opt-in plus admin approval for anything more.
5. **Findings are reported at boundary level.** A failing case is reported
   as the boundary and expected verdict, fixed, and re-run; working
   exploit detail is never written into docs, tickets or chat.

## Gaps

- There is no scheduled penetration test or external security review on
  record yet; the scenario set is the current assurance mechanism, and
  its limits are stated in
  [Release acceptance criteria](release-acceptance-criteria.md).
- Client-side (browser) security behaviour is covered only where a
  scenario drives it; the gate is API-first.

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Access control](../09-security-governance/access-control.md)
- [Tenant isolation](../09-security-governance/tenant-isolation.md)
- [API authentication](../02-api/authentication.md)
