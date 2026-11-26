---
title: Your first change, end to end
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Your first change, end to end

One real change, traced through every layer it touched. The change is the
records **"Share in Discover"** flag (shipped 2026-11-26): Premium learners
may choose to make one of their private uploads discoverable, without making
it public. Small on the surface; it still crossed the database, the API's
permission layer, a second endpoint, the learner app, tests and these docs.
That is the normal shape of an Akoro change — plan for all of it.

Read [Getting started](getting-started.md) first so the API and the learner
app are running locally against the sandbox.

## 0. The shape of the system, in one paragraph

The learner app (`akoro-learner/`, Vite + React) talks to one API
(`akoro-api/`, Node ESM, Express). The API is organised as **modules** under
`akoro-api/modules/<name>/`; each module owns its routes, services, stores
and tests. Data lives in Postgres via Supabase (two schemas matter: `public`
and `edu` — know which one your tables are in before you query). Files live
in private object storage behind presigned URLs. Everything below follows
from that.

## 1. Data first: the migration

Schema changes are dated SQL files in `akoro-api/migrations/`, applied with
the migration runner — never by hand against a live database.

- File: `akoro-api/migrations/2026-record-discoverable.sql` — adds
  `records.discoverable boolean` (default false).
- Apply locally / on sandbox: `npm run db:migrate`
  (`scripts/apply-migrations.mjs --group=schema`); demo data is a separate
  group (`db:seed:demo`).
- Rule the change obeyed: the new flag **never overrides `private`**. A
  discoverable record is still private; the flag only opts it into the
  Discover surfaces. State the invariant in the migration's review, not just
  the code — the next reader starts here.

## 2. The permission layer decides

Access rules for records live in `akoro-api/modules/records/access.js` — the
one place that answers "may this user see this record?". The flag was wired
there, so every consumer (ask paths, Discover feed, platform search,
study-material gathering) inherited the same rule instead of each surface
inventing its own.

Lesson: in this codebase, **permissions are a module-level library, not a
route check**. If your change alters who can see or do something, the edit
belongs in the module's access layer, and routes call it.

## 3. The API surface

The module's anatomy (see `modules/records/`):

| File | Role |
| --- | --- |
| `routes.js` | Express router — HTTP shape, auth, status codes |
| `service-*.js` | Business logic (`service-records.js`, `service-ask.js`, …) |
| `store-*.js` | Data access (`store-records.js`, `store-folders.js`) |
| `access.js` | Permission rules |
| `*.test.mjs`, `*.contract.test.mjs` | Colocated tests, run with `node --test` |

This change added `PATCH /api/records/:id` accepting `{ discoverable:
boolean }` — a non-boolean body is a **400**, a non-owner is a **403**. The
router is mounted in `akoro-api/app.js`:

```js
import recordsModule from "./modules/records/routes.js";
app.use("/api/records", standardLimit, recordsModule);
```

Requests carry the portal header (`X-Akoro-Portal: student`) and a JWT; the
handler resolves the owner from the token, never from the request body.

One more API touch the feature needed: the app had no trustworthy Premium
signal, so `GET /api/profiles/me` learned to return `plan`, resolved from
the caller's active subscription. When the client needs a fact, **the API
states it** — the app never guesses entitlement from local state.

## 4. The learner app

The toggle lives where the record's other sharing actions live: the
**AddToTargetSheet** in the Library, shown only when the server-reported
plan is Premium. It calls the PATCH endpoint and reflects the returned
state. Two standing rules visible here:

- UI state follows the server response; a failed call leaves the toggle
  where it was.
- Anything user-facing ships only after it can be verified in the running
  app — this one was verified on the sandbox before it was called done.

## 5. Tests at every layer you touched

- **Module contract tests** beside the code:
  `modules/records/discoverable.contract.test.mjs` covers the flag's
  behaviour (owner can set it, non-owner 403, non-boolean 400, `private`
  still wins). Run the area suite: `npm run test:extract` is records'
  extraction suite; module suites are named `test:<area>` in
  `akoro-api/package.json` — find yours there, and run `npm run typecheck`
  and `npm run test:structure` before pushing anything.
- **A live smoke beats a pattern test.** This feature was proven with a
  real Premium sandbox account end to end (grant → toggle → Discover
  visibility), which is also how its two schema bugs were caught: the plan
  lookup initially queried the wrong schema and the wrong column, so the
  Premium rule had never fired. Unit tests had not caught either; the live
  probe did. Budget for the probe.

## 6. Docs and changelog, same change

A behaviour change is not finished until:

- the module `README.md` and the relevant feature doc here describe the new
  behaviour (for this change: the records feature doc and the Discover doc);
- `11-changes-releases/` gains a changelog entry;
- the capability registry is updated **if** a capability's status changed
  (it did not here — no new capability, an existing one grew a flag).

## Checklist (copy this)

- [ ] Migration in `akoro-api/migrations/`, invariant stated, applied on sandbox
- [ ] Permission change in the module's access layer, not in routes
- [ ] Route in `routes.js`, logic in `service-*`, data in `store-*`
- [ ] Error contract explicit (400/403/404 cases named)
- [ ] Client reads server-stated facts; no local guessing of entitlement
- [ ] Contract tests colocated and passing; area suite + typecheck + structure green
- [ ] Live sandbox probe with a real account of the right tier
- [ ] Module README, feature doc, changelog updated in the same change

## Related

- [Repository structure](repository-structure.md) — where everything lives
- [Coding standards](coding-standards.md) — how code is written here
- [Testing strategy](testing-strategy.md) — the full test picture
- [Development environment](development-environment.md) — sandbox discipline
