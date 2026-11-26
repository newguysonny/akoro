---
title: Pomodoro
status: planned
doc_status: draft
audience: [educator, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Pomodoro

## Status: not implemented

There is **no Pomodoro implementation in Akoro**. The term does not appear
in the API codebase, and no component provides the technique's defining
mechanism: fixed focus intervals (classically 25 minutes), timed breaks,
cycle counting, or interval-driven session structure. No timer of any kind
drives a learning session: Study Prep topics, teaching sessions and Decay
Reviews all run to completion of their workflow steps, however long that
takes, and a session's elapsed time plays no role in its state machine.

Agents and product copy must not describe Akoro study sessions as
Pomodoro-based, and must not quote focus/break interval numbers — none
exist in the product.

## Adjacent mechanisms that do exist

These are real, but they are not Pomodoro and must not be relabelled:

- **`chunk_plan` strategy ("Smaller parts")** — splits a topic or plan into
  smaller parts; targets `overload`, `time_management` and `time_pressure`
  struggles in Study Prep. It changes the *size* of work units, not their
  timing.
- **`schedule_plan` strategy ("A dated schedule")** — a dated schedule to
  the exam, with reminders; targets poor planning and procrastination. It
  schedules *days and sessions*, not minute-level intervals.
- **`timed_practice` strategy** — short, low-stakes timed rounds the
  learner answers themselves, for speed and test-anxiety struggles in
  Decay Review and Practice. The timing there is exam-speed training, the
  opposite intent from Pomodoro's work/rest pacing.
- **Session pause states** — Study Prep and Decay Review workflows can be
  paused and resumed, but pausing is learner- or balance-driven, never
  timer-driven.

## What a Pomodoro implementation would need (not yet built)

A planning note only: a timer service the session workflows can observe,
interval/break policy constants alongside the other workflow policies,
cycle evidence (completed focus intervals) if it is ever to affect the
learner model, and client UI for the timer. None of this exists today, so
this document remains `planned`.

## Agent authority

None. There is no timer capability to start, stop or configure. An agent
asked for Pomodoro-style study should say it is not available and may
offer what exists — a smaller-parts plan (`chunk_plan`) or a dated
schedule (`schedule_plan`) — under their correct names.

## Related

- [Learning methodologies](learning-methodologies.md)
- [Adaptive learning](adaptive-learning.md)
- [Capability registry](../capability-registry.yaml)
