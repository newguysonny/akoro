---
title: POST /api/auth/register
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capability: auth.login
---

# POST /api/auth/register

Creates a learner, instructor or school-admin account.

## Authentication

None. Public and rate-limited.

## Request body

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes | Valid email |
| `password` | string | yes | At least 8 characters |
| `username` | string | no | 3–40 chars, letters/numbers/underscore; auto-generated if omitted |
| `fullName` | string | no | Max 120 |
| `role` | string | no | `student` (default), `instructor`, `school_admin` |

## Responses

| Status | Meaning |
| --- | --- |
| 201 | Account created; tokens issued, or verification required |
| 200 | Existing unverified account: new code sent; or generic "use your password" for a verified account |
| 400 | Invalid password, username taken, or email already registered when codes are off |
| 422 | Validation failed |
| 429 | Rate limited |
| 503 | Verification email could not be sent |

When verification is required, the response contains `verificationRequired`,
`email`, `codeSent`, and usually `challengeId`, `expiresInMinutes` and
`resendSeconds`.

## Side effects

- Creates the user.
- May issue an email verification code.
- May send a welcome email after verification.
- May set session cookies if verification is not required.

## Verification

- `POST /api/auth/verify-email` (or `verify-login`) with the challenge.
- The returned session works on `GET /api/auth/me`.

## Related

- [Verification](auth-verification.md)
- [Sign in](auth-login.md)
- [Authentication guide](../authentication.md)
