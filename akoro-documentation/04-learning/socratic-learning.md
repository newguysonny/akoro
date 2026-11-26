---
title: Socratic learning
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Socratic learning

## What it means in Akoro

Socratic learning exists in Akoro only as a **dialogue style**, not as an
engine mechanism. A learner's interaction style can be set to `socratic`
(alongside `balanced`, `collaborative` and `independent`) in the agent chat
settings, and the training orchestration maps that style to a prompt-level
instruction: "always respond with a guiding question", run phase-based.
That is the entire implementation: guidance to the model about how to talk.

## What is *not* implemented

- No Socratic state machine, gate or workflow. Nothing in the learning
  engine requires a question-before-answer sequence, counts questions, or
  blocks progression until a Socratic dialogue completes.
- No verification that the model actually stayed Socratic. Compliance is a
  property of the model's output in that turn, not something the engine
  checks or records as evidence.
- No Socratic strategy in the Strategy Library. The library's
  question-driven mechanisms are different, named strategies — notably
  `self_check` ("How sure are you?": a confidence rating before a check,
  compared with the result) and retrieval practice — and they should not be
  relabelled as Socratic method.

## Deterministic vs AI-decided

Nothing here is deterministic. Selecting the style is a stored learner
preference; honouring it is entirely the model's behaviour in conversation.
Scoring, mastery, review scheduling and all gates are unaffected by the
style setting — a Socratic-styled session produces evidence through exactly
the same checks as any other session. See
[Learning engine](learning-engine.md).

## Agent authority

The agent may adopt the Socratic style when the learner's settings select
it, and drop it when they change the setting. The agent must not claim the
engine enforces Socratic questioning, must not present style-driven
questioning as assessment evidence, and must still route the learner
through the same deterministic checks before anything is marked understood.

## Failure and edge behaviour

- If the model answers directly instead of asking a guiding question, no
  system component detects or corrects it; the failure is conversational
  quality only.
- Style settings never override safety, grounding or gate rules: a
  teach-back gate or an attempt cap applies identically in Socratic style.

## Related

- [Learning methodologies](learning-methodologies.md)
- [Adaptive learning](adaptive-learning.md)
- [Teach-back method](teach-back-method.md)
