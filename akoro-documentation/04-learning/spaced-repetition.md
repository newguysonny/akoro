---
title: Spaced repetition
status: implemented
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Spaced repetition

## What it means in Akoro

Spaced repetition in Akoro is a confidence-decay system, not a flashcard
queue. Every taught topic carries a confidence value that decays over time;
when it falls far enough, the system raises a review alert, and a completed
review reinforces confidence and pushes the next review out. The exact
rules live in `agents/student/decay-rules.js` (`DECAY_CONFIG`) and
`agents/student/decay-schedule.js`. All numbers below are the code's
current constants, not design targets.

## How intervals and decay are calculated

Decay is **linear**, applied per day since the last review:

```text
decayed = confidence − (baseDecayRate × masteryMultiplier × daysSinceReview)
```

- `baseDecayRate` is **0.10 per day**.
- The mastery multiplier depends on the confidence bucket: 1.00 (0–20%),
  0.85 (21–40%), 0.70 (41–60%), 0.55 (61–80%), 0.40 (81–100%) — higher
  mastery decays more slowly.
- The result is floored at `minConfidence` **0.05** and capped at **0.98**.

Priority is derived from decayed confidence, and priority sets the review
interval used for the next review date (`getNextReviewDate`):

| Priority | Confidence | Review interval |
| --- | --- | --- |
| critical | < 0.35 | 1 day |
| high | < 0.55 | 3 days |
| medium | < 0.72 | 7 days |
| low | ≥ 0.72 | 14 days |

Per-learner concept state carries the same idea as `next_review_due` on
`edu.learner_concept_state`; see the [concept model](../05-data-models/concept.md).

## What learner evidence influences scheduling

- The topic's current confidence/mastery (sets the decay speed and bucket).
- Days since the last review.
- Review outcomes, via fixed reinforcement rates added on a completed
  review: **+0.20** for correct recall, **+0.10** for partial, **+0.02**
  for incorrect ("at least reviewed it").
- Decay Review results: a retention check (3 questions) scoring at or
  above **0.7** is `retained` and completes the review; below that the
  topic is `decayed` and goes through retrieval practice and retest (at
  most 2 retests) before any re-teaching. See
  [Knowledge retention](knowledge-retention.md).

## How it interacts with the rest of the system

- The scheduler only **raises alerts**; a Decay Review is created only by
  the learner's action (tapping Review). Nothing auto-starts a review.
- The `space_out` strategy ("Space it out — schedule a later pass instead
  of pushing on now") lets Study Prep, Decay Review and Practice defer a
  topic into this schedule instead of repeating it immediately.
- The `schedule_plan` strategy builds a dated schedule to the exam, with
  reminders, in Study Prep.

## Deterministic vs AI-decided

Fully deterministic: the decay formula, thresholds, intervals,
reinforcement rates and retained/decayed verdicts are pure functions and
frozen policy constants. The AI has no role in scheduling. The model's only
involvement is inside a review itself (generating and judging recall
questions), never in deciding *when* a review is due.

## Agent authority

The agent may surface due reviews and offer the `space_out` strategy where
permitted. Only the learning engine computes decay, priority, next review
dates and reinforcement. An agent must not invent an interval, promise a
review date the engine has not produced, or mark a topic retained without
a completed review.

## Failure and edge behaviour

- Confidence never decays below 0.05, so a long-abandoned topic stays
  recoverable as `critical` rather than disappearing.
- One open Decay Review per topic: a second tap returns the existing
  review instead of creating a duplicate.

## Related

- [Active recall](active-recall.md)
- [Knowledge retention](knowledge-retention.md)
- [Mastery framework](mastery-framework.md)
- [Concept model](../05-data-models/concept.md)
