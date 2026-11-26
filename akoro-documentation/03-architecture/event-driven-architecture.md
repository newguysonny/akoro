---
title: Event-driven architecture
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Event-driven architecture

## Purpose

Akoro has no general-purpose event bus, and this page exists to say so
plainly. Asynchronous behaviour is built from four concrete mechanisms —
queues, deferred jobs, realtime socket emissions, and inbound webhooks —
each owned by the module that uses it. Anything described elsewhere as an
"event" in Akoro is one of these four.

## Boundaries

| Mechanism | Used for | Transport |
| --- | --- | --- |
| BullMQ queues | Battles, eval runs, agent inbox, chat follow-ups, quiet learning, self-tool resumes, video encoding | Redis |
| Deferred jobs | Waits that must survive restarts without holding Redis state (for example the quiet-learning settle wait) | Postgres rows, woken by workers/sweeps |
| Socket.io emissions | Chat streaming, battle state, live sessions, discussion and voice signalling | WebSocket (polling fallback), Redis adapter for fan-out |
| Inbound webhooks | Payment confirmation (Paystack), marketplace payment callbacks | HTTPS with signature validation on the raw body |

Scheduled sweeps and crons (node-cron and module schedulers) are the fifth,
time-based trigger; they are covered in
[Background workers](background-workers.md).

## Diagram

```text
producer (route, worker, cron)          consumer
        |                                    |
        +-- queue.add (BullMQ) ------------> Worker in API process
        |                                    (or worker.js on a VPS)
        +-- deferred row (Postgres) -------> sweep wakes it -> queue
        |
        +-- io.to(room).emit --------------> connected clients
        |
external provider -- signed webhook -----> raw-body route -> module
                                             handler -> state change
```

## Request/event flow

1. A route that triggers slow work enqueues and returns; the worker
   performs the work and writes results to Postgres. Clients learn the
   outcome by polling, by notification, or by a socket emission — there is
   no callback registry.
2. Socket rooms are the realtime addressing model: a client joins the
   rooms its session entitles it to, and modules emit to rooms. The Redis
   adapter lets any API process fan out to clients connected to another.
3. Webhooks are handled synchronously in the route after signature
   validation; the raw-body parsers for webhook paths are mounted before
   the global JSON parser in `app.js`, because parsing first would destroy
   the bytes the signature covers.

## Data and storage

Queue payloads are job inputs, not records: durable state always lands in
Postgres, so a lost queue message loses at most the trigger, and several
workers pair their queue with a periodic sweep that re-discovers lost work
(for example the self-tooling resume sweep).

## Dependencies

Redis (queues and socket fan-out), Postgres (deferred jobs and all durable
state), Socket.io, BullMQ.

## Failure modes

- Redis unavailable: queues stall and socket fan-out degrades to the local
  process; request-path work that does not need Redis continues.
- Duplicate delivery is expected: consumers are written to be idempotent
  or watermark-checked (one quiet-learning pass per chat watermark; a
  replay is a no-op).
- A webhook with an invalid signature is rejected; payment state never
  changes on an unverified call.

## Security and permissions

Socket connections authenticate from the handshake cookie and inherit the
CORS origin policy — only portal origins are credentialed. Internal
callbacks between the video worker and the API require the shared internal
secret. Queue and deferred-job payloads carry identifiers, not credentials.

## Invariants

- No module publishes to a topic another module subscribes to by
  convention; every async hand-off names its queue or its room explicitly
  in code.
- Durable truth is Postgres; Redis state is always rebuildable or
  expirable.

## Observability

Worker start lines and job logs at boot and per job; queue health is
visible through the same worker logging as the rest of the background lane.

## Related

- [Background workers](background-workers.md)
- [Backend architecture](backend-architecture.md)
- [System overview](system-overview.md)
