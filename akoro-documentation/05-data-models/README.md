# Data models

Entities, relationships, lifecycle, ownership and database conventions.

Status: Phase 2 in progress. Core entities used by Tier-1/2 workflows are
documented first; this is not a complete catalogue of all 434 tables.

## Core models

- [Learner](learner.md)
- [Record](record.md)
- [Course](course.md)
- [Programme](programme.md)
- [Learning session](learning-session.md)
- [Concept and mastery](concept.md)

## Rules

- Every entity doc follows `_templates/data-model.md`.
- Document owner, readers, writers and tenant isolation.
- Distinguish append-only evidence from derived state.
- Never expose real learner/school data in examples.
- Add tables only after verifying their schema and usage.
