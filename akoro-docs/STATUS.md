# Status Page Setup

Provider decision for the first launch: **Instatus Starter** (free), upgrade to
Pro later for `status.akoro.ng` and 30-second checks.

## Why Instatus Starter

- Managed and independent of Render/Vercel/Akoro.
- 15 monitors, 2-minute checks, 200 subscribers, public page, email alerts.
- No custom domain on Starter; the page lives on an Instatus URL until Pro.
- Pro adds the custom domain, 30-second checks, 5,000 subscribers and SMS/voice.

## Starter components

Create one component per user-facing service:

1. Learner app
2. Instructor app
3. School app
4. Admin app
5. API
6. Authentication
7. Database
8. File storage (R2)
9. Media encoding
10. Extraction/OCR
11. AI providers
12. Email/SMS
13. Payments

Start with the critical five: API, Authentication, Database, File storage and
Media encoding. Add the rest as monitors are configured.

## Monitors

| Monitor | URL | Notes |
| --- | --- | --- |
| API health | `https://api.akoro.ng/health` | 2-minute checks on Starter |
| Learner app | `https://app.akoro.ng` | Synthetic landing check |
| Instructor app | `https://instructor.akoro.ng` | Synthetic check |
| School app | School portal URL | Synthetic check |
| Admin app | Admin portal URL | Synthetic check |
| Media worker | `https://<media-worker>/edge-health` | Public edge health |
| Database/Redis | Deep health endpoint | Private; use a secure monitor where supported |

Do not put secret-bearing URLs in a public status page.

## Incident process

- Use `Investigating → Identified → Monitoring → Resolved`.
- Post first update within 15 minutes for SEV-1; every 15 minutes after.
- Use incident templates; schedule maintenance separately.
- Publish a redacted postmortem for SEV-1/2.

## Wire the docs

1. Create the Instatus page.
2. Copy its public URL.
3. Set `NEXT_PUBLIC_STATUS_URL` in the `akoro-docs` Vercel project.
4. Redeploy. `/status` redirects; the Status nav link appears.
5. Add the status badge to the docs footer/index when available.

## Upgrade to Pro later

Pro provides the custom domain `status.akoro.ng`, 50 monitors, 30-second checks,
5,000 subscribers and SMS/voice. The migration is a CNAME change plus updating
`NEXT_PUBLIC_STATUS_URL`; no app code changes.
