---
title: POST /api/auth/login
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.login
---

# POST /api/auth/login

Signs a user in with email and password and issues a portal-scoped session.

## Authentication

None. This is a public, rate-limited endpoint.

## Headers

| Header | Required | Meaning |
| --- | --- | --- |
| `X-Akoro-Portal` | No | Portal to scope the session; default `student` |
| `Content-Type` | Yes | `application/json` |

## Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes | Valid email; normalized |
| `password` | string | yes | Non-empty |

## Success

`200` with the standard auth envelope. The body includes tokens for mobile
clients; cookies are set for browsers.

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "accessExpiresAt": 1760000000000,
    "user": {
      "id": "00000000-0000-0000-0000-000000000000",
      "email": "learner@example.com",
      "username": "learner",
      "fullName": "Example Learner",
      "avatarUrl": null,
      "role": "student",
      "onboardingCompleted": false
    }
  }
}
```

The response may instead require email verification or 2FA. Follow the returned
challenge flow.

## Errors

| Status | Meaning | Recovery |
| --- | --- | --- |
| 401 | Invalid credentials or inactive account | Fix credentials or contact support |
| 403 | Account deleted | Stop |
| 422 | Validation failed | Fix `email`/`password` |
| 429 | Rate limited | Wait and retry |

## Side effects

- Creates a refresh-token record.
- Sets `akoro_access_<portal>` and `akoro_refresh_<portal>` cookies.
- May send a login-alert email.

## Verification

- The response contains `user` and `accessExpiresAt`.
- The portal cookie is present.
- `GET /api/records` succeeds with the same session.

## Related

- [Auth refresh](auth-refresh.md)
- [Authentication guide](../authentication.md)
- [OpenAPI](../openapi.yaml)
