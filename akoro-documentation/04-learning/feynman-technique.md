---
title: Feynman technique
status: planned
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Feynman technique

## Status: not implemented

There is **no Feynman technique implementation in Akoro's code**. No module,
strategy, workflow state or prompt implements the Feynman cycle (pick a
concept → explain it in plain language as if teaching a child → find the
gaps in the explanation → return to the source and simplify again), and the
term "Feynman" does not appear in the adaptive-learning codebase. This page
exists so the gap is explicit: agents and educators must not describe Akoro
as using the Feynman technique.

## What exists instead

The adjacent, genuinely implemented mechanism is **teach-back**: the
learner explains an idea in their own words while the agent listens, probes
and asks to be corrected. It shares the Feynman technique's core move —
learning by explaining simply — but it is a different, named mechanism with
its own gates and evidence model:

- The `teach_back` strategy in the Strategy Library, with defined success
  ("the learner explains it unprompted and the next Agent Check passes").
- The Study Prep teach-back gate: after a failed check, a retest is blocked
  until the teach-back is confirmed.
- Teaching sessions in which the learner teaches their agent (the protégé),
  with a server-owned evidence model that scores the explanation's core,
  application, reasoning and correction quality.

See [Teach-back method](teach-back-method.md) for the real mechanism.

## What a Feynman implementation would need (not yet built)

This is a planning note, not a description of behaviour:

- A named strategy or workflow that runs the four-step cycle explicitly,
  including a "simplify the language" pass distinct from teach-back's
  probing.
- A plain-language/jargon check on the learner's explanation — no such
  check exists today; the teaching evidence model scores explanation
  quality dimensions, not reading level or jargon.
- A gap-identification step that routes identified gaps back into the
  topic plan (the engine's `intervention_required` state and
  prerequisite strategies cover part of this shape already).

Until those exist and are verified, this document stays `planned`, and any
product copy claiming a Feynman method would be inaccurate.

## Agent authority

None. There is no Feynman capability to invoke. An agent asked for "the
Feynman technique" should offer what exists — a teach-back session — and
name it correctly, rather than relabelling teach-back as Feynman.

## Related

- [Teach-back method](teach-back-method.md)
- [Learning methodologies](learning-methodologies.md)
- [Capability registry](../capability-registry.yaml)
