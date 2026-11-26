---
title: API authorization
status: implemented
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# API authorization

Authentication proves who the caller is; authorization decides what that
caller may do. Akoro enforces authorization in the backend on every request.
Documentation describes the rules — it never grants access.

## Layers

Authorization is the combination of four checks:

| Layer | Question | Failure |
| --- | --- | --- |
| Portal | Is this session valid for the portal named by `X-Akoro-Portal`? | 401 / 403 |
| Role | Does the account's role allow this operation in this portal? | 403 |
| Ownership | Does the caller own (or have a grant on) the target resource? | 403, or 404 when existence must not leak |
| Scope/grant | For shared content, is there an explicit grant (enrolment, catalogue publication, school membership)? | 403 / 404 |

See [Authentication](authentication.md) for how sessions and portals work.

## Portals and roles

Sessions are portal-scoped (`student`, `instructor`, `admin`, `school`,
`site`, `agent`, `business`). A token minted for one portal is not a token
for another: a learner access token sent to an instructor or admin route is
rejected, even though the underlying account exists. Server-side handlers
additionally check the account role for privileged operations — for example,
the self-tooling view-registry endpoints (`GET/POST /api/self-tooling/views`,
approve/disable) require an admin role, and school ERP and admin routes are
not part of the public API at all (see the coverage rule in the
[API README](README.md)).

## Ownership (BOLA protection)

Most learner-facing resources are owner-scoped in the query itself, not
filtered afterwards:

- `GET /api/records` is scoped to `req.user.id`; there is no parameter to
  list another learner's records.
- Record file, extraction and ask endpoints resolve the record and check
  ownership before presigning or reading content. A non-owner receives 403;
  private records that are not shared return 404 to non-owners so existence
  is not disclosed.

Handlers that address a resource by id use a shared ownership guard
(`requireOwnership` in the API security middleware): it resolves the
resource's owner, returns 404 when the resource does not exist, 403 when the
owner differs from the caller, and logs the attempt as a possible
broken-object-level-authorization (BOLA) probe.

## Shared and public content

- Published catalogue content (courses, programmes, blog, careers) is
  readable without a session; unpublished content is not.
- Shared/catalogue learning content is addressed by `contentKey` rather than
  a record id, and access follows the catalogue grant, not ownership.
- Course media is delivered through authenticated, ownership/enrolment
  checked routes before any playback URL is issued.

## Internal and machine callers

- Internal callbacks and scheduler ticks use the `x-internal-secret` header,
  not user sessions. When the secret is not configured, those routes answer
  503 — closed, never open.
- The agent-tools gateway requires a service credential plus a short-lived,
  session-bound capability token; both are validated per call.
- Provider webhooks use provider signatures, not sessions — see
  [Webhooks](webhooks.md).

## Rules for clients and agents

- Never infer permission from a successful read in another portal.
- Treat 403 as final for that identity; do not retry with the same token.
- Treat 404 on a private resource as "not visible to you", not "does not
  exist".
- Never attempt to enumerate other users' ids to reach their resources.
- If a needed operation is not permitted, report the gap; do not look for an
  internal route as a workaround.

## Related

- [Authentication](authentication.md)
- [Errors](errors.md)
- [Webhooks](webhooks.md)
- [Endpoint reference](endpoints/README.md)
