---
title: Teach-back method
status: implemented
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Teach-back method

## What it means in Akoro

Teach-back is Akoro's central repair mechanism: the learner explains the
idea in their own words while the agent listens, probes and asks to be
corrected. Akoro runs it in both directions of the protégé relationship —
the learner teaches their agent, and understanding is only credited when
the explanation holds up and a later check passes.

## How the engine implements it

- **Strategy.** `teach_back` (Strategy Library v1) targets `misconception`,
  `partial_understanding` and `encoding_failure`; it runs in Study Prep,
  Teaching and Decay Review, executed by a Teaching session in
  `teach_agent` mode. Success is defined as: "the learner explains it
  unprompted and the next Agent Check passes." Limit: at most 3 uses per
  topic.
- **The Study Prep gate.** In the topic state machine, a failed check leads
  to `intervention_required`. From there the topic goes to
  `awaiting_teaching` (a requested teaching session) or, when Teaching is
  unavailable, to `retest_ready` via the **inline teach-back fallback**. A
  retest requested before the teach-back is confirmed is refused with the
  stable code `teach_back_gate` ("The learner must confirm the teach-back
  before a retest", HTTP 409). The gate cannot be talked past.
- **Teaching sessions.** The learner teaches their protégé through phases:
  what the agent already knows → must-know parts → **Phase 3: the student
  agent teaches it back** → push further → Mastery. The deterministic
  progression gate requires recorded evidence to advance, and MASTERY
  additionally requires every concept verified.
- **Teaching evidence.** A server-owned evidence model
  (`learner/teaching-evidence.js`, policy `teaching-evidence-v1`) scores
  each concept's explanation on core explanation, application, reasoning
  and correction, with status `introduced → developing → verified`. Its
  founding rule: "A delivered explanation is exposure, not mastery." It
  stores only compact scores — never the learner's words.
- **Exam prep.** A low score on an exam-prep confidence run sets the run to
  `teach_back_required` and *offers* a fresh teach-back handoff. It is
  learner-initiated only: it creates no task, notification, autonomous
  session or instructor escalation.
- **Decay Review.** When retrieval practice and a retest both fail, the
  review escalates to re-teaching with strategy `teach_back` in
  `teach_agent` mode, followed by one last retest.

## Deterministic vs AI-decided

Deterministic: the gate, the phase progression, attempt and use caps, and
what counts as verified. AI-decided: the protégé's questions, probes and
misconceptions during the dialogue, and the compact quality scores the
evidence model records from the conversation. The final arbiter is never
the dialogue itself — it is the next scored Agent Check.

## Agent authority

The agent conducts the teach-back and records observations. Only the
engine lifts the retest gate, advances phases, or marks a concept verified.
The agent must not accept its own satisfaction with an explanation as
evidence, skip the gate because the learner asks, or store/repeat the
learner's explanation as proof of mastery.

## Failure and edge behaviour

- If Teaching is unavailable, Study Prep falls back to the inline
  teach-back so the gate still has a satisfiable path.
- An unresolved misconception flag on a concept blocks its `verified`
  status regardless of other scores.

## Related

- [Feynman technique](feynman-technique.md)
- [Assessment framework](assessment-framework.md)
- [Mastery framework](mastery-framework.md)
- [Learning session model](../05-data-models/learning-session.md)
