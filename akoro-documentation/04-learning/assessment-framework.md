---
title: Assessment framework
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Assessment framework

## What assessment means in Akoro

Assessment is the engine's evidence-producing layer. Akoro has three
distinct assessment shapes, and they must not be conflated:

1. **Agent Checks** — short generated MCQ checks inside Study Prep
   (diagnostic, retest) and Decay Review (retention check).
2. **Exam-prep confidence runs** — generated exam-style MCQ practice under
   `/api/adaptive/exam-prep` confidence routes.
3. **Proctored practice** — the `practice` workflow: a proctored assessment
   run with identity and integrity signals, pause/resume on disconnect,
   and a scoring → evaluated → completed (or terminated) lifecycle.

## Scoring rules (deterministic)

- Study Prep and exam-prep attempts are scored by **deterministic
  answer-key scoring** in the Education Engine (`scoreAttempt`): submitted
  answer indexes are compared to the stored key. The code is explicit:
  "The LLM never scores anything." An attempt carries at most 10 answers.
- Threshold routing: an attempt passes at a score ≥ the pass threshold —
  **0.7 by default**, policy-overridable — with a fixed attempt budget per
  topic. Failing with attempts left offers intervention and a retest;
  failing with none left is `capped_out`, after which the topic can only be
  deferred or flagged as a gap.
- Decay Review uses its own frozen policy: 3-question checks, `retained`
  at ≥ 0.7, at most 2 retests, at most 3 retrieval rounds.
- A scale guard sits at the learner-model boundary: concept evidence is
  0–1 while some legacy scores are 0–100, and a value presented on the
  wrong scale is refused (null), never silently clamped.

## Evidence rules

- Only scored attempts write mastery evidence, through the deterministic
  write-back in the [mastery framework](mastery-framework.md).
- Proctored practice is stricter: evidence reaches the learner model
  **only for a clean pass/fail**. A terminated run (integrity failure, or
  the reconnect grace expiring) records its outcome but writes no mastery
  evidence.
- Exam-prep runs are an attempt record (questions, answers, score, attempt
  number); the record is kept for the learner, but the *topic* machine —
  not the run — drives Study Prep progression.

## Honesty rules for generated practice

Exam-prep confidence runs create **generated exam-style MCQ practice
only**. They must never be described as a historical WAEC, JAMB or NECO
paper — the route module states this constraint directly. Verified past
questions and generated practice are different evidence classes and are
never mixed in reporting.

## Deterministic vs AI-decided

Deterministic: scoring, thresholds, caps, verdicts, evidence write-back,
proctoring lifecycle. AI-decided: question generation, topic/plan context,
and — in proctored practice turns — the agent's follow-up probing, which is
audit-logged with its picks and judged score but never changes the answer
key.

## Agent authority and failure behaviour

The agent may start checks the state machine allows and explain results.
It may not rescore, override a verdict, extend an attempt budget, or write
evidence for a terminated run. Concrete failures surface as stable codes:
`too_many_answers` (422), `attempt_cap_exceeded` (409),
`teach_back_gate` (409 — a retest attempted before teach-back),
`exam_prep_disabled` (409 when the confidence-loop kill switch is off),
and a 409 on retest without the learner's explicit ready confirmation.

## Related

- [Mastery framework](mastery-framework.md)
- [Active recall](active-recall.md)
- [Teach-back method](teach-back-method.md)
- [Concept model](../05-data-models/concept.md)
