---
title: Security architecture
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Security architecture

## Purpose

This page describes the security boundaries of the platform at policy
level: where trust is checked, and which layer owns each check. It
deliberately contains no exploitable detail. Governance and privacy
policy live in [09-security-governance](../09-security-governance/README.md).

## Boundaries

Trust boundaries, outside in:

1. **Origin** — the CORS policy decides which origins may call the API,
   and only portal origins are credentialed. Tenant school sites may call
   the API but are never credentialed, for HTTP or sockets.
2. **Identity** — JWT access tokens authenticate requests; sockets
   authenticate from the handshake cookie. Two-factor authentication and
   forced-logout controls exist at the account level.
3. **Authorisation** — role, ownership and tenant checks run in module
   code on every request. The database is reached with a service key, so
   the API — not the database — is the enforcement layer.
4. **Internal** — worker callbacks and internal routes require a shared
   secret, compared in constant time; internal calls minted for background
   jobs carry a signed internal claim and get their own rate-limit bucket
   rather than an exemption.

## Diagram

```text
client -> origin policy -> rate-limit identity (token signature peek,
          no DB) -> tiered rate limiters -> module auth (JWT verify)
          -> role / ownership / tenant checks in module code
          -> PostgREST query (owner-scoped) -> sanitised response
```

## Request/event flow

- Rate-limit identity is derived by verifying the access token's
  signature only — no database lookup, no deny-list — purely to key the
  limiter per user instead of per IP. A forged token yields no identity
  and keys by IP; nobody can borrow another user's quota.
- Webhook routes validate provider signatures against the raw request
  body; the raw parsers are mounted before the global JSON parser for
  exactly this reason.
- File access is presign-after-check: ownership is verified first, then a
  short-lived signed URL is issued; private content returns not-found to
  non-owners. The platform relies on Referer headers for access control
  nowhere.
- Error responses pass a sanitiser that strips database internals
  (schema, constraint, table, SQL wording) from any 4xx/5xx body.

## Data and storage

Secrets live in environment configuration and the platform vault, never
in code or in the model catalogue (provider keys are referenced by env
name only). Passwords are hashed with bcrypt; auth supports Google OAuth
alongside password login.

## Dependencies

helmet (response hardening), express-rate-limit with env-tunable ceilings
and a uniform JSON 429 envelope, Zod validation factories, jsonwebtoken,
the constant-time compare helper for shared secrets.

## Failure modes

- Known open item, recorded and accepted: the course-video streaming path
  hands the permanent public CDN HLS URL to any authenticated user
  without an enrollment check. It is not exploitable at scale today (the
  CDN host does not resolve and stored video empties per deploy), and it
  is scheduled to be fixed before paid video courses ship.
- A limiter or identity failure must fail closed for writes and visibly
  in logs: every rate-limit hit is logged with its layer, route and key
  type.

## Security and permissions

Permission cards in the agent layer are part of this boundary: an
approval applies exactly the frozen targets of the dry run that produced
the card, and decided cards are never written back into the transcript.
See [Agent architecture](agent-architecture.md).

## Invariants

- Documentation explains permissions; the backend enforces them.
- No access decision may depend on a client-supplied header that the
  client controls (Referer included).
- A declined or expired approval ends the attempt; there is no retry or
  workaround path.

## Observability

Structured security logging in the central middleware, rate-limit hit
logs, a preflight security script in the API's checks, and `/health`
exposing only reachability and build identity.

## Related

- [Backend architecture](backend-architecture.md)
- [API authentication](../02-api/authentication.md)
- [Security and governance](../09-security-governance/README.md)
- [Agent guide](../AGENTS.md)
