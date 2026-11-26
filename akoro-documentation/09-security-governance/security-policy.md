---
title: Security policy
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Security policy

This document states Akoro's platform security policy: the boundaries every
module must respect, who is responsible for what, and how security work is
reported and verified. It describes policy and invariants, not implementation
detail that would help an attacker. Where a control is enforced in code, the
owning document is linked; where a control is team intent, it is labelled
policy.

## Principles

1. **The backend enforces; documentation explains.** No document, registry
   entry or client check grants access. Authentication, authorisation,
   ownership, tenant isolation and confirmation are enforced server-side on
   every request.
2. **Least privilege by default.** Each actor — learner, instructor, school
   staff, administrator, agent — receives only the access its role requires.
   Anything not explicitly granted is denied.
3. **Fail closed.** Guards that cannot verify a credential, a shared secret or
   a permission deny the request rather than falling back to a weaker check.
   This behaviour is exercised by the verification gate (see
   [Security testing](../10-testing-quality/security-testing.md)).
4. **Private by default.** Learner-owned content is private unless the owner
   explicitly publishes or shares it. Private resources are not discoverable
   by other accounts.
5. **No secrets in code, docs or examples.** Credentials, tokens and real
   learner data never appear in source, documentation, tests or reports.
   Examples use sandbox demo accounts only.
6. **Verify, don't assume.** A change that touches a security boundary is not
   done until the relevant automated checks pass against the sandbox.

## Boundaries

| Boundary | Policy |
| --- | --- |
| Identity | Portal-scoped sessions; see [Access control](access-control.md) and [API authentication](../02-api/authentication.md) |
| Authorisation | Role gates plus per-resource ownership checks before data is read, written or signed for download |
| Tenancy | School and learner scopes are isolated; see [Tenant isolation](tenant-isolation.md) |
| Data | Classification and handling rules in [Data classification](data-classification.md) |
| Agents | Agent actions are bounded by capability access and confirmation rules; see [AI governance](ai-governance.md) and [Human approval policy](human-approval-policy.md) |
| Privileged operations | Admin surfaces are role-gated and are never part of the public API contract |

## Responsibilities

- **Engineers** implement controls in the owning module, add or update the
  automated checks that prove them, and update these documents when behaviour
  changes.
- **Reviewers** reject changes that widen access without a documented reason,
  that move an enforcement check into a client, or that log sensitive data.
- **Agents** (human or AI) follow the stop conditions in
  [Agent capabilities](../06-agents/agent-capabilities.md): a capability
  outside the actor's access list is reported, never improvised around.

## Reporting and disclosure

Security issues are reported privately to the platform owners and handled
under coordinated disclosure: acknowledge, reproduce on the sandbox, fix,
verify, then describe the issue at the level of the boundary that failed —
never with working exploit detail. Public documentation must never expose
secrets, real learner data or exploitable internal details.

## Review

This policy is reviewed when a new portal, role, integration or agent
capability is introduced, and whenever a verification-gate security scenario
changes. The concrete test evidence lives in
[Security testing](../10-testing-quality/security-testing.md); the release
gate that consumes it is in
[Release acceptance criteria](../10-testing-quality/release-acceptance-criteria.md).

## Related

- [Access control](access-control.md)
- [Data classification](data-classification.md)
- [AI governance](ai-governance.md)
- [API authentication](../02-api/authentication.md)
- [API errors](../02-api/errors.md)
