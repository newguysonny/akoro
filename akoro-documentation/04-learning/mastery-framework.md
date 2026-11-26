---
title: Mastery framework
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Mastery framework

## What mastery means in Akoro

Mastery is a stored, evidence-backed number per learner and concept — not
a judgement an agent makes in conversation. It lives in
`edu.learner_concept_state` (one row per learner/concept) as three separate
0–1 values: `mastery`, `retention`, and `evidence_confidence`, plus
`evidence_count`, `last_evidence_at`, `next_review_due`, a
`misconception_active` flag and a `state_version`. The full field list is
in the [concept model](../05-data-models/concept.md).

## Evidence

Every change to mastery is justified by an append-only row in
`edu.learner_concept_evidence`: observation kind (for example
`demonstrated_understanding`, `recall_success`, `misconception_detected`,
`assessment_result`), response quality, claim validity, model confidence,
claim status (`supported`, `contradicted`, `not_checked`) and the source
session/turn. Model confidence is recorded separately from demonstrated
understanding — a confident model is not evidence a learner understands.

Teaching sessions keep a parallel compact evidence model (policy
`teaching-evidence-v1`) scoring explanation quality per concept with
status `introduced → developing → verified`; see
[Teach-back method](teach-back-method.md).

## How mastery is updated (deterministic)

Mastery write-back is a pure function in the Education Engine
(`masteryWriteBack`) — "Never an LLM judgement":

- **First evidence** (no prior mastery): the attempt itself is the
  evidence. A passed attempt sets mastery to at least 0.7
  (`max(observed score, 0.7)`); a failed attempt sets it to the observed
  score.
- **Subsequent evidence:** an exponential-style blend in which fresh
  evidence outweighs stale state. The weight is
  `min(0.6, 0.35 + 0.1 × (attemptsUsed − 1))`, so repeated retrieval
  attempts move mastery faster; the result is bounded to [0, 1] and
  rounded to 4 decimal places.
- **Scale guard:** inputs must declare their scale (unit 0–1 or percent
  0–100). A 0–100 value passed as 0–1 is refused, not clamped — a wrong
  scale produces no evidence rather than wrong evidence.

At topic level, "mastered for now" is the Study Prep state `understood`,
reached only by passing a scored check at the threshold (0.7 by default);
in teaching sessions, MASTERY requires every concept verified by the
progression gate. Neither is reachable by conversation alone.

## Deterministic vs AI-decided

Mastery computation, evidence recording and state versioning are entirely
deterministic and engine-owned. AI contributes observations (for example
teaching-dialogue quality scores and recall verdicts in Decay Review) that
become *inputs* to evidence — the engine decides what they change.

## Agent authority

Per the concept model, agents must never: set mastery directly, infer
mastery from a single conversation, invent evidence or source session ids,
or treat `next_review_due` as advisory. Agents read concept state through
the documented capability and let the engine write it. Teachers and school
staff see only aggregated or authorised views.

## Failure and edge behaviour

- A proctored run that terminates writes no mastery evidence at all.
- An active misconception flag keeps a teaching concept below `verified`
  until a correction is observed.
- Retention decays independently of mastery; a high-mastery concept can
  still become due for review. See [Knowledge retention](knowledge-retention.md).

## Related

- [Concept model](../05-data-models/concept.md)
- [Knowledge retention](knowledge-retention.md)
- [Assessment framework](assessment-framework.md)
- [Learner model](../05-data-models/learner.md)
