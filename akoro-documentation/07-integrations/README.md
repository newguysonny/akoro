# Integrations

External services Akoro actually depends on, what each one is for, what it
receives, and how the platform behaves when it fails.

Status: Phase 3 in progress. The six documents below are drafted from the
current API code and dependency set; provider behaviour is described only
where the code proves it. Redis/queues and deployment services are used by
the platform but not yet documented here.

## Documents

- [Supabase](supabase.md) — hosted Postgres and the API's primary data client (service-role); what Supabase is *not* used for.
- [AI providers](ai-providers.md) — the model registry and its provider adapters (OpenCode transport, OpenAI, Anthropic, OpenAI-compatible), failover ladder, embeddings and voice.
- [Payment providers](payment-providers.md) — Paystack only: checkout, the signed webhook, payouts, refunds, vouchers.
- [Storage providers](storage-providers.md) — Cloudflare R2 via the S3 API, presigned URLs and the ownership check before presigning.
- [Email and notifications](email-notifications.md) — Resend and SMTP email, Twilio SMS/WhatsApp, VAPID web push, the preference-aware outbox.
- [Educational content](educational-content.md) — first-party content sources, the RunPod extraction worker, and meeting/video configuration surfaces.

## Rules

- Each integration must document configuration, data shared, failure modes, fallbacks and ownership.
- Document only providers and mechanisms the code actually uses; never invent configuration, pricing or endpoints.
- Environment variables are named, never valued.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.

## Not yet documented

- Redis (queues, rate limiting, socket adapter) and the job workers.
- Deployment and hosting services (API and frontend).
