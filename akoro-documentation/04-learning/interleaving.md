---
title: Interleaving
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Interleaving

## What it means in Akoro

Interleaving — mixing practice across related topics so neighbouring ideas
are told apart — exists in Akoro as **one named strategy**, not as a
general sequencing algorithm. Study plans are otherwise topic-by-topic:
the Study Prep topic machine works one active topic at a time, and nothing
in the planner shuffles or rotates topics by default.

## How the engine implements it

The Strategy Library entry `interleave` (v1):

- **Summary (from the library):** "Mix this topic's practice with a related
  topic so neighbouring ideas are told apart."
- **Targets:** the `interference` and `context_dependence` struggle types —
  i.e. it is offered when the learner's difficulty is specifically
  confusion between similar ideas, not as a default practice shape.
- **Workflows:** Study Prep and Practice only.
- **Executor:** the workflow harness, as a `replan` operation — choosing it
  changes the plan so the two topics' practice is mixed, rather than
  starting a teaching session.
- **Success criterion:** "both topics pass on a mixed Agent Check" — the
  verification is itself interleaved: a combined check over both topics.
- **Limits:** the library default of at most 2 uses per topic applies.

A neighbouring strategy, `contrast_pairs`, covers the teaching-session side
of the same problem: two easily-confused ideas side by side, with the
learner teaching the difference, verified on a mixed Agent Check.

## Deterministic vs AI-decided

Deterministic: where the strategy may be chosen, its use limit, and the
pass/fail of the mixed check (standard answer-key scoring). AI-decided:
whether to offer interleaving for a given struggle, and which related topic
to pair — the engine ranks strategies from recorded outcomes but the agent
makes the offer, subject to harness validation. See
[Adaptive learning](adaptive-learning.md).

## Agent authority

The agent may offer `interleave` when the learner's struggle matches its
targets and the workflow permits it. The agent may not claim the plan is
"interleaved" in general, rotate topics on its own authority outside this
strategy, or mark either topic understood without the mixed check passing
through the normal topic state machine.

## Failure and edge behaviour

- If the mixed check fails, the topic follows the normal path —
  `intervention_required`, teach-back gate, retest — for the topic that
  failed; interleaving grants no exemption from attempt caps.
- Once the per-topic use limit is reached, the strategy is exhausted for
  that topic and the recommender stops offering it.

## Related

- [Learning methodologies](learning-methodologies.md)
- [Active recall](active-recall.md)
- [Assessment framework](assessment-framework.md)
