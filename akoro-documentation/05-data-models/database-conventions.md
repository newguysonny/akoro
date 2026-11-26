---
title: Database conventions
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Database conventions

Conventions observed across the migrations in `akoro-api/migrations/`.
New schema work should follow them; where older tables differ, the
difference is historical, not a second standard.

## Naming

- Tables and columns are `snake_case`. New learning tables are
  schema-qualified (`edu.…`); school ERP tables are `mgmt.…`; the original
  platform tables are unqualified in `public`.
- Foreign keys are named after the referenced entity: `learner_id`,
  `school_id`, `concept_id`, `student_agent_id`.
- Timestamps are `created_at` / `updated_at` (`timestamptz`, default
  `now()`); domain times say what they are (`last_evidence_at`,
  `next_review_due`, `completed_at`).

## Keys and constraints

- Primary keys are UUIDs with `DEFAULT gen_random_uuid()`, except a few
  text-keyed runtime tables (for example `edu.agent_episodes.id`).
- Composite primary keys are used for pure join/state tables, for example
  `edu.learner_concept_state (learner_id, concept_id)`.
- Enums are `TEXT` plus a `CHECK` constraint listing the allowed values —
  not Postgres enum types — so values can evolve by migration.
- Natural uniqueness is declared: `UNIQUE (school_id, admission_no)` on
  `mgmt.students`, `UNIQUE (curriculum_key, code)` on
  `edu.concept_catalog`, `UNIQUE (capability_jti, idempotency_key)` on
  `edu.agent_tool_invocations`.
- Bounded text uses `CHECK (char_length(…) BETWEEN …)` (evidence summaries,
  memory content, catalog fields) rather than relying on callers.
- Deletes cascade from the owner (`ON DELETE CASCADE` from
  `public.users` / `public.school_profiles`) and use `ON DELETE SET NULL`
  where the child record must survive (for example a student's class).

## Migrations

- One SQL file per change in `akoro-api/migrations/`, named
  `2026-<slug>.sql`.
- Migrations are additive and idempotent: `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, constraints dropped and re-added by name.
  They are re-run on deploy, so a migration must be a no-op once applied
  and must never blanket-update existing rows to a new default.
- Migrations that add columns used through PostgREST end with
  `NOTIFY pgrst, 'reload schema'`.
- Defaults are chosen so pre-existing rows stay valid (for example
  `school_profiles.verification_status` defaulted to `verified` when the
  pending-verification gate was introduced).

## Types and payloads

- JSONB for UI- or workflow-owned shapes (`block_history`, `plan`,
  `actions`, `provenance`, proctoring signals); typed columns for anything
  queried, constrained or joined.
- `text[]` for small tag/subject lists.
- `vector(1536)` for embeddings on knowledge/chunk tables.
- Scores are numeric with range checks (`response_quality` 0–1 on
  evidence; `assessment_score` 0–100 on assessment sessions).
- Money and salaries are `numeric`, never float.

## Isolation

- Every `mgmt` table carries `school_id`; every learner-owned `edu` table
  carries the owner id. A query without the scope column is a bug.
- Append-only tables (evidence, events) have no update path in normal
  operation; derived state is recomputed, not patched.

## Related

- [Data architecture](data-architecture.md)
- [Entity relationships](entity-relationships.md)
