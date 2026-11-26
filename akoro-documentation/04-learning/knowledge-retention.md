---
title: Knowledge retention
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Knowledge retention

## What retention means in Akoro

Retention is tracked separately from mastery. Mastery says how well a
learner demonstrated a concept when assessed; retention says how much of
it is likely still there now. Per-concept state carries both as distinct
0–1 fields (`mastery`, `retention`) on `edu.learner_concept_state`, and
the agent-side decay engine tracks topic confidence on the same principle
for the learner's protégé: what the agent was taught fades unless it is
reviewed. See the [concept model](../05-data-models/concept.md).

## The forgetting model as implemented

Akoro's forgetting curve is the decay engine's linear model, documented in
full in [Spaced repetition](spaced-repetition.md): confidence falls by
10% per day at base rate, slowed by a mastery multiplier (down to 0.40× at
the highest bucket), floored at 0.05 and capped at 0.98. It is a product
rule, not a fitted psychological curve — no per-learner curve fitting or
exponential half-life model exists in the code, and documentation must not
imply one.

## How retention is measured: Decay Review

Retention is *measured*, not just modelled, by the Decay Review workflow
(`decay-review/`):

1. **Inspect** — the topic's concepts are read off the forgetting curve:
   current confidence, faded concepts, days since review.
2. **Diagnostic** — a 3-question retention check (an Agent Check in
   `retention_check` mode) asks what is still remembered.
3. **Verdict** — code decides: score ≥ 0.7 is `retained` (review completes,
   confidence reinforced, alert resolved); below is `decayed`.
4. **Repair** — decayed topics go through retrieval practice (≤ 3 recall
   rounds with a hint ladder), then a retest. A passed retest completes
   the review as retained; a failed one escalates to re-teaching via
   teach-back, then one final retest. At most 2 retests; a review can end
   completed-but-not-retained.
5. **Recording** — the finished review records per-concept outcomes and a
   retention before/after pair. A concept the review never reached gets
   no outcome — in the code's words, "it keeps fading."

Reinforcement on review follows the fixed rates in the decay rules:
+0.20 correct, +0.10 partial, +0.02 incorrect.

## Deterministic vs AI-decided

The decay computation, verdicts, caps and recorded outcomes are
deterministic. Inside a review, recall questions are model-generated and
free-text recall answers are model-judged (assessor role); the retention
*check* itself is a scored Agent Check. The scheduler's role is limited to
raising alerts — a review starts only when the learner taps Review.

## Agent authority

The agent may explain why a topic is fading (using the engine's figures:
confidence, days since review, faded concepts) and conduct the review's
dialogue steps. Only the engine decides retained vs decayed, applies
reinforcement, or closes an alert. An agent must not reassure a learner
that material is "still remembered" without a retention check, nor quote
a retention figure it did not read from engine state.

## Failure and edge behaviour

- A review interrupted mid-step is resumed, not duplicated (one open
  review per topic; a stalled "inspecting" step is re-diagnosed on the
  next tap).
- If no recall question can be generated, the review skips straight to
  the retest rather than blocking.

## Related

- [Spaced repetition](spaced-repetition.md)
- [Active recall](active-recall.md)
- [Mastery framework](mastery-framework.md)
- [Learning session model](../05-data-models/learning-session.md)
