---
title: Learning methodologies
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Learning methodologies

## What this category is

Akoro's methodology is part of the product, not a prompt style. This page is
the honest map: each named methodology, where it lives in the code, and
whether it is a real engine mechanism, a partial mechanism, or not
implemented. Detail lives in the per-methodology documents; this page is
the index educators and agents should check before claiming a methodology
is "used".

## Methodology map

| Methodology | Status in code | Where it lives |
| --- | --- | --- |
| [Active recall](active-recall.md) | Implemented as retrieval practice | `retrieval_practice` strategy; Decay Review recall rounds; Agent Checks |
| [Spaced repetition](spaced-repetition.md) | Implemented | Decay engine (decay rules/schedule) + Decay Review workflow; `space_out` strategy |
| [Teach-back](teach-back-method.md) | Implemented | `teach_back` strategy; Study Prep teach-back gate; teaching sessions; teaching evidence model |
| [Interleaving](interleaving.md) | Partial — one strategy | `interleave` strategy (harness replan) in Study Prep and Practice |
| [Socratic learning](socratic-learning.md) | Partial — a dialogue style | `socratic` interaction style in chat/autonomy settings |
| [Feynman technique](feynman-technique.md) | Planned — not implemented | No Feynman mechanism; teach-back is the adjacent implemented mechanism |
| [Pomodoro](pomodoro.md) | Planned — not implemented | No timer or focus-cycle mechanism anywhere in the API |

## How methodologies are expressed in code

Most implemented methodologies are not free-standing features. They appear
in three concrete forms:

1. **Strategies** in the Strategy Library (`lib/strategyLibrary.js`, v3).
   Each entry names the struggle types it targets, the workflows it may be
   chosen in (study_prep, teaching, decay_review, practice, agent_chat),
   what executes it, how success is judged, and a per-topic use limit
   (default 2). Strategies relevant here: `teach_back`,
   `retrieval_practice`, `interleave`, `space_out`, `timed_practice`,
   `contrast_pairs`, `worked_examples`, `self_check`.
2. **Workflows** with fixed policy constants — Study Prep's topic machine,
   the Decay Review policy (check size, retained threshold, retest cap,
   hint ladder).
3. **Engine rules** — the decay schedule and mastery write-back formulas in
   the [mastery framework](mastery-framework.md).

## Deterministic vs AI-decided

The methodology *rules* are deterministic: intervals, thresholds, caps,
gates and evidence updates are code. The AI conducts the conversation
inside those rules — explaining, questioning, generating practice — and
chooses among engine-permitted strategies. An agent must never present a
planned methodology (Feynman, Pomodoro) as available, and must not describe
the Socratic style or the single interleaving strategy as engine-level
guarantees. See [Learning engine](learning-engine.md).

## Related

- [Learning engine](learning-engine.md)
- [Adaptive learning](adaptive-learning.md)
- [Assessment framework](assessment-framework.md)
- [Learning and assessment overview](../01-features/learning/overview.md)
- [Capability registry](../capability-registry.yaml)
