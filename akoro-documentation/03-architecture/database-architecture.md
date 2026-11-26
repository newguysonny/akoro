---
title: Database architecture
status: implemented
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Database architecture

## Purpose

Postgres, hosted on Supabase, is the system of record for every portal. The
API reaches it through PostgREST using the Supabase JS client (`db.js`) —
there is no ORM and no direct SQL on the request path; SQL exists as the
migration files that shape the database.

## Boundaries

The database is divided into schemas by domain:

| Schema | Owns |
| --- | --- |
| `public` | Users, accounts, core platform tables |
| `edu` | Learning data: records, sessions, concept state and evidence, agent tools, agent memory, embedding cache |
| `content` | Marketing/public-site content (blog, careers), isolated from core app tables |
| `mgmt` | School ERP/management data |

Entity-level detail lives in [05-data-models](../05-data-models/learner.md);
this page covers how the database is accessed, changed and protected.

## Diagram

```text
akoro-api modules
      |
   db.js  (lazy, metered Supabase clients)
      |-- db        primary client (read + write), schema "public" default
      |-- readDb    read-replica client when DB_READ_URL is set,
      |             otherwise the primary
      |-- contentDb the "content" schema view of the primary
      v
PostgREST  ->  Postgres (schemas: public, edu, content, mgmt)
      ^
scripts/apply-migrations.mjs + boot-time applyMigrations()
      (ordered manifest: akoro-api/migrations/manifest.json)
```

## Request/event flow

1. Every `from`/`rpc`/`schema` call on a client is counted by a usage meter
   (`countQuery`), so PostgREST command volume is observable per route —
   the platform's quota is per-command, and the meter exists to keep it
   visible.
2. Clients are built lazily: importing `db.js` never exits the process, so
   tests can substitute fakes; the server asserts real configuration at
   boot and fails fast there instead.
3. Each client tags its requests with an instance header
   (`x-akoro-instance`), so database-side logs can attribute load.

## Data and storage

- Migrations are plain SQL files under `akoro-api/migrations/`, applied in
  the order listed in `manifest.json`. The manifest's `schema` group runs
  on every deploy and is idempotent — it also carries the platform-catalog
  seeds and the demo/tester cohort seeds, by explicit product decision.
  The `demo` group is opt-in sample data and must never run against
  production.
- Boot applies migrations before workers start and before the listener
  opens (see [Backend architecture](backend-architecture.md)).
- Files are not stored in Postgres: uploads and video live in R2, and the
  database stores their metadata and ownership.

## Dependencies

Supabase (Postgres + PostgREST), the `pg` driver for tooling, and the
migration runner `scripts/apply-migrations.mjs` (`db:migrate`,
`db:deploy`).

## Failure modes

- `checkDb()` backs `/health`: a one-row probe on the users table.
- A missing `SUPABASE_URL` or service key is a boot failure, not a runtime
  surprise.
- Read-replica absence is not a failure: `readDb` silently falls back to
  the primary when `DB_READ_URL` is unset or identical.

## Security and permissions

The API connects with the service key, so PostgREST row-level policies are
not the enforcement layer — the API is. Every module checks role, ownership
and tenant scope in code before querying, and error responses are sanitised
so schema and table names never reach a client. See
[Security architecture](security-architecture.md).

## Invariants

- A stored spec or row can never widen access beyond what code allows; for
  example, database-registered Data Views for learner-built tools are
  additions only and can never shadow a built-in view.
- Migrations in the `schema` group must stay idempotent: they re-run on
  every deploy.
- Learner-owned data is owner-scoped at query time (see the
  [learner model](../05-data-models/learner.md)).

## Observability

Per-route PostgREST command counts (usage meter), the boot log's last
applied migration line, and `/health`'s database probe.

## Related

- [Backend architecture](backend-architecture.md)
- [Caching strategy](caching-strategy.md)
- [Learner model](../05-data-models/learner.md)
- [Concept model](../05-data-models/concept.md)
