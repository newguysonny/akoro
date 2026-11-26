---
title: Debugging guide
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Debugging guide

A working order for diagnosing Akoro problems, built from the checks the repo
itself provides. Start with the environment, then the build, then the
behaviour — most "bugs" are one of the three.

## 1. Which build is actually running?

Deploy confusion is the most common false bug. Before debugging behaviour:

- API: `GET /health` on the target host reports the deployed git build. On
  the sandbox (`https://sandbox.akoro.ng/health`), wait until `.build.git`
  equals the commit you pushed; a cold start can answer 502 for about a
  minute after a deploy.
- Frontend: the live app is a hashed bundle. Confirm the flip by walking the
  entry chunk's import graph and grepping for your change — do not rely on
  the service worker's precache list, which does not include every chunk.
- After any push, fetch the pushed file back from the branch and grep it.
  "Pushed" is a claim; the fetched file is the receipt.

## 2. Reproduce locally

```bash
cd akoro-api
npm run dev                  # node --watch app.js
node --test <failing-file>   # isolate one suite
npm run test:structure       # rule out structural regressions first
npm run typecheck
```

Check `.env` against `akoro-api/.env.example`: missing platform-address
variables fall back silently in the product, but the API logs a boot warning
naming the ones that are missing — read the boot log before anything else.

## 3. Sandbox vs production discipline

- Reproduce and verify on the sandbox only. Production is for read-only
  health and deploy read-backs.
- If the production verify gate's sandbox forwarding answers 503, run against
  `sandbox.akoro.ng` directly (per the repository `AGENTS.md`).
- A verify run's FAIL/BLOCKED verdict is a result, not a nuisance: report the
  run id, the commit and every failed assertion.

## 4. Agent and chat problems

- The agent chat loop emits a structured trace per turn (thinking blocks,
  tool groups, activity). Read the trace before reading the code: it shows
  which tools were offered, which ran, and what each returned.
- Check the kill switches before assuming code is missing: many slices are
  gated by `AKORO_*` flags where `=false` removes the slice everywhere (see
  [Environment variables](environment-variables.md)).
- Model behaviour differs by provider: a turn shape one provider tolerates
  (for example tool-call history with no tools declared) can make another
  return empty or scrubbed output. When a failure is model-shaped, test the
  same turn against the configured default and fallback models
  (`AI_MODEL_DEFAULT` / `AI_MODEL_FALLBACK`).

## 5. Redis and background jobs

- `.env.example` documents `AKORO_REDIS_TRACE` (with `AKORO_REDIS_TRACE_MAX`)
  for local Redis forensics: it logs a stack trace and call-site for every
  Redis command plus a per-minute tally. Local only — it defaults off and
  must stay off in production.
- If scheduled jobs do not fire, check `CRON_SOURCE` and
  `AKORO_BACKGROUND_JOBS_ENABLED`: with the Cloudflare ticker selected, the
  edge worker fires the jobs via the API's internal tick routes; with
  background jobs disabled, the API stays functional but periodic jobs stand
  down.

## 6. Reporting a bug you cannot fix

Per the [AGENTS guide](../AGENTS.md) §13, report: the task, the capability or
endpoint attempted, the exact error, what was verified, the missing
documentation or contract, and the safest next step. Do not invent an answer
to fill a gap — an honest "unverified" beats a confident guess.
