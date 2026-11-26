---
title: Repository structure
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Repository structure

`newguysonny/akoro` is a monorepo. The deploy branch is
`kilo/modular-storm-thz`. This page maps the top level as it exists on that
branch; it is a map, not an inventory — when in doubt, the tree itself wins.

## Applications

| Path | What it is |
| --- | --- |
| `akoro-api/` | The platform API — a modular monolith (its package description is "Akoro Learning Platform — Modular Monolith API"). Express + PostgreSQL (Supabase) + Redis/BullMQ + Socket.IO. |
| `akoro-learner/` | Learner web app (React + Vite). Builds two targets: the app and the landing site (`build:app` / `build:landing`). |
| `akoro-instructor/` | Instructor web app. |
| `akoro-admin/` | Admin web app. |
| `akoro-school/` | School web app. |
| `akoro-docs/` | Public documentation site source. |
| `akoro-documentation/` | This internal documentation system. |
| `akoro-python-agent/` | Python agent service; the API reaches it through a private, secret-guarded bridge (see [Environment variables](environment-variables.md)). |

## Workers and edge services

| Path | What it is |
| --- | --- |
| `runpod-worker/` | GPU document-parsing worker (deployed via `.github/workflows/deploy-runpod-worker.yml`). |
| `media-worker/` | Media processing worker (`.github/workflows/deploy-media-worker.yml`). |
| `embed-worker/` | Embedding worker (`.github/workflows/deploy-embed-worker.yml`). |
| `cf/` | Cloudflare edge code, including the cron ticker that can fire scheduled jobs via the API's internal tick routes. |
| `proctor-service/` | Proctoring service for proctored practice/assessment. |
| `lead-scout/` | Lead-scout service, called by the API (`LEAD_SCOUT_URL`). |

## Inside `akoro-api/`

- `app.js` — HTTP entry point (`npm start`). `worker.js` — background worker
  entry point (`npm run worker`).
- `modules/` — the modular monolith: one directory per domain (for example
  `adaptive-learning`, `auth`, `records`, `courses`, `battle`, `communities`,
  `self-study`, `self-tooling`, `agent-network`, `wallet`, `vouchers`,
  `verify`). Modules are entered through `index.js` only, and every module
  carries a README — the structural rules are enforced by
  `modules/structure.contract.test.mjs` against `modules/structure-baseline.json`
  (see [Coding standards](coding-standards.md)).
- `lib/`, `middleware/`, `config/`, `services/`, `utils/`, `workers/` — shared
  code used across modules.
- `migrations/` — SQL migrations plus `manifest.json`, the manifest that
  decides which migrations apply (see [Deployment guide](deployment-guide.md)).
- `scripts/` — operational scripts: `apply-migrations.mjs`, `preflight-security.mjs`,
  smoke scripts, backfills.
- `patches/` — `patch-package` patches applied on install.
- Tests sit next to the code they cover as `*.test.mjs` / `*.contract.test.mjs`
  files, both inside `modules/` and at the package root.

## Shared and reference material

- `reference/` — design references, including `reference/Grand Plan.md`, the
  learning-agent plan the roadmap pages summarise (see
  [Current direction](../12-roadmap/current-direction.md)).
- `docs/` — repository-level plans, including
  `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`. Extend existing plans; do not
  create new top-level plans.
- `design-system/`, `assets/`, `training/`, `archive/` — design assets,
  training material and archived work.
- `.github/workflows/` — CI and deploy workflows, including `docs.yml`,
  `verification-gates.yml`, `changelog-draft.yml` and the worker deploys.
- `render.yaml` (repo root) — the Render blueprint for the API service.
- `Dockerfile` (repo root) and `tsconfig.base.json` — container build and the
  shared TypeScript configuration the packages extend.
