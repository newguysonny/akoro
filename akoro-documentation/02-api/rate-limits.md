---
title: Rate limits
status: implemented
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Rate limits

Rate limiting is implemented centrally in the API's security middleware
(`express-rate-limit`) as a set of named tiers. The numbers below are the
defaults in code; every tier's ceiling is tunable at deploy time through a
`RATE_LIMIT_<TIER>` environment variable, so a live deployment may differ.
There is no separate per-endpoint quota table beyond these tiers.

## Tiers

| Tier | Default ceiling | Window | Applied to | Key |
| --- | --- | --- | --- | --- |
| Strict | 5 requests | 15 min | Sign-in / registration | IP |
| Refresh | 30 requests | 15 min | `POST /api/auth/refresh` | Session (hashed refresh cookie), IP when no cookie |
| Standard | 100 requests | 1 min | Standard read endpoints under `/api` | Authenticated user id, else IP |
| Teaching | 50 requests | 1 min | Adaptive / teaching endpoints | Authenticated user id, else IP |
| AI | 10 requests | 1 min | Resource-intensive AI operations | Authenticated user id, else IP |
| Internal | 300 requests | 1 min | Background/internal calls, one shared bucket | Single pooled key |

Notes on the design, from the middleware:

- **Strict counts failures only.** Successful sign-ins do not consume the
  strict budget (`skipSuccessfulRequests`), so a learner signing in
  repeatedly is not locked out by their own successes; credential spraying
  is.
- **Refresh is keyed per session, not per IP**, specifically so a school
  class behind one NAT address does not exhaust a shared bucket by
  refreshing on schedule. The cookie value is hashed before use as a key.
- **Per-user keying uses the verified access-token identity**, established
  before the limiters run; an unsigned or forged token falls back to IP
  keying, so nobody can borrow another user's quota.
- **Internal calls are counted, not exempted**: they skip the user tiers but
  are pooled under the internal ceiling, so a runaway background loop is
  stopped instead of taking the API down.
- Each request is counted once per limiter even when several routers are
  mounted under `/api`.

## The 429 response

Every limiter returns the same JSON envelope (never the library's default
plain text):

```json
{ "success": false, "code": "rate_limited", "message": "Too many requests. Please slow down and try again shortly." }
```

Some tiers use a tier-specific message (for example "Teaching endpoint rate
limit exceeded."), but `success: false` and — on the shared handler —
`code: "rate_limited"` are constant. Responses carry the standard
`X-RateLimit-*` headers (`standardHeaders`); the OpenAPI `RateLimited`
response also declares a `Retry-After` header.

## Client behaviour

- On 429, stop and back off; honour `Retry-After` when present. Do not
  retry in a tight loop — the window is fixed, not sliding per retry.
- Poll-style endpoints (extraction status, job status) must poll with
  backoff inside the standard tier's budget; aggressive polling is the
  historical cause of self-inflicted 429s on records.
- A 429 on refresh is **not** proof the session is gone. Clients must not
  treat a refresh 429 as a sign-out signal; wait and retry the refresh.
- Agents: a 429 is a signal to slow down or defer the job to a cheaper
  moment, never to switch identity, portal or key to get a fresh bucket.

## What is not specified

- No published per-partner or per-plan quotas exist; the tiers above are
  the whole policy today.
- Sandbox and production run the same code; their effective ceilings can
  differ only through the environment overrides.

## Related

- [Errors](errors.md)
- [Authentication](authentication.md)
- [Authorization](authorization.md)
