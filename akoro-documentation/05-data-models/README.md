# Data models

Entities, relationships, lifecycle, ownership and database conventions.

Status: Phase 2 in progress. Core entities used by Tier-1/2 workflows are
documented first; this is not a complete catalogue of all 434 tables.
Teacher, school, agent, assessment, evidence and memory models were added
from the migrations in `akoro-api/migrations/`; field lists name only what
those migrations create.

## Architecture

- [Data architecture](data-architecture.md)
- [Entity relationships](entity-relationships.md)
- [Database conventions](database-conventions.md)

## Core models

- [Learner](learner.md)
- [Teacher](teacher.md)
- [School](school.md)
- [Agent](agent.md)
- [Record](record.md)
- [Course](course.md)
- [Programme](programme.md)
- [Learning session](learning-session.md)
- [Concept and mastery](concept.md)
- [Assessment](assessment.md)
- [Evidence](evidence.md)
- [Memory](memory.md)

## Rules

- Every entity doc follows `_templates/data-model.md`.
- Document owner, readers, writers and tenant isolation.
- Distinguish append-only evidence from derived state.
- Never expose real learner/school data in examples.
- Add tables only after verifying their schema and usage.
