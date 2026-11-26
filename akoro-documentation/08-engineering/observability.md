---
title: Observability
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Observability

What you can actually observe in Akoro today, and where. This page is
deliberately conservative: it documents the signals that exist in the code
and configuration, and names the gaps instead of inventing a monitoring
stack that is not there.

## Health and build identity

- `GET /health` on the API reports liveness and the deployed git build. It
  is the Render health check (`healthCheckPath: /health` in `render.yaml`)
  and the engineer's first deploy receipt: after a push, the sandbox
  `/health` build SHA must equal the pushed commit before any verification
  claim (see [Debugging guide](debugging-guide.md)).
- Boot logging: the API logs a warning at boot naming any platform-address
  environment variables that fell back to defaults (see
  [Environment variables](environment-variables.md)). A clean boot log is
  part of a healthy deploy.

## Agent and workflow traces

- Every agent chat turn produces a structured trace — thinking blocks, tool
  groups and per-step activity — persisted with the conversation. The trace
  is the primary debugging surface for agent behaviour: which tools were
  offered, which ran, and what each returned.
- Workflow state is database state, changed only by code, and significant
  steps emit structured events that are stored and replayable (Grand Plan
  §7.9). When a learner-facing flow misbehaves, the persisted state plus the
  event stream — not the UI — is the source of truth.

## Verification as an observable signal

- The sandbox verify gate records runs with scenario-level verdicts and
  failed assertions. A run id plus its verdict is the durable evidence for
  "this build works"; keep the run id in the report back.
- The documentation smoke scripts under `akoro-documentation/scripts/`
  produce pass/fail results for auth, records and course-video paths on the
  sandbox (see [scripts README](../scripts/README.md)).

## Local forensics

- Redis: `AKORO_REDIS_TRACE` (with `AKORO_REDIS_TRACE_MAX`) logs a stack
  trace and call-site for every Redis command plus a per-minute tally. It is
  a local debugging tool — zero behaviour change intended, and it must stay
  off in production.
- Load protection is observable in configuration: circuit-breaker
  (`BREAKER_*`), load-shedding (`SHED_*`) and per-plan quota (`QUOTA_*`)
  settings bound how the API degrades under pressure.

## Gaps (honest)

- There is no single documented metrics/tracing pipeline (no central
  dashboard, alert catalogue or SLO document) in the repository today.
  Host-level signals come from Render (API) and Vercel (frontends)
  dashboards, which are operational tooling, not repo artefacts.
- Public status reporting is wired outside this repository (the public docs
  status page redirects to the hosted status service). Incident process is
  team practice, not yet a written runbook — treat any claim of an on-call
  rota or alert threshold as unverified until it is documented here.
