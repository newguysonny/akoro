---
title: API authentication
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# API authentication

## Portals

Akoro uses portal-scoped sessions. Send the portal header on every request:

```http
X-Akoro-Portal: student
```

Supported portal values include `student`, `instructor`, `admin`, `school`,
`site`, `agent` and `business`. The default is `student`.

Full-page OAuth and file redirects may use `?portal=` instead of a header.

## Cookies

Successful sign-in sets HttpOnly cookies:

- `akoro_access_<portal>` — short-lived access token.
- `akoro_refresh_<portal>` — rotating refresh token.

The refresh cookie is scoped to `/api/auth/refresh`. Cookies are the preferred
browser transport.

## Bearer tokens

Sign-in and refresh also return `accessToken` and `refreshToken` in the response
body for mobile and server-to-server clients.

```http
Authorization: Bearer <accessToken>
```

Do not store long-lived tokens in browser localStorage when cookies are
available.

## Refresh rotation

`POST /api/auth/refresh` rotates the refresh token and issues a new access token.
Reuse of an old refresh token outside the short grace window revokes the token
family.

## 2FA and OAuth

- `POST /api/auth/2fa/login` completes a 2FA challenge.
- `POST /api/auth/2fa/setup` begins setup with a setup token.
- `GET /api/auth/google` and `GET /api/auth/google/callback` implement Google
  OAuth for supported portals.

## Errors

| Status | Meaning |
| --- | --- |
| 401 | Missing, invalid or expired session |
| 403 | Account deleted or access denied |
| 422 | Validation failure |
| 429 | Rate limited |

## Related

- [Authentication overview](../01-features/auth/overview.md)
- [Errors](errors.md)
- [OpenAPI](openapi.yaml)
