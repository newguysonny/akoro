---
title: Naming conventions
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Naming conventions

The naming patterns that are visible and consistent in the codebase today.
This page codifies observed practice; where a name is locked by a plan or a
registry, that source is named. When a new name conflicts with this page,
follow the code and update the page.

## Files and modules

- API modules live in `akoro-api/modules/<domain>/` with kebab-case directory
  names that match the domain vocabulary: `adaptive-learning`,
  `agent-network`, `agent-tool-requests`, `self-study`, `self-tooling`,
  `learner-goals`, `past-questions`. A module is entered through its
  `index.js` only.
- Tests are siblings of the code they cover: `<name>.test.mjs` for unit tests
  and `<name>.contract.test.mjs` for contract tests (for example
  `chat-trace.contract.test.mjs`, `structure.contract.test.mjs`). Frontend
  unit tests follow the same suffix pattern inside `src/`
  (`<name>.test.mjs`, `<name>.contract.test.mjs`).
- Migrations are SQL files in `akoro-api/migrations/` named
  `2026-<topic>.sql` (for example `2026-base-schema.sql`,
  `2026-migration-log.sql`) and must be listed in
  `akoro-api/migrations/manifest.json` to apply.
- Documentation files are kebab-case Markdown; feature documentation uses an
  `overview.md` per feature directory under `01-features/`.

## Environment variables and flags

- All configuration is `UPPER_SNAKE_CASE`. Akoro feature flags and platform
  knobs carry the `AKORO_` prefix: `AKORO_STUDY_PREP_ENABLED`,
  `AKORO_BACKGROUND_JOBS_ENABLED`, `AKORO_AUTONOMY_CYCLE_EVERY`.
- Feature flags follow the kill-switch convention: absent means enabled for
  default-on slices, and `=false` disables. Names say what they gate
  (`AKORO_EXAM_PREP_CONFIDENCE_ENABLED`), never a ticket number or a date.
- Secrets are named for the service and the credential, never for the
  environment: `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_KEY`,
  `OPENAI_API_KEY`. See [Environment variables](environment-variables.md).

## Learning vocabulary (locked)

The Grand Plan (`reference/Grand Plan.md` §3) locks the learning vocabulary —
use these terms in code, comments, events, tests and docs: the four durable
workflows are **Study Prep**, **Teaching**, **Decay Review** and **Practice**;
the deciding layers are the **agent** (proposes), the **harness** (allows and
performs), the **Education Engine** (scores and records evidence) and the
**Context Manager** (selects what the model sees). Do not invent synonyms
("tutor session", "quiz mode") for locked terms.

## Statuses and identifiers

- Capability and feature status uses exactly the vocabulary in
  [README](../README.md): `implemented`, `beta`, `planned`, `deprecated`,
  `disabled`; document status uses `draft`, `overview`, `complete`.
- Capability IDs in `capability-registry.yaml` are dotted and grouped by
  category (for example `learning.study_prep`, `payments.wallet`).
- HTTP routes are grouped by module under `/api/...`; internal-only routes
  live under `/api/internal/...` and are never called from public clients.

## Branches and commits

- The deploy branch is `kilo/modular-storm-thz`. Work lands there by commit
  and push; pushing is what deploys (see [Deployment guide](deployment-guide.md)).
- Commit messages in this project are short and descriptive, and fix commits
  conventionally reference the change they complete. When a commit is the
  receipt for a shipped fix, cite its short SHA in the report back — receipts
  are how this team verifies claims.
