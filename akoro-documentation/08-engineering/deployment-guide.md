---
title: Deployment guide
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Deployment guide

How code gets from `kilo/modular-storm-thz` to running services. The short
version from the repository `AGENTS.md`: **the branch deploys on push** —
anything written inside the repo ships, so previews and scratch files belong
outside the repo.

## API — Render

`render.yaml` at the repo root is the blueprint for the API service:

| Setting | Value |
| --- | --- |
| Service | `akoro-api` (web service, Node runtime) |
| Root directory | `akoro-api` |
| Build command | `npm ci` |
| Pre-deploy command | `npm run db:migrate` |
| Start command | `npm start` (`node app.js`) |
| Health check path | `/health` |
| Auto-deploy trigger | commit |

Two consequences:

- **Schema before code.** The pre-deploy step runs the `schema` migration
  group so new tables exist before new API code accepts traffic. Demo seed
  data is never deployed to production — the blueprint comment states this
  explicitly.
- **Sandbox and production are separate Render services** deploying from the
  same branch: sandbox at `https://sandbox.akoro.ng` (own database),
  production at `https://api.akoro.ng`. A push moves both; verify on the
  sandbox first and treat production as read-back only.

Before using the blueprint, `DATABASE_URL` (or `MIGRATION_DATABASE_URL`) must
be set in the service environment to a direct Postgres / Supabase pooler URL —
migrations need a connection string even though the API itself runs on
`SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.

## Migrations

- Migrations are SQL files in `akoro-api/migrations/`, applied by
  `scripts/apply-migrations.mjs` with groups: `schema`
  (`npm run db:migrate`), `demo` (`npm run db:seed:demo`), `all`
  (`npm run db:deploy`).
- `akoro-api/migrations/manifest.json` is the manifest that lists the files
  in each group (284 schema files and 37 demo files at last review). A
  migration file that is not listed in the manifest does not apply — adding
  the SQL file alone is not enough.
- At boot, when `MIGRATION_DATABASE_URL` is set, the API can apply pending
  schema migrations itself (`MIGRATIONS_ON_BOOT=false` disables this). The
  `.env.example` notes this removes the need for a host release hook; without
  the variable, run `npm run db:migrate` by hand after each schema-changing
  deploy.

## Frontends — Vercel

The web apps deploy via Vercel; `akoro-learner/vercel.json` is checked into
the repo. Frontend deploys can lag the push, and a Vercel "Redeploy" rebuilds
the same commit — it does not pick up newer code. Before telling anyone a UI
fix is live, confirm the served bundle actually flipped (walk the entry
chunk's import graph; see [Debugging guide](debugging-guide.md)).

Learner builds: `npm run build:app` and `npm run build:landing` produce the
two targets from `akoro-learner/`.

## Workers and edge

GitHub Actions deploy the specialised workers on push:
`.github/workflows/deploy-runpod-worker.yml`, `deploy-media-worker.yml` and
`deploy-embed-worker.yml`. The API's own background worker is the separate
`worker.js` process (`npm run worker`) — the video-encoding worker polls
BullMQ and can be stood down with `VIDEO_WORKER_ENABLED=false` on
per-command-billed Redis.

## Release discipline

- Fixes accumulate and ship on an explicit go-ahead; after a build failure,
  explain first, verify second, push third.
- After pushing, fetch the pushed files back from the branch and grep them;
  then confirm the sandbox `/health` build SHA matches before running the
  verify gate (see [Testing strategy](testing-strategy.md)).
- A deploy is not "live" because the push succeeded. It is live when the
  health endpoint (API) or the served bundle (frontend) shows the new build.
