---
title: Backend architecture
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Backend architecture

## Purpose

`akoro-api` is a modular monolith: one Express process (`app.js`, started with
`node app.js`) that mounts one router per product module. There are no
microservices; module boundaries are directory boundaries under
`akoro-api/modules/`, shared machinery lives in `akoro-api/lib/`, and
cross-cutting middleware lives in `akoro-api/middleware/`.

## Boundaries

Each module owns its routes and its tables' access patterns: `auth`,
`courses`, `programmes`, `records`, `materials`, `adaptive-learning`,
`battle`, `teaching`, `self-study`, `communities`, `agent-network`,
`self-tooling`, `instructor`, `school`, `wallet`, `vouchers`, `billing`,
`admin`, `verify`, and others. Shared concerns — model access, billing coins,
circuit breakers, jobs gating, migrations — are `lib/` services, never copied
into modules.

## Diagram

```text
app.js
  |- lib/logTap, lib/outboundMeter        (installed before any client lib)
  |- hardening: helmet, CORS policy, proxy trust (lib/httpHardening.js)
  |- raw-body parsers for webhook paths   (signature checks need raw bytes)
  |- scoped JSON limits (extract 25mb, parse console 12mb, default 2mb)
  |- error-body sanitiser                 (no Postgres/PostgREST text leaks)
  |- rate-limit identity + tiered limiters (middleware/security.js)
  |- module routers (one import per module in modules/)
  |- Socket.io server + Redis adapter     (lib/socketHandlers.js)
  |- boot: config checks -> migrations -> workers -> HTTP listener
```

## Request/event flow

1. Boot order is deliberate: the outbound meter patches global `fetch` before
   any client library is constructed; runtime model settings load from the
   database (`lib/modelRuntime.js`); config preflight checks run; the ordered
   migration manifest is applied; background workers start; only then does
   the HTTP listener open — so no worker can query a table before the deploy
   that creates it has applied.
2. A request passes hardening and CORS (an explicit origin policy shared with
   the socket layer), rate-limit identity is attached by peeking at the
   access token's signature (no database hit), and the owning module's
   router authenticates and authorises.
3. Responses with status ≥ 400 pass through a sanitiser that rewrites any
   backend-ish message (schema, constraint, table or SQL wording) into a
   plain user-facing message.
4. `AKORO_ROUTE_EXPORT=1` makes importing `app.js` pure (no Redis, sockets,
   migrations or listener) so CI can extract the real route table.

## Data and storage

All persistence goes through `db.js` (Supabase PostgREST clients) — see
[Database architecture](database-architecture.md). Files go to R2; the API
issues presigned URLs and stores metadata only.

## Dependencies

Express 4, Socket.io with the Redis adapter, BullMQ/ioredis, the Supabase JS
client, the OpenAI and Anthropic SDKs, AWS S3 SDK (for R2), Zod validation,
express-rate-limit, helmet. Provider SDKs sit behind adapters in
`lib/aiModel.js` and `lib/providers/`.

## Failure modes

- A module worker failing at boot is logged and skipped; the API still
  serves (`lib/startWorkers.js` isolates each worker start).
- Upstream AI failures trip per-provider circuit breakers (`opossum`,
  `lib/circuitBreaker.js`) and the model fallback ladder.
- Redis quota pressure is a designed-for failure: `lib/redisQuotaGuard.js`
  and the jobs gate exist because metered Redis makes idle workers costly.

## Security and permissions

Routers enforce role, ownership and tenant checks server-side; internal
routes require a shared secret compared in constant time. Rate limiters are
tiered (standard / teaching / AI / internal) with env-tunable ceilings and a
single JSON 429 envelope. See [Security architecture](security-architecture.md).

## Invariants

- Module routers are the only HTTP surface; `lib/` code never mounts routes.
- Webhook paths must be raw-body parsed before the global JSON parser, or
  signature validation breaks.
- The error sanitiser is the last line of defence: no error body may carry
  database internals, whatever a route returned.

## Observability

Request logging, a boot banner with the last applied migration, per-route
usage metering (`lib/usageMeter.js`), breaker statistics, and `/health` with
the deployed git SHA.

## Related

- [System overview](system-overview.md)
- [Background workers](background-workers.md)
- [Event-driven architecture](event-driven-architecture.md)
- [API documentation](../02-api/README.md)
