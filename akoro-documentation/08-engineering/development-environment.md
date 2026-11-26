---
title: Development environment
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Development environment

How the pieces of a working Akoro dev setup fit together: local processes, the
sandbox, and the shared services the API expects.

## Environments

| Environment | API host | Purpose |
| --- | --- | --- |
| Local | your machine | Day-to-day development; run the API and apps from source. |
| Sandbox | `https://sandbox.akoro.ng` | Shared pre-production environment with its own database. All live verification happens here — never on production. |
| Production | `https://api.akoro.ng` | Live traffic. Read-only health/deploy read-backs only during development work. |

The learner app is served from `https://app.akoro.ng`; the sandbox API is a
separate Render service from production, both deploying from
`kilo/modular-storm-thz` (see [Deployment guide](deployment-guide.md)).

## Local API

```bash
cd akoro-api
npm ci                 # some tests need the bcrypt native binding built
cp .env.example .env   # then fill in values for your environment
npm run dev            # node --watch app.js
```

Configuration notes that come from `.env.example` itself:

- Platform addresses (`FRONTEND_URL`, `MAIN_SITE_URL`,
  `INSTRUCTOR_FRONTEND_URL`, `ADMIN_FRONTEND_URL`, `SCHOOL_FRONTEND_URL`,
  `API_URL`) default in `lib/urls.js`; production must set them explicitly —
  the API logs a boot warning naming any that are missing.
- The runtime database pool should point at the Supabase **transaction
  pooler**; migrations want a direct/session connection (`DATABASE_URL` vs
  `MIGRATION_DATABASE_URL` — see [Environment variables](environment-variables.md)).
- Keep `DB_POOL_MAX` small: the pooler absorbs spikes, and the budget is
  `DB_POOL_MAX × instances + 1 migration client ≤ project limit`.

## Local frontends

```bash
cd akoro-learner
npm install
npm run dev    # Vite dev server
```

Point the app at the API with its Vite environment (the learner package has
its own `.env.example`; `VITE_API_URL` selects the API base and `VITE_TARGET`
selects app vs landing for builds). The sandbox API's CORS only allows the
production app origin, so browser-based local rigs against the sandbox
typically run behind a small local relay — treat that as test tooling, not as
part of the product.

## Sandbox verification loop

The repository `AGENTS.md` defines the gate; in outline:

1. Commit and push to `kilo/modular-storm-thz`.
2. Wait until `https://sandbox.akoro.ng/health` reports `.build.git` equal to
   the pushed SHA (a cold start can answer 502 for about a minute).
3. Run a verify suite pinned to that SHA through the sandbox verify gate and
   poll for the verdict; report the verdict, run id, commit and every failed
   assertion. FAIL or BLOCKED means not verified.

The documentation smoke scripts under `akoro-documentation/scripts/` follow
the same discipline — they refuse any host except `sandbox.akoro.ng` and do
nothing without `--confirm` (see [scripts README](../scripts/README.md)).

## Demo and test accounts

Sandbox demo accounts exist for learners, instructors and admins and are the
only accounts examples and tests may use. Never use production credentials in
a local environment, a test or an example (see [AGENTS guide](../AGENTS.md)
§6). Demo seed data is a separate migration group (`demo` in
`akoro-api/migrations/manifest.json`) and must never be deployed to
production — the Render blueprint's pre-deploy step runs the `schema` group
only.
