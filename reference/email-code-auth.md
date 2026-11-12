# Email-code verification (signup / login / reset)

**Status:** implemented, **off by default** via `AUTH_EMAIL_CODES`.
**Transport:** **Resend primary** (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`); **SendGrid fallback** (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) if Resend is unavailable or rejects the send.

## Flows

### Create an account
1. `POST /api/auth/register` creates the user with `email_verified=false` (when the portal is enabled) and emails a 6-digit code. It does **not** issue tokens.
2. `POST /api/auth/verify-email { challengeId, code }` verifies, sets `email_verified=true`, sends the welcome email and issues the session.
3. `POST /api/auth/resend-code { challengeId }` re-sends (60 s cooldown, max 5/hour).

### Sign in
1. `POST /api/auth/login` still verifies the password (and account state) but returns `{ codeRequired:true, challengeId }` (or `verificationRequired` for an unverified account) instead of tokens.
2. `POST /api/auth/verify-login { challengeId, code }` verifies the code. If TOTP is enabled it then returns `{ twoFactorRequired, challengeToken }`; `POST /api/auth/2fa/login` finishes with the TOTP code. Otherwise it issues the session and sends the login alert.

### Reset a password
1. `POST /api/auth/forgot-password { email }` always returns 200 `{ codeFlow:true }` when the portal is enabled; if the account exists it emails a reset code.
2. `POST /api/auth/reset-password { email, code, password }` verifies the code, updates the password, consumes the code, revokes refresh tokens and sends the “password changed” email.
   The legacy link flow (`{ token, password }`) still works.

## Security
- 6-digit code, **HMAC-SHA256** stored (never plaintext); `AUTH_CODE_SECRET` (falls back to `COOKIE_SECRET`).
- 10-minute expiry, **5 attempts**, single use; a new code invalidates the previous one.
- Constant-time compare; invalid/expired/used codes share one message.
- 60-second resend cooldown and 5 sends/hour per email+purpose, plus the existing per-IP `strictLimit`.
- Forgot-password never reveals whether an email exists; reset codes are looked up by email+purpose.
- Existing users are grandfathered `email_verified=true` by the migration, so enabling the flow cannot lock anyone out.
- Codes count as unsolicited email only if someone targets an address; rate limits cap abuse.

## Rollout
1. Apply migration `2026-email-verification-codes.sql`.
2. Ensure `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are set (SendGrid keys optional, used only as fallback). `AUTH_EMAIL_CODES` stays `off`.
3. Deploy the learner app (code screens implemented for Signin, Signup, Forgot, Reset).
4. Set `AUTH_EMAIL_CODES=student` and test register → verify → login → reset.
5. Update the admin/instructor portals' sign-in/sign-up screens, then widen to `student,instructor,admin` or `on`.

## Status of the UIs
- **Learner (`akoro-learner`)**: signup, sign-in and reset code screens implemented.
- **Admin / instructor**: still the legacy password-only screens; keep those portals out of `AUTH_EMAIL_CODES` until updated.
- Google sign-in is unchanged and does not use email codes.
