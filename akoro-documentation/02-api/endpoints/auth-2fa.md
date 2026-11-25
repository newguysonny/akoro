---
title: Two-factor authentication
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.login
---

# Two-factor authentication

## POST /api/auth/2fa/login

Completes a 2FA-gated login.

| Field | Type | Required |
| --- | --- | --- |
| `challengeToken` | string | yes |
| `code` | string | yes |

`200` issues the auth session. Invalid/expired challenge or code returns `401`.

## POST /api/auth/2fa/setup

Starts setup. Requires a session or a `setupToken` in the body.

Returns:

```json
{
  "success": true,
  "data": { "secret": "...", "otpauthUrl": "otpauth://..." }
}
```

`400` if 2FA is already enabled; `401` if neither a session nor a valid setup
token is supplied.

## POST /api/auth/2fa/enable

Confirms the first TOTP code and enables 2FA.

| Field | Type | Required |
| --- | --- | --- |
| `code` | string | yes |
| `setupToken` | string | no |

If called with a setup token, success also issues the auth session.

## POST /api/auth/2fa/disable

Requires an authenticated session and a current TOTP `code`.

## Rules

- Never log the TOTP secret or code.
- Never retry a TOTP code rapidly; codes rotate.
- Do not disable 2FA without a current code and an authenticated session.

## Related

- [Sign in](auth-login.md)
- [Authentication guide](../authentication.md)
