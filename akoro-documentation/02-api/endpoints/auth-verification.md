---
title: Email and login verification
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.login
---

# Email and login verification

## POST /api/auth/verify-email

Completes signup verification.

| Field | Type | Required |
| --- | --- | --- |
| `challengeId` | UUID | yes |
| `code` | string | yes, 6 digits |

`200` issues the auth session and marks the email verified. Invalid/expired
codes return `400`.

## POST /api/auth/verify-login

Completes a login challenge.

| Field | Type | Required |
| --- | --- | --- |
| `challengeId` | UUID | yes |
| `code` | string | yes, 6 digits |

It accepts a `login` code or, for an unverified account, a `signup` code. On
success it may return an auth session or a 2FA challenge. Invalid codes return
`400`; an inactive user returns `401`.

## POST /api/auth/resend-code

Requests a fresh code.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `challengeId` | UUID | one of | Existing challenge |
| `email` | string | one of | Used when the challenge is lost |
| `purpose` | string | no | `signup`, `login`, `reset` |

Responses:

- `200 { codeSent, resendSeconds, challengeId?, expiresInMinutes?, retryAfter? }`
- Reset resends always return generic success and do not reveal account state.
- `400` when neither challenge nor email is supplied.
- `503` when the email provider failed.

## Rules

- Do not retry verification codes rapidly; respect `resendSeconds`.
- Do not reveal whether an email exists.
- A code is single-use and expires.
- After too many failures, restart the flow rather than guessing.

## Related

- [Register](auth-register.md)
- [2FA](auth-2fa.md)
- [Sign in](auth-login.md)
