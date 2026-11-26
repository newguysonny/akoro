---
title: Getting started
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Getting started

The fastest path from a fresh clone of `newguysonny/akoro` to a running API and
a passing test suite. Work on branch `kilo/modular-storm-thz` unless a task
names another branch — that branch is the deploy branch (see
[Deployment guide](deployment-guide.md)).

## 1. Prerequisites

- Node.js with npm (the API and all apps are Node/Vite projects; `akoro-api`
  declares `"type": "module"`, so code is ESM throughout).
- Access to a Supabase project (database + auth storage) and Redis for the
  API's runtime dependencies. For most feature work, point the API at the
  sandbox environment instead of provisioning your own — see
  [Development environment](development-environment.md).
- Environment variables: copy `akoro-api/.env.example` to `akoro-api/.env` and
  fill in the values for your environment. Variable names and purposes are
  catalogued in [Environment variables](environment-variables.md). Never commit
  a real `.env`.

## 2. Install and run the API

```bash
cd akoro-api
npm ci            # postinstall runs patch-package
npm run dev       # node --watch app.js
npm start         # plain production-style start: node app.js
```

The background/video worker is a separate process from the same package:

```bash
npm run worker        # node worker.js
npm run worker:dev    # node --watch worker.js
```

Health check: `GET /health` on the running API (the Render service uses this
path as its health check).

## 3. Run the learner app

```bash
cd akoro-learner
npm install
npm run dev           # vite dev server
npm run build:app     # VITE_TARGET=app production build
npm run build:landing # VITE_TARGET=landing production build
```

The learner package builds two targets (app and landing) from one codebase;
`SPLIT.md` in `akoro-learner/` describes the split.

## 4. First checks before you change anything

From the repository's own `AGENTS.md`, the always-run API checks are:

```bash
cd akoro-api
npm run test:structure   # structural guardrails — always run
npm run test:client
npm run test:agent-chat
npm run typecheck        # tsc --noEmit
node --test <file>       # run a single test file
```

There is no aggregate test runner; suites are named npm scripts. See
[Testing strategy](testing-strategy.md) for the full list and
[Repository structure](repository-structure.md) for where things live.

## 5. Rules that apply from day one

- A change that alters behaviour updates the relevant docs and changelog in
  the same pull request (see [README](../README.md) rules and
  [Contribution guide](contribution-guide.md)).
- Verify fixes on the sandbox before claiming them — a passing local test is
  not verification. The verify gate is described in the repository `AGENTS.md`
  and in [Debugging guide](debugging-guide.md).
- Never write secrets, tokens or real learner data into code, docs or tests
  (see [AGENTS guide](../AGENTS.md) §11).
