---
title: Authentication overview
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Authentication overview

Akoro uses portal-scoped sessions. A successful sign-in returns a short-lived
access token and a rotating refresh token, and sets HttpOnly cookies for the
selected portal. Mobile clients may use the tokens returned in the body.

## Portals

The portal is selected with the `X-Akoro-Portal` header (or a `?portal=` query
param for full-page redirects). Known portals include `student`, `instructor`,
`admin`, `school`, `site`, `agent` and `business`.

The default portal is `student`. Cookies are named
`akoro_access_<portal>` and `akoro_refresh_<portal>`.

## Public entry points

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account; may require email verification |
| POST | `/api/auth/login` | Sign in with email and password |
| POST | `/api/auth/verify-email` | Complete signup verification |
| POST | `/api/auth/verify-login` | Complete a login challenge |
| POST | `/api/auth/resend-code` | Resend a verification code |
| POST | `/api/auth/refresh` | Rotate the refresh token and issue a new access token |
| POST | `/api/auth/2fa/login` | Complete a 2FA challenge |
| POST | `/api/auth/2fa/setup` | Begin 2FA setup with a setup token |
| POST | `/api/auth/forgot-password` | Start password reset |
| POST | `/api/auth/reset-password` | Finish password reset |
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | Finish Google OAuth |

`POST /api/auth/logout` and `POST /api/auth/change-password` require a valid
session. `POST /api/auth/2fa/enable` and `disable` require the appropriate setup
or session token.

## Session response

A successful login, registration (when verification is not required) or refresh
returns:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "accessExpiresAt": 1760000000000,
    "user": {
      "id": "uuid",
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

Do not use real credentials in documentation. Use the sandbox demo accounts.

## Error behaviour

- `401` — invalid credentials or an invalid/expired session.
- `403` — account deleted or access denied.
- `422` — validation failure with a `fields` array.
- `429` — rate limit exceeded; respect `Retry-After` where provided.

## Capabilities

- `auth.login`
- `auth.refresh`

## Related

- [API authentication](../../02-api/authentication.md)
- [Errors](../../02-api/errors.md)
- [OpenAPI](../../02-api/openapi.yaml)
