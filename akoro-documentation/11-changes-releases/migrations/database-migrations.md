---
title: Database migrations
status: implemented
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Database migrations

Akoro's API applies its database schema from an ordered, checked-in
manifest at deploy/boot time. This page documents that discipline so schema
changes are made the way the system actually runs them.

## The manifest is the contract

- Migrations live in `akoro-api/migrations/` as dated SQL files
  (`2026-<name>.sql`).
- `akoro-api/migrations/manifest.json` lists them in order, in groups. Only
  files listed in the manifest are applied by
  `scripts/apply-migrations.mjs`; an unlisted SQL file in the folder does
  nothing at deploy time.
- The **`schema`** group runs on every deploy. It contains the structural
  migrations and the platform-catalogue seeds, and **every file in it must
  be idempotent** — safe to run repeatedly against a database that already
  has the schema. This is why the group can self-apply at boot on both the
  sandbox and production services.
- The **`demo`** group is opt-in sample data. It must never run against
  production.
- `2026-run-all.sql` is intentionally **excluded** from the manifest: it is
  a manual copy-paste bundle that duplicates the listed files.

Commands (from `akoro-api/package.json`):

```bash
npm run db:migrate     # schema group only
npm run db:seed:demo   # demo group (never on production)
npm run db:deploy      # all groups
```

## How to add a schema change

1. Write a new dated SQL file; do not edit a migration that has already
   shipped — its file may be re-run, but edits change history on databases
   that logged the original. Add a follow-up file instead.
2. Make it idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
   EXISTS`, guarded seeds, and upserts for catalogue rows.
3. Add the filename to the manifest's `schema` list, in the position it
   must run (order matters — later files may depend on earlier tables and
   columns).
4. Apply it to the sandbox first and verify behaviour there; migrations
   self-apply at boot, so a bad file breaks the deploy, not just a script
   run.
5. Record user-visible effects in the [changelog](../CHANGELOG.md).

## Seeds inside the schema group

By explicit product decision, the schema group also boot-seeds the demo
cohorts the agent console tests against: the demo school seed and the
agent-tester cohort seed (tester accounts with demo data) refresh their
time-relative rows on every run. Treat changes to those seeds as product
changes, not test fixtures — they run in production too.

## Rollback reality

There is no automated down-migration system. Rollback means a new,
compensating migration file added to the manifest, written and reviewed
like any other change. Destructive changes (dropping columns or tables)
therefore need a two-step plan: first a release that stops reading/writing
the column, then a later migration that drops it — with the gap recorded in
[deprecations](../deprecations.md) if any consumer is affected.

## Data-driven registries

Some platform behaviour is data, not schema: for example the self-tooling
Data View registry stores view specs in a database table created by its own
manifest migration, and specs are activated through the registry's
validation gate at runtime. Registering a view is an admin act through the
API, not a migration; schema changes to the registry table itself follow
the rules above.

## Related

- [Changelog](../CHANGELOG.md)
- [API migrations](api-migrations.md)
- [Breaking changes](../breaking-changes.md)
