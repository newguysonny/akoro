---
title: Environment variables
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Environment variables

Names and purposes only, taken from `akoro-api/.env.example` on
`kilo/modular-storm-thz`. **No values appear here, and none ever should** —
real values live in the host's environment settings or a local `.env` that is
never committed. The `.env.example` file is the source of truth; this page is
an index into it. Frontend apps have their own examples (for example
`akoro-learner/.env.example`, where `VITE_API_URL` selects the API base).

## Instance and platform addresses

- `NODE_ENV`, `PORT`, `HOST`, `SHUTDOWN_TIMEOUT` — process basics and
  graceful-shutdown budget.
- `CORS_ORIGIN` — allowed origins (comma-separated; any subdomain of
  `SITE_BASE_DOMAIN` is also allowed).
- `FRONTEND_URL`, `MAIN_SITE_URL`, `INSTRUCTOR_FRONTEND_URL`,
  `ADMIN_FRONTEND_URL`, `SCHOOL_FRONTEND_URL`, `API_URL`, `APP_URL` — the
  platform's public addresses. Defaults live in `lib/urls.js`; production
  must set them explicitly, and the API logs a boot warning naming any
  missing ones.
- `SITE_BASE_DOMAIN` — wildcard base domain for school sites; set it
  explicitly, never derive it from `FRONTEND_URL`.
- `GOOGLE_CALLBACK_URL` — OAuth callback address.

## Data stores

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — Supabase project and service-role
  key used at runtime. (`SUPABASE_SERVICE_ROLE_KEY` is a legacy alias read by
  some agent modules; it falls back to `SUPABASE_SERVICE_KEY`.)
- `DATABASE_URL` — general Postgres URI; point it at the Supabase transaction
  pooler. `DB_READ_URL` — optional read connection.
- `MIGRATION_DATABASE_URL` — migration-only connection (session/direct); the
  migration runner prefers it, and when set the API can apply pending schema
  migrations at boot (`MIGRATIONS_ON_BOOT` toggles that).
- `DB_POOL_MAX`, `DB_POOL_IDLE_MS`, `DB_POOL_CONNECT_MS` — runtime pool
  sizing; keep the pool small (see the budget note in `.env.example`).
- `REDIS_URL` — Redis connection for queues, Socket.IO adapter and caching.

## Auth and internal secrets

- `JWT_SECRET`, `JWT_EXPIRES_IN`, `BCRYPT_ROUNDS` — token signing and
  password hashing. `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`, `JWT_ISSUER`,
  `JWT_AUDIENCE` — RS256 keys and the opaque issuer/audience claims (changing
  issuer/audience signs every user out).
- `INTERNAL_SECRET` — shared secret guarding internal/worker callbacks.
- `AKORO_AGENT_TOOLS_SECRET`, `AKORO_AGENT_TOOLS_CAPABILITY_SECRET` —
  secrets for the private Node → Python agent bridge and its session-bound
  capability tokens; never sent to a browser.
- `PYTHON_AGENT_SERVICE_URL`, `AKORO_AGENT_SERVICE_SECRET` — the Python agent
  service address and its shared secret.
- `AUTH_EMAIL_CODES`, `AUTH_CODE_SECRET`, `AUTH_CODE_TTL_MINUTES`,
  `AUTH_CODE_RESEND_SECONDS`, `AUTH_CODE_MAX_PER_HOUR`,
  `AUTH_EMAIL_CODES_BYPASS` — email sign-in code flow and its limits.

## Feature flags and agent runtime

- Default-on kill switches (absent = enabled, `=false` removes the slice):
  `AKORO_STUDY_PREP_ENABLED`, `AKORO_EXAM_PREP_CONFIDENCE_ENABLED`,
  `AKORO_ADAPTIVE_WORKFLOWS_ENABLED`, `AKORO_CONCEPT_TRACKER_ENABLED`,
  `AKORO_LEARNER_INSIGHTS_ENABLED`,
  `AKORO_AGENT_CHAT_DURABLE_CONTEXT_ENABLED`.
