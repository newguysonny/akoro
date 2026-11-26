---
title: Tenant isolation
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Tenant isolation

Akoro serves independent schools alongside individual learners on one
platform. Tenant isolation is the rule that one tenant's data is never
visible to, or modifiable by, another tenant or an unrelated user — and
that within a school, role scopes further limit which parts of the tenant's
data a staff member can reach.

## Tenant model

- A **school** is a tenant. Its management data (students, classes,
  subjects, exams, timetables, and its finance, staff, health and admissions
  records) belongs to the school, not to any individual staff account.
- An **individual learner** is effectively a tenant of one: their library,
  chats, learning records and wallet are scoped to their account.
- **Platform administration** sits above tenants. Admin access is a
  separate role, is never implied by a school or learner role, and is used
  for platform operations — not as a routine way to read tenant content.

## Isolation rules

1. **Scope comes from the session, never from the request.** Handlers
   derive the tenant from the authenticated account's memberships and
   roles. A client-supplied school or owner identifier can narrow a query
   to the caller's own scope; it can never widen it.
2. **Membership is explicit.** A teacher reaches a school's records only
   after being approved into that school. Approval into one school grants
   nothing in any other school.
3. **Role scopes apply inside the tenant.** Within a school, classroom
   roles (teacher) and administrative roles (school admin) hold different
   scopes: classroom records are readable by an approved teacher; finance,
   payroll, staff-loan, health, admissions, bank and live pupil-location
   records are not. The school admin retains the full scope. This
   separation is a tested invariant, not a convention — the verification
   gate's security scenarios assert both the allowed reads and the `403`
   denials on every run (see
   [Security testing](../10-testing-quality/security-testing.md)).
4. **Private resources do not leak existence.** A record outside the
   caller's scope responds as not found, matching the platform-wide rule
   in [Access control](access-control.md).
5. **Shared spaces are opt-in.** Communities, the agent network and
   published content cross tenant boundaries only through their own
   membership and privacy gates; joining a shared space exposes only what
   that space's rules publish, never the member's private tenant data.
6. **Invites are scoped capabilities.** Joining a course or school happens
   through signed, purpose-specific invite flows; an invite grants exactly
   the membership it names and nothing else.

## What isolation does not mean

Isolation is an access property, not a storage property: tenants share the
platform's database and storage infrastructure, with separation enforced by
the query and authorisation layer. Engineers must therefore treat any new
query over tenant-owned tables as an isolation-sensitive change: it needs
an explicit scope predicate and a test or scenario that proves a
cross-tenant read fails.

## Known limitations

- Isolation depends on handler discipline; there is no database-level
  row-security backstop documented yet. New tenant-owned surfaces should
  prefer shared, scope-enforcing data-access helpers over hand-written
  queries.
- Cross-tenant features (network, communities) are the highest-risk
  surface and carry their own privacy-edge scenarios in the verification
  gate.

## Related

- [Access control](access-control.md)
- [Learner data protection](learner-data-protection.md)
- [Data classification](data-classification.md)
- [Security testing](../10-testing-quality/security-testing.md)
