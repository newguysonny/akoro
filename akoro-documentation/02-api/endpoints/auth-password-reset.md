---
title: Password reset
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.login
---

# Password reset

## POST /api/auth/forgot-password

| Field | Type | Required |
| --- | --- | --- |
| `email` | string | yes |

Always returns `200` with a generic message so the endpoint does not reveal
whether an account exists. When email codes are enabled, a reset code is sent.
`503` is returned only if the email provider genuinely fails to send.

## POST /api/auth/reset-password

Two forms:

### Emailed code

| Field | Type | Required |
| --- | --- | --- |
| `email` | string | yes |
| `code` | string | yes, 6 digits |
| `password` | string | yes, min 8 |

### Reset link

| Field | Type | Required |
| --- | --- | --- |
| `token` | string | yes |
| `password` | string | yes, min 8 |

Success returns `200` and revokes unused refresh tokens. Invalid/expired code
or token returns `400`.

## Rules

- Do not reveal whether the email exists.
- Never log reset tokens.
- A reset link is single-use and expires.
- After reset, the user must sign in again.

## Related

- [Sign in](auth-login.md)
- [Authentication guide](../authentication.md)
