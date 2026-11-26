---
title: System overview
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# System overview

## Purpose

Akoro is a learning platform served by one modular-monolith API and several
single-page frontends. This page maps the moving parts at the highest level;
each part has its own page in this section.

## Boundaries

The system owns accounts, programmes and courses, a learner Library of uploaded
records, an adaptive learning engine with AI agents, battles, communities, a
school platform, and payments/wallet. It does not own the AI models themselves,
the payment rails, or the GPU document-parsing model — those are external
services reached through adapters.

## Diagram

```text
  Learner app (PWA)   Instructor app   Admin app   School/tenant sites
        \                  |              |             /
         \______________ HTTPS + WebSocket ____________/
                                |
                     akoro-api (Express, app.js)
              modular monolith: one router per module
              /          |                    \
   Socket.io (Redis    Postgres          Redis
   adapter) rooms      (Supabase,        (queues, socket
        |              PostgREST)         adapter, quotas)
        |               |      \
   realtime        schemas:     R2 object storage
   updates         public/edu/  (uploads, HLS video)
                   content/mgmt
                                |
        Background lanes: BullMQ workers in-process (lib/startWorkers.js),
        a separate video-encoding worker (worker.js, VPS + FFmpeg),
        and a RunPod serverless GPU worker (document parsing/OCR)
```

## Request/event flow

1. A frontend calls the API over HTTPS with a JWT access token; long-lived
   updates (chat streaming, battles, live sessions) arrive over Socket.io.
2. `app.js` applies hardening, CORS, rate-limit identity and body parsing,
   then dispatches to the owning module's router.
3. Modules read and write Postgres through the Supabase PostgREST client
   (`db.js`) and store files in R2 via presigned URLs.
4. Slow or scheduled work leaves the request path: BullMQ queues, Postgres
   deferred jobs and cron sweeps run inside the API process (gated by
   `lib/jobsGate.js`), video encoding runs on a separate VPS worker, and
   scanned-document parsing is submitted to the RunPod GPU endpoint.

## Data and storage

- Postgres (Supabase) is the system of record; see
  [Database architecture](database-architecture.md).
- R2 holds uploaded files and encoded video; clients transfer bytes directly
  against presigned URLs, not through the API.
- Redis is infrastructure, not a store of record: Socket.io fan-out, BullMQ
  queues and quota guarding.

## Dependencies

- Supabase (Postgres + PostgREST), Redis, Cloudflare R2.
- AI providers behind the model registry — see
  [Model routing](model-routing.md).
- Paystack for payments (inbound webhooks), Resend/Nodemailer for email,
  Twilio, Deepgram (voice), web-push for push notifications.
- RunPod serverless for the document-parsing model; Hugging Face Hub hosts
  the model weights the worker loads offline.

## Failure modes

- Redis down: realtime fan-out and queued workers degrade; the jobs gate can
  stand background work down entirely (`AKORO_BACKGROUND_JOBS_ENABLED`).
- A model provider failing: calls fail over along a bounded fallback ladder
  (see [Model routing](model-routing.md)).
- A deploy whose migration fails: migrations run at boot from an ordered
  manifest, so a broken migration blocks the boot rather than corrupting
  state silently.

## Security and permissions

Authentication is JWT-based; authorisation, ownership and tenant isolation
are enforced in the API, module by module. See
[Security architecture](security-architecture.md).

## Invariants

- One API process shape everywhere: sandbox and production run the same
  `app.js`; only configuration and data differ.
- The server never posts its own messages into a learner chat; outcomes are
  narrated by the agent (see [Agent architecture](agent-architecture.md)).
- Background work must be gateable off without code changes.

## Observability

- `GET /health` reports database reachability and the deployed git SHA.
- Per-route usage metering counts PostgREST commands per route; an outbound
  meter wraps global `fetch` so provider calls are visible; AI calls are
  recorded by the telemetry in `lib/aiModel.js`.

## Related

- [Backend architecture](backend-architecture.md)
- [Frontend architecture](frontend-architecture.md)
- [Platform overview](../00-platform/platform-overview.md)
- [API contract](../02-api/openapi.yaml)
