---
title: Current direction
status: beta
doc_status: draft
audience: [product, partner, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Current direction

Akoro's direction, as stated in its own planning source of truth,
`reference/Grand Plan.md` (the Akoro Learning Agent Grand Plan). This page
summarises; the plan itself wins in any conflict.

## The one-paragraph idea

Akoro runs **four durable learning workflows** — Study Prep, Teaching, Decay
Review and Practice — on **one shared agent runtime**. In every workflow an
agent (an LLM) looks at the current situation and proposes one action at a
time; a harness (code) decides whether the action is allowed and performs it;
a deterministic Education Engine scores, applies thresholds and records
evidence; a Context Manager selects the minimum context for the current step.
Workflow state lives in the database and is only changed by code. Every
significant step emits a structured event that is stored, replayable and
rendered in the UI.

> The states are deterministic. The path through them is adaptive. The agent
> decides *what to do next*. Code decides *what is allowed* and *what
> actually happened*.

## The non-negotiables that shape the roadmap

- The LLM never decides scores, pass/fail, thresholds, mastery, charges or
  state transitions, and never mutates workflow state, evidence, mastery or
  the wallet directly.
- Learner gates (approve a plan, start teaching, submit answers, top up,
  resume) cannot be bypassed by the agent; no coins are spent on Study Prep
  learning work before the learner confirms the plan.
- Workflows persist independently of the UI that launched them — closing a
  modal, a refresh, a logout or a socket disconnect must not lose a workflow.
  "Continue" resumes the existing workflow; it never silently creates a new
  one.
- Strategies come only from the versioned, approved Strategy Library.
- Closing claims stay inside the evidence: "demonstrated on generated
  practice", never "mastered the term".

## Where the platform stands

The plan's Phase 0 (audit and migration matrix) is marked done
(2026-10-17). The learning workflows the plan describes — Study Prep,
teaching sessions, Exam Prep and proctored Practice — exist in code and are
documented as feature pages; in `capability-registry.yaml` they are declared
**beta**: implemented and supported, with live verification still the
standing upgrade path before any of them is declared fully implemented.
Battles, communities, the agent network, self-study and payments/wallet are
in the same position: real code, beta status, verification pending.

The direction of travel is therefore not "more features first" — it is
finishing the plan's arc: one generalised runtime under all four workflows,
learning evidence recorded everywhere, a unified learner model, and then
hardening and rollout (see [Priorities](priorities.md) and
[Planned features](planned-features.md)).
