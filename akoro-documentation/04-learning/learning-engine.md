---
title: Learning engine
status: beta
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Learning engine

## What the engine is in Akoro

The learning engine is the deterministic core that owns learning state:
session and topic transitions, scoring, mastery evidence, review scheduling
and strategy permission. The AI agent works *through* the engine; it never
replaces it. The Education Engine module states this directly in code: "The
agent uses this engine; it never replaces it."

## How the engine implements it

The engine is not one file. It is a set of pure state machines and pure
scoring functions, plus the workflow runtime that persists them:

- **Study Prep state machines** (`study-prep/state-machine.js`) — session:
  `planning → awaiting_confirmation → topic_active ⇄ replanning ⇄ paused →
  completed | abandoned | cancelled`. Topic: `queued → active →
  diagnostic_ready → diagnostic`, then `understood`,
  `intervention_required` or `capped_out`, with teach-back and retest gates
  between a failed check and any retest.
- **Teaching-session state machine** (`teaching-session/state-machine.js`) —
  phases PHASE_1 → PHASE_4 → MASTERY, advanced only by a deterministic
  progression gate over recorded evidence.
- **Decay Review workflow** (`decay-review/workflow.js`) — the retention
  workflow: inspecting → diagnostic → evaluating → retained | decayed →
  intervention → retest → completed.
- **Education Engine** (`study-prep/education-engine.js`) — pure functions:
  deterministic answer-key scoring, threshold routing, mastery write-back
  and plan cost estimation. No database, no LLM, no clock reads.
- **Strategy Library** (`lib/strategyLibrary.js`, v3) — the one source of
  truth for which teaching/repair strategies exist, where each may be
  chosen, what runs it (a Teaching session or a workflow harness) and its
  per-topic use limits.
- **Decay engine** (`agents/student/decayEngine.js` and siblings) —
  confidence decay, review priority, next-review dates and reinforcement.
  See [Spaced repetition](spaced-repetition.md).
- **Workflow runtime** — sessions and reviews persist as workflow instances
  and events (`edu.workflow_instances`, `edu.workflow_events`); see the
  [learning session model](../05-data-models/learning-session.md).

Feature flags gate whole surfaces: Study Prep sits behind
`AKORO_STUDY_PREP_ENABLED`, the exam-prep confidence loop behind
`AKORO_EXAM_PREP_CONFIDENCE_ENABLED` (default on), and individual strategies
can be switched off with `AKORO_STRATEGIES_DISABLED`.

## Deterministic vs AI-decided

Deterministic (engine only): every state transition, all MCQ scoring,
pass/fail threshold routing, attempt caps, mastery and retention updates,
review intervals, strategy permission and limits, cost estimates.

AI-decided (agent/model): proposing topic plans, drafting syllabi and
questions, conducting teaching dialogue, judging free-text recall answers in
Decay Review (an assessor-role model call), and choosing *which permitted
strategy to offer* — the engine ranks candidates by recorded outcomes, the
agent picks, the harness validates the pick.

## Agent authority

The agent may: propose plans and strategies, start checks the state machine
allows, narrate progress, and record observations. The agent may not: set
mastery directly, skip confirmation, teach-back or pause gates, score an
attempt, reuse an exhausted strategy, or create a second active Study Prep
session for a learner. See the [concept model](../05-data-models/concept.md)
for the evidence rules behind this.

## Failure and edge behaviour

- Invalid transitions are refused with stable codes (for example
  `invalid_state_transition`, `teach_back_gate`, `attempt_cap_exceeded`,
  `strategy_not_permitted`) mapped to HTTP statuses by the harness.
- A stopped or paused session accepts no answers.
- A Decay Review left mid-step ("inspecting" with no check for over a
  minute) is resumed on the learner's next tap rather than duplicated; one
  open review per topic is enforced.
- Insufficient coins pause a Study Prep session instead of failing it.

## Related

- [Learning methodologies](learning-methodologies.md)
- [Adaptive learning](adaptive-learning.md)
- [Learning and assessment overview](../01-features/learning/overview.md)
- [Learning session model](../05-data-models/learning-session.md)
