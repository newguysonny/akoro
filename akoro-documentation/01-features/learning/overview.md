---
title: Learning and assessment overview
status: beta
doc_status: overview
tier: 2
audience: [learner, product, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# Learning and assessment overview

## What it covers

The learner learning surface: Study Prep, teaching sessions, exam prep, practice,
assessments, concept state, memory and review scheduling.

## Observed surfaces

- `adaptive-learning`: 107 route declarations across chat, teaching, Study Prep,
  exam prep, assessments, decay review and marketplace.
- Study Prep REST surface under `/api/adaptive/study-prep`.
- Assessment sessions and question banks in the adaptive/assessment modules.
- Learner concept state and evidence in `edu.learner_concept_state` and
  `edu.learner_concept_evidence`.
- Learner memory in `edu.learner_agent_memories` and related agent tables.

## Primary flows

1. Learner starts Study Prep with a goal, subject and exam board.
2. Agent proposes a topic plan; learner confirms or adjusts.
3. Learner practices a topic; the engine scores the attempt.
4. Teach-back/confirmation gates are satisfied where required.
5. Concept evidence updates mastery, retention and next review.
6. The engine chooses the next eligible transition.

## Status

Implemented but broad; treat as **beta** for public documentation. Several
surfaces are feature-flagged (`AKORO_STUDY_PREP_ENABLED`, agent autonomy
settings) and some media states are still partial.

## Permissions

- Learner-scoped sessions and evidence.
- Teachers/school staff see only authorised or aggregate views.
- Agents may read through documented capabilities; the learning engine owns
  mastery and transitions.

## Data

See [learning session](../../05-data-models/learning-session.md) and
[concept](../../05-data-models/concept.md).

## Documentation gaps

- Study Prep strategy/methodology docs.
- Assessment lifecycle and grading rules.
- Exam prep vs Study Prep boundaries.
- Concept evidence policy for each observation kind.
- Teacher-facing learning analytics.

## Related

- [Study Prep workflow](../../13-examples/workflows/study-prep.md)
- [Learning session model](../../05-data-models/learning-session.md)
- [Concept model](../../05-data-models/concept.md)
- [Phase 0 audit](../../../docs/audits/phase-0-documentation-audit.md)
