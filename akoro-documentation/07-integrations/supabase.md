---
title: Supabase
status: implemented
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Supabase

## Purpose

Supabase hosts Akoro's Postgres database, and the API's primary data client
is the Supabase JavaScript client. `akoro-api/db.js` — the module the whole
API imports for data access — builds a `@supabase/supabase-js` client from
the project URL and the service key, and modules query through its
PostgREST-style interface (`db.from(<table>)...`). Application data lives in
Postgres schemas (`public`, `edu`, `mgmt`) behind that client.

Supabase is the data plane, not the application platform: Akoro does not use
Supabase Auth (authentication is Akoro's own JWT system), Supabase Storage
(files live in R2 — see [Storage providers](storage-providers.md)), or
Supabase Edge Functions.

## Configuration surface (names only)

| Variable | Role |
| --- | --- |
| `SUPABASE_URL` | Project URL for the API's data client |
| `SUPABASE_SERVICE_KEY` | Service-role key the API connects with |
| `DATABASE_URL` | Direct Postgres connection string |
| `MIGRATION_DATABASE_URL` | Connection string the boot migration runner uses |
| `DB_READ_URL` | Optional read-replica project URL; when it differs from `SUPABASE_URL`, a second read client is built |
| `DB_POOL_MAX`, `DB_POOL_IDLE_MS`, `DB_POOL_CONNECT_MS` | Pool bounds for direct connections |

The service key never leaves the server. The Supabase project reference is
visible in the web client bundle; that is expected and is not a credential.

## Dependencies

- `@supabase/supabase-js` — primary data client (metered so outbound usage is
  accounted per instance).
- `pg` — direct Postgres connections, used by the migration runner: at boot
  the API applies pending migrations over `MIGRATION_DATABASE_URL` /
  `DATABASE_URL`, waiting a bounded time before opening its port so a slow
  database cannot fail the deploy.

## Failure handling

- **Fail fast at boot.** If `SUPABASE_URL` or `SUPABASE_SERVICE_KEY` is
  missing, the API logs the missing configuration and exits; app startup
  asserts the config. A running API therefore always has a data client.
- **Health.** `/health` reports `database: ok | error` from a live check.
- **Read scaling.** The optional read client is used only when `DB_READ_URL`
  is configured and differs from the primary URL; otherwise reads and writes
  share the primary client.
- **No silent fallback.** There is no second database provider behind
  Supabase. A database outage is an outage; background queues pause rather
  than writing elsewhere.

## Data shared and privacy impact

All application data transits this integration: accounts, learning records,
library metadata, payments state. Because the API connects with the
service-role key, row-level security is **not** the enforcement layer —
ownership, portal scoping and tenant isolation are enforced in Akoro's own
backend code on every query path. Any change that lets a client talk to
Supabase directly with the service key would break that model and is
prohibited.

## Related

- [Storage providers](storage-providers.md)
- [Payments overview](../01-features/payments/overview.md)
- [Agent permissions](../06-agents/agent-permissions.md)
