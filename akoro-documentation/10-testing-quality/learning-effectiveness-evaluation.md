---
title: Learning effectiveness evaluation
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Learning effectiveness evaluation

Educational effectiveness asks whether an activity produced meaningful
learning evidence — not whether the screens worked. Akoro's position is
that learning claims must rest on recorded evidence: attempts, timings,
misconceptions, strategy outcomes and review behaviour captured by the
learning engine. This document describes how that evidence is checked
today, and is explicit about the limit of the current system: the
verification gate proves the evidence machinery works; it does not by
itself prove that learners learn more, which is a product-research
question beyond automated evaluation.

## Evidence the platform records

- **Learning events** — attempts, answers, timings and outcomes across
  practice, Study Prep, teaching sessions and assessments.
- **Misconceptions and struggles** — captured when a learner's answers
  reveal a specific misunderstanding, and recorded for instructors and
  schools in scoped views.
- **Strategy outcomes** — which recommended strategy a learner used and
  what happened next, so recommendations can be judged by results.
- **Mastery and review state** — concept mastery derived from evidence,
  plus decay/review scheduling that brings concepts back before they are
  forgotten.
- **Learner model** — a next-action view computed from the evidence above.

## How the machinery is evaluated

The verification gate carries dedicated scenario areas:

| Area | Scenario files | What they assert |
| --- | --- | --- |
| Event integrity | `learningEvents.js` | Events are recorded completely and idempotently; backfills do not duplicate |
| Signal quality | `learningSignals.js`, `learnerModel.js` | Misconceptions and struggle signals are captured; the learner model's next action follows from the evidence |
| Strategy loop | (learning strategy cases in the registry) | A recommended strategy is offered at the right moment and its outcome is recorded, including struggle → breakthrough sequences |
| Review scheduling | `decay.js`, `decayReview.js` | Decay is computed, reviews surface when due, and completed reviews update the schedule |
| Teaching outcomes | `teaching*.js`, `studyprep*.js` | Teaching runs progress toward mastery only on demonstrated performance; Study Prep plans respect budgets and exit cleanly |
| Grading truth | `grading.js`, `practice.js` | Scores written back to mastery come from the attempt itself — no invented or inflated evidence |

## Evaluation rules

1. **No evidence, no claim.** A concept is never reported as mastered, a
   score never reported, and a strategy never called effective without
   the underlying records. Agents and reports alike follow this rule.
2. **Generated practice is not verified assessment.** Effectiveness
   measures keep verified questions and generated practice distinct;
   mixing them invalidates the measure.
3. **Effectiveness is read in aggregate and over time.** A single
   session's success is an anecdote. Owners reviewing effectiveness look
   at cohort-level strategy outcomes, review completion and mastery
   retention — using anonymised aggregates, per
   [Privacy policy](../09-security-governance/privacy-policy.md).
4. **Machinery first, outcomes second.** Until the evidence machinery is
   proven by the scenarios above, outcome claims are premature. The
   current evaluation programme therefore concentrates on machinery
   correctness; formal learning-outcome studies are a product decision
   that has not been scheduled.

## Known limitations

- Automated scenarios verify recording and computation, not pedagogy:
  whether a teaching sequence is *well designed* is reviewed by humans
  using the recorded evidence.
- Sandbox demo cohorts are synthetic; their outcomes say nothing about
  real learners.

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Agent evaluation](agent-evaluation.md)
- [Feature test cases](feature-test-cases.md)
- [Learner data protection](../09-security-governance/learner-data-protection.md)
