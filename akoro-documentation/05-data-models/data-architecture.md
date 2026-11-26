---
title: Data architecture
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Data architecture

How Akoro's data is organised: one PostgreSQL database, three schemas,
schema changes delivered as idempotent SQL migrations, and binary content in
object storage referenced by key.

## Schemas

| Schema | Holds | Examples |
| --- | --- | --- |
| `public` | Identity and the original platform tables | `users`, `courses`, `enrollments`, `school_profiles`, `school_teachers`, `chat_sessions` |
| `edu` | Learning, library, agent and self-tooling data | `records`, `concept_catalog`, `learner_concept_state`, `assessment_sessions`, `agent_tools` |
| `mgmt` | The school ERP, every table scoped by `school_id` | `students`, `staff`, `classes`, `fee_payments`, `exam_marks` |

The base schema predates the schema split: early tables (`users`, `courses`,
`battles`, `tasks`, …) are unqualified and live in `public`, while the same
migration file also creates the first `edu` tables. New learning data goes
in `edu`; new school-ERP data goes in `mgmt`. This catalogue documents the
core entities, not all tables (the Phase 0 audit counted 434).

## Migrations

- Schema changes are SQL files in `akoro-api/migrations/`, named
  `2026-<slug>.sql` (348 files at the time of writing).
- Migrations are additive and idempotent — `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, check constraints replaced by name — because
  they are re-run on deploy and must be no-ops once applied.
- Migrations typically end with `NOTIFY pgrst, 'reload schema'` so the
  PostgREST layer picks up new columns.

## Data kinds

- **Source data** — what users create: records, courses, school registers.
- **Append-only evidence** — [learner concept evidence](evidence.md) and
  workflow/session events; never edited in place.
- **Derived state** — recomputed from evidence: learner concept state,
  knowledge confidence, agent knowledge scores.
- **Flexible payloads** — JSONB where the shape is UI- or workflow-owned:
  session `block_history`, Study Prep `plan`, agent tool `actions`.
- **Embeddings** — `vector(1536)` columns on knowledge and chunk tables
  (`edu.agent_knowledge`, `edu.student_knowledge`, `edu.record_chunks`)
  power semantic retrieval.
- **Binary content** — files, previews and video live in object storage;
  the database stores keys (`file_key`, `preview_key`), never bytes.

## Isolation

- Learner data is owner-scoped by user id.
- School ERP data is tenant-scoped: every `mgmt` table carries `school_id`
  referencing `public.school_profiles(id)`.
- Platform-wide reference data (concept catalog, curriculum) is shared
  read-mostly data owned by the platform.

## Related

- [Entity relationships](entity-relationships.md)
- [Database conventions](database-conventions.md)
- [Platform architecture](../00-platform/platform-architecture.md)