- `AKORO_TEACHING_WORKFLOW_SESSION_TTL_SECONDS` — teaching-workflow session
  lifetime.
- `AKORO_AUTONOMY_*` (`CYCLE_EVERY`, `MODE`, `TICK_MS`, `BATCH_LIMIT`,
  `MIN_CYCLE_MS`, `MIN_CYCLE_HOURS`, `WINDOW_START_HOUR`, `WINDOW_END_HOUR`,
  `TRIGGER_COOLDOWN_MS`, `MAX_WEEKLY_RUNS`) — background planner cadence and
  budgets; all values apply at boot.
- `AKORO_BACKGROUND_JOBS_ENABLED` — stands down every recurring job on
  metered deployments while the API stays functional.
- `CRON_SOURCE` — `local` (node-cron in-process) or `cloudflare` (the edge
  ticker fires jobs via internal tick routes).

## AI providers and models

- `AI_MODEL_DEFAULT`, `AI_MODEL_FALLBACK`, `AI_RUNTIME_OVERRIDE`,
  `AI_BILL_PROVIDER_COST` — model catalogue resolution and cost billing.
- `OPENAI_API_KEY`, `OPENAI_MODEL` — OpenAI provider.
- `OPENCODE_API_KEY`, `OPENCODE_BASE_URL`, `OPENCODE_USER_AGENT` — OpenCode
  provider.

## Integrations

- Meetings/OAuth: `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET` /
  `REDIRECT_URI_ZOOM`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `REDIRECT_URI_GOOGLE`, `TEAMS_CLIENT_ID` / `TEAMS_CLIENT_SECRET` /
  `REDIRECT_URI_TEAMS`, `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` /
  `REDIRECT_URI_YOUTUBE`.
- Email: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SENDGRID_API_KEY`,
  `SENDGRID_FROM_EMAIL`.
- SMS/voice: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_PHONE_NUMBER`, `DEFAULT_COUNTRY_CODE`.
- Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`.
- Payments: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`,
  `PAYSTACK_WEBHOOK_URL`, `PLATFORM_COMMISSION_PERCENT`,
  `PAYOUT_MINIMUM_KOBO`.
- Vouchers: `VOUCHER_API_KEY`, `VOUCHER_PLATFORM_FEE_PCT`, `USD_NGN_RATE`,
  `VOUCHERS_FRONTEND_URL`.
- `LEAD_SCOUT_URL`, `LEAD_SCOUT_SECRET` — lead-scout service.
- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` — Vercel API access
  used by platform automation.

## Workers, media and resilience

- `VIDEO_WORKER_ENABLED`, `WORKER_CONCURRENCY`, `FFMPEG_PATH`,
  `FFPROBE_PATH`, `TEMP_DIR`, `API_BASE_URL` — media/encoding worker.
- `AKORO_REDIS_TRACE`, `AKORO_REDIS_TRACE_MAX` — local-only Redis command
  forensics; keep off in production.
- `BREAKER_TIMEOUT_MS`, `BREAKER_ERROR_PCT`, `BREAKER_RESET_MS` — circuit
  breaker. `SHED_LAG_MS`, `SHED_MEM_MB`, `SHED_RETRY_AFTER_S` — load
  shedding. `QUEUE_MAX_TASKS`, `QUEUE_MAX_EVALS`, `QUEUE_MAX_FOLLOWUPS`,
  `QUEUE_MAX_AUTONOMY` — queue caps.
- `TENANT_QUOTA`, `QUOTA_PILOT_PER_MIN`, `QUOTA_FREEMIUM_PER_MIN`,
  `QUOTA_PREMIUM_PER_MIN` — per-plan rate quotas. `TRUST_PROXY` — proxy
  trust setting.
