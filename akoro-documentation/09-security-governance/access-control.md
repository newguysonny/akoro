---
title: Access control
status: implemented
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Access control

How Akoro decides who may do what. Access control has three layers, all
enforced by the backend on every request: identity (a valid portal session),
role (what this kind of actor may do), and ownership or relationship (what
this actor may do to this specific resource). A request must pass every
layer that applies. The session mechanics are specified in
[API authentication](../02-api/authentication.md); this document covers the
authorisation model built on top of them.

## Identity: portal-scoped sessions

Akoro uses portal-scoped sessions (`student`, `instructor`, `admin`,
`school`, `site`, `agent`, `business`). Sign-in issues a short-lived access
token and a rotating refresh token, delivered as HttpOnly cookies for
browser clients and in the response body for mobile and server-to-server
clients. Refresh-token reuse outside a short grace window revokes the token
family. Accounts may add two-factor authentication; administrative 2FA is
covered by contract tests in the auth module. Revoked tokens are denied via
a server-side deny-list, so logout and revocation take effect without
waiting for token expiry. Unauthenticated requests to protected routes
return `401`; authenticated requests that fail authorisation return `403`,
and private resources owned by someone else return `404` so their existence
is not disclosed (see [API errors](../02-api/errors.md)).

## Role gates

Route groups declare the roles they accept, and a shared role-gate
middleware rejects any session whose role is outside that set before the
handler runs. Examples of the model in operation:

- Platform administration surfaces require the admin role; learner and
  instructor sessions cannot reach them.
- Self-tooling's data-view administration endpoints (list, create, approve,
  disable registered views) require the admin role.
- School-management routes distinguish school roles: an approved teacher
  reads classroom records for their school, while finance, payroll, staff,
  health and admissions records require the school-admin scope. This
  separation is tested continuously (see
  [Security testing](../10-testing-quality/security-testing.md)).

## Ownership and relationship checks

Role alone never grants access to a specific record. Handlers that read,
write or issue downloads for user-owned resources first verify that the
resource belongs to the caller, or that a documented relationship (instructor
of the learner, school role over the tenancy, community membership) covers
it. File downloads are a two-step consequence of this rule: storage is
private, and a short-lived download URL is issued only after the ownership
check passes. Non-owners cannot obtain a URL, and private records are
invisible to them in lists and search.

## Agents

An agent acts with the permissions of the user it serves, never more. The
capability registry's `access` list is the ceiling for what an agent may
attempt, tools may be narrower, and capabilities marked
`requires_confirmation` cannot execute until the user confirms — see
[Agent capabilities](../06-agents/agent-capabilities.md) and
[Human approval policy](human-approval-policy.md). Documentation grants
nothing: reading a capability document is not authorisation.

## Invariants

- No handler trusts a client-supplied owner, role or tenant identifier;
  scope is derived from the verified session.
- Shared-secret guards on internal routes fail closed when the secret is
  absent or wrong.
- Rate limits apply to authentication and other sensitive surfaces;
  `429` responses carry retry guidance.
- New routes are denied by default until their role and ownership rules are
  declared and tested.

## Related

- [API authentication](../02-api/authentication.md)
- [Tenant isolation](tenant-isolation.md)
- [Security policy](security-policy.md)
- [Human approval policy](human-approval-policy.md)
