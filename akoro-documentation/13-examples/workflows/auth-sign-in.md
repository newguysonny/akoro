---
title: Sign in and maintain a session
status: implemented
doc_status: overview
tier: 1
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
workflow_id: auth.sign_in
capabilities: [auth.login, auth.refresh]
---

# Sign in and maintain a session

## Objective

Authenticate a user in the correct portal, keep the session alive, and sign out
safely.

## Required context

- Email and password (or Google OAuth).
- Portal: `student`, `instructor`, `school`, `admin`.
- Client type: browser or mobile.

## Steps

| Step | Capability/API | Success condition |
| --- | --- | --- |
| 1 | `POST /api/auth/login` with `X-Akoro-Portal` | 200, user + tokens |
| 2 | If verification is required, `POST /api/auth/verify-login` | 200, session issued |
| 3 | If 2FA is required, `POST /api/auth/2fa/login` | 200, session issued |
| 4 | Call an authenticated endpoint such as `GET /api/records` | 200 |
| 5 | Before expiry, `POST /api/auth/refresh` | 200, rotated tokens |
| 6 | Sign out with `POST /api/auth/logout` | Cookies cleared |

## Decision rules

| Condition | Action |
| --- | --- |
| `verificationRequired` | Ask for the email code, then verify |
| `twoFactorSetupRequired` | Run setup/enable flow |
| `twoFactorRequired` | Ask for the TOTP code |
| 401 on refresh | Clear local session and sign in again |
| 429 | Respect `Retry-After`; do not hammer |

## Failure and retry

- 401 on login: do not retry the same credentials repeatedly.
- 401 on refresh: clear the session.
- Network timeout: verify whether cookies were set before retrying.
- Do not retry a 422 without fixing the request.

## Verification

- The authenticated endpoint succeeds.
- The portal cookie is present for the correct portal.
- Refresh returns a new access token.

## Prohibited

- Never store refresh tokens in localStorage when cookies are available.
- Never send a learner token to an admin/instructor portal.
- Never use production credentials in examples.

## Related

- [Sign in endpoint](../../02-api/endpoints/auth-login.md)
- [Refresh endpoint](../../02-api/endpoints/auth-refresh.md)
- [Authentication guide](../../02-api/authentication.md)
