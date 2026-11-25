---
title: Concept and mastery model
status: implemented
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Concept and mastery model

## What it represents

A concept is a learnable idea in the curriculum. The learner's mastery,
retention, misconceptions and review schedule are tracked separately from the
concept definition.

## Identifiers

- `edu.concept_catalog.id` — concept UUID.
- `edu.learner_concept_state` — primary key `(learner_id, concept_id)`.
- `edu.learner_concept_evidence.id` — evidence UUID.

## Fields

`edu.learner_concept_state`:

- `mastery` (0–1)
- `retention` (0–1)
- `evidence_confidence` (0–1)
- `misconception_active`
- `evidence_count`
- `last_evidence_at`
- `next_review_due`
- `state_version`

`edu.learner_concept_evidence` is append-only and records:

- observation kind (`demonstrated_understanding`, `recall_success`,
  `misconception_detected`, `assessment_result`, …);
- response quality;
- claim validity;
- model confidence;
- claim status (`supported`, `contradicted`, `not_checked`);
- evidence summary and source session/turn.

## Relationships

```text
learner -> learner_concept_state -> concept_catalog
        -> learner_concept_evidence -> concept_catalog
        -> concept_edges (prerequisites)
        -> next_review_due
```

## Ownership and access

- Learner-scoped.
- The learning engine writes state/evidence; agents may read through the
  documented capability.
- Teachers/school staff see only aggregated or authorised views.

## Lifecycle

- Evidence is appended; state is recomputed/versioned.
- Mastery and retention decay or update according to the learning engine.
- Review scheduling is server-side.

## Agent guidance

- Never set mastery directly.
- Never infer mastery from a single conversation.
- Never invent evidence or source session ids.
- Use `next_review_due` for review workflows.
- Treat model confidence as separate from demonstrated understanding.

## Related

- [Learner model](learner.md)
- [Learning session model](learning-session.md)
- [Learning methodology](../04-learning/README.md)
