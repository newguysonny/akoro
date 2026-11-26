---
title: Evidence model
status: implemented
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Evidence model

## What it represents

Evidence is a recorded signal that a learner did or did not demonstrate
understanding of a concept. The canonical store is
`edu.learner_concept_evidence`: append-only rows written by the learning
engine from session activity and assessment results. Derived mastery lives
separately in `edu.learner_concept_state` (see
[Concept and mastery model](concept.md)).

A second, narrower evidence store exists for teaching sessions:
`edu.adaptive_sessions.teaching_evidence` (JSONB) holds compact,
server-derived numeric/category teaching evidence and temporary pace state.
It deliberately stores no message text, no model rationale and no duplicate
transcript — the canonical conversation stays in the session's
`block_history`.

## Identifier

- `edu.learner_concept_evidence.id` — UUID.
- Unique per `(learner_id, source_session_id, source_turn_id, concept_id)`:
  one evidence row per concept per turn.

## Important fields

`edu.learner_concept_evidence` includes `learner_id`, `concept_id`,
`source_session_id`, `source_turn_id`, `observation_kind`,
`response_quality` (0–1), `claim_validity` (0–1), `model_confidence` (0–1),
`claim_status` (`supported|contradicted|not_checked`), `evidence_summary`
(bounded text), `provenance` (JSONB), `observed_at`, `created_at`.

`observation_kind` is one of: `demonstrated_understanding`,
`partial_understanding`, `recall_success`, `recall_gap`,
`misconception_detected`, `misconception_cleared`, `assessment_result`.

## Relationships

```text
learner -> session/turn -> edu.learner_concept_evidence -> edu.concept_catalog
                        -> edu.learner_concept_state (recomputed from evidence)
assessment session -> assessment_result evidence
teaching session -> adaptive_sessions.teaching_evidence (compact, per session)
```

## Ownership and access

- Owner: the learner the evidence describes.
- Readers: the learner; authorised instructors and school staff see only
  aggregated or authorised views.
- Writers: the learning engine / Education Engine only. Agents never write
  evidence directly.
- Learner-scoped; no cross-learner reads.

## Lifecycle

- Evidence is append-only: rows are never edited or deleted in normal
  operation.
- State is recomputed and versioned from evidence; misconceptions are
  raised (`misconception_detected`) and later cleared
  (`misconception_cleared`) by further evidence, not by editing history.

## Agent guidance

- Never invent evidence, summaries or source session/turn ids.
- Never present model confidence as demonstrated understanding; they are
  separate fields for a reason.
- Never mark a concept mastered; cite the evidence and let the engine
  decide.
- If no evidence exists for a concept, say so rather than inferring from
  conversation tone.

## Related

- [Concept and mastery model](concept.md)
- [Assessment model](assessment.md)
- [Learner model](learner.md)
- [Learning session model](learning-session.md)
