---
title: Adaptive learning
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Adaptive learning

## What "adaptive" means in Akoro

Akoro adapts at three concrete levels: **which strategy** is offered for a
learner's current struggle, **which topic** comes next in a plan, and
**when** learned material is resurfaced for review. It does not adapt by
rewriting its own rules: thresholds, caps, intervals and gates are fixed
policy, and adaptation happens inside them. The module that implements
this is `akoro-api/modules/adaptive-learning` — chat, teaching, Study Prep,
exam prep, assessments, decay review and the strategy system.

## Strategy adaptation (the core loop)

When a learner struggles, the difficulty is classified into a struggle type
(the §7.15 taxonomy: `misconception`, `decay`, `retrieval_failure`,
`interference`, `prerequisite_gap`, `overload`, `confidence_collapse`, and
others). The Strategy Library holds the candidate responses per type, and
`strategies/recommend.js` ranks them deterministically:

1. The learner's **own outcomes** with each strategy (worked > untried >
   failed), from recorded strategy-outcome rows.
2. The **anonymous population outcome** for the same struggle type — only
   counted once at least 5 learners contribute (a privacy/statistics floor
   in code).
3. Library order as the final tiebreak.

Exhausted strategies drop out of the ranking entirely: used up to their
per-topic limit, or last judged `did_not_work` on that topic in this
workflow — the system will not repeat a failed strategy indefinitely. If
the outcome reads fail, ranking degrades gracefully to library order
rather than erroring.

## Plan and learner adaptation

- **Replanning.** Study Prep sessions can replan: strategies such as
  `interleave`, `prerequisite_review` (insert the missing prerequisite
  topic first) and `chunk_plan` change the remaining plan through the
  harness, under the same state machine.
- **Learner autonomy and style.** Learner-facing settings (interaction
  style, pace mode — `supported`, `standard`, `accelerated` in the
  teaching evidence model) shape how the agent conducts sessions. They
  never change scoring or gates.
- **Review timing.** Adaptation over time is the decay engine's job:
  review intervals follow measured confidence, not a fixed calendar. See
  [Spaced repetition](spaced-repetition.md).

## Deterministic vs AI-decided

Deterministic: strategy ranking and exhaustion, struggle-type → candidate
mapping, plan-state transitions, all scoring and scheduling. AI-decided:
the initial read of *which* struggle a learner is having (from dialogue
and attempt patterns), plan proposals, explanations, and the final choice
among the engine's ranked, permitted strategies. The harness validates
every AI choice against the library and the state machine before it takes
effect — an unpermitted or disabled strategy is refused with
`strategy_not_permitted`.

## Agent authority

The agent proposes; the engine disposes. Agents may not: invent a strategy
outside the library, reuse an exhausted one, adapt a threshold "for this
learner", or present population outcome data for fewer than 5 learners.
Where a capability is feature-flagged off (Study Prep, exam-prep
confidence loop), the agent reports the gap instead of improvising an
equivalent.

## Failure and edge behaviour

- Strategy outcome recording is versioned (`strategy_version` persisted
  with every use), so a library change does not rewrite history.
- `AKORO_STRATEGIES_DISABLED` removes a strategy from recommendation and
  harness acceptance on the next check, mid-flight sessions included.

## Related

- [Learning engine](learning-engine.md)
- [Learning methodologies](learning-methodologies.md)
- [Mastery framework](mastery-framework.md)
- [Learning and assessment overview](../01-features/learning/overview.md)
- [Learner model](../05-data-models/learner.md)
