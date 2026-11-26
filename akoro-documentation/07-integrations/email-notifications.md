---
title: Email and notifications
status: beta
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Email and notifications

## Purpose

One notification system serves every channel: email, SMS, WhatsApp and web
push. Sends are preference-aware, queued and idempotent, and most product
notifications actually travel as in-app/chat delivery — email is one channel
among several, not the default.

## Channels and providers the code actually uses

| Channel | Provider / mechanism | Where |
| --- | --- | --- |
| Transactional email (auth codes, account mail) | Resend (`resend` SDK) | `modules/auth/emails.js` templates; sender from `RESEND_FROM_EMAIL` |
| Session notification email | SMTP via `nodemailer` | `services/notificationService.js` |
| SMS | Twilio | `services/notificationService.js` |
| WhatsApp | Twilio (WhatsApp sender) | `services/notificationService.js` |
| Web push | `web-push` with VAPID keys | `services/notificationService.js`, `modules/notifications/webpush.js` |
| In-app / chat | First-party (socket + stored notifications) | `modules/notifications` |

SendGrid keys (`SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`) exist in the
environment template and the sender address falls back through them, but no
SendGrid send path is wired in the current notification service; Resend and
SMTP are the live email routes.

## Configuration surface (names only)

- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`.
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
  `DEFAULT_COUNTRY_CODE` (defaults to Nigeria's 234 when formatting numbers).
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
- Auth codes: `AUTH_CODE_TTL_MINUTES`, `AUTH_CODE_MAX_PER_HOUR`,
  `AUTH_CODE_RESEND_SECONDS`, `AUTH_EMAIL_CODES`.

## How sends flow

1. A feature asks the notification service (or the outbox) to notify a user.
2. Preferences are loaded from `user_notification_preferences`: per-channel
   switches (`email_enabled`, `sms_enabled`, `push_enabled`,
   `whatsapp_enabled`) and per-event toggles (session reminders, session
   started/cancelled/rescheduled, announcements, Q&A replies). Defaults:
   email on; SMS, push and WhatsApp off until the user opts in and supplies
   the address/token.
3. The send goes through the outbox (`lib/outbox.js` / `lib/outboxEngine.js`)
   with an idempotency key per logical message, and the attempt is logged to
   `notification_queue` with its channel, recipient and status.

## Failure handling

- Outbox sends are retryable after a restart without double-sending: the
  idempotency key, not the caller, decides whether a send already happened.
- A channel the user has disabled is skipped, not failed. A missing push
  token or phone number means that channel is simply not attempted.
- Product rule, verified in code behaviour: scheduled follow-up delivery
  does **not** send automatic email — delivery is chat plus in-app. The
  agent's send-email tool emails only the learner's own account address,
  only on their explicit ask, and honours `email_enabled = false`.

## Data shared and privacy impact

Providers receive the recipient address/number and the message content for
their channel: Resend/SMTP the email, Twilio the phone number and body.
Notification content is product content (session times, announcements,
account codes) — auth codes are single-purpose and short-lived under the
`AUTH_CODE_*` bounds. Learner phone numbers are shared with Twilio only when
the user enabled SMS/WhatsApp and provided the number.

## Related

- [Supabase](supabase.md)
- [Agent workflows](../06-agents/agent-workflows.md)
- [AI providers](ai-providers.md)
