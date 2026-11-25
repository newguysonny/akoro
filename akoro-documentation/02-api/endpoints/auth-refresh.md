---
title: POST /api/auth/refresh
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.refresh
---

# POST /api/auth/refresh

Rotates the refresh token and issues a new access token.

## Authentication

Requires the portal refresh cookie, or `refreshToken` in the body for clients
that use bearer tokens.

## Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `refreshToken` | string | No | Mobile fallback when no refresh cookie exists |

## Response

`200` with the same token/user envelope as sign-in.

## Rotation and replay

- The old refresh token is consumed.
- A short grace window allows the app's own concurrent refresh races.
- Reuse outside the grace window revokes the token family and signs the user
  out.

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing, expired, revoked or wrong-type refresh token |

## Verification

- The new access token works on an authenticated endpoint.
- The refresh cookie is replaced.
- The old refresh token does not work outside the grace window.

## Related

- [Sign in](auth-login.md)
- [Authentication guide](../authentication.md)
