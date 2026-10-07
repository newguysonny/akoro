# Database migrations

All schema changes live here as idempotent `.sql` files (`IF NOT EXISTS` /
`DO $$` / `ON CONFLICT`), so every file is safe to re-run. `manifest.json`
defines the order and splits them into two groups:

- **`schema`** — structural migrations + platform-catalog seeds. Prod-safe,
  runs on **every deploy**.
- **`demo`** — sample data (a demo school, demo courses, mgmt sample records).
  Also idempotent, and included in `db:deploy` by default. Set
  `DB_DEPLOY_GROUPS=schema` on any environment that must NOT receive demo
  data (the env var overrides the script's `--group` flag).

`2026-run-all.sql` is a manual copy-paste bundle for the Supabase SQL Editor and
is deliberately **excluded** from the manifest (it duplicates the other files).

## Commands (run from `akoro-api/`)

```bash
npm run db:deploy       # schema + demo seeds (all idempotent; every deploy)
npm run db:migrate      # schema group only
npm run db:seed:demo    # demo/sample data only
node scripts/apply-migrations.mjs --group=schema
node scripts/apply-migrations.mjs --continue-on-error   # log & skip failures
```

Requires a PostgreSQL URI, never the Supabase REST URL. The runner uses
`MIGRATION_DATABASE_URL` when it is set; otherwise it falls back to
`DATABASE_URL` (then legacy `DB_URL`).

- **`DATABASE_URL`** is the normal application PostgreSQL connection and the
  migration fallback. Runtime adaptive chat opens a direct `pg` pool with it.
- **`MIGRATION_DATABASE_URL`** is optional and affects only this migration
  runner. Set it when migration DDL should use a separate direct/session
  connection (often Supabase port `5432`) while runtime `DATABASE_URL` uses a
  transaction pooler (often port `6543`).

Supabase: Settings → Database → Connection string. The runner forces IPv4 and
enables SSL for non-localhost hosts.

## Auto-deploy on the hosting platform

The API server (`npm start`) does **not** run migrations on boot — that avoids
races when multiple instances start together. Instead wire `db:deploy` as the
platform's one-off **pre-deploy / release command** so it runs once per deploy,
before the new server starts:

- **Railway** → service **Settings → Deploy → Pre-deploy Command**:
  `npm run db:deploy`
- **Render** → **Pre-Deploy Command**: `npm run db:deploy`

Set `DATABASE_URL` in that service's variables, plus an optional
`MIGRATION_DATABASE_URL` when deploy-time DDL needs a different connection.
Demo data is opt-in — run `npm run db:seed:demo` by hand against staging when
you want it.

## Adding a migration

1. Add `2026-<name>.sql`, written idempotently.
2. Append its filename to the `schema` (or `demo`) array in `manifest.json`, in
   dependency order.
3. It ships on the next deploy automatically.
