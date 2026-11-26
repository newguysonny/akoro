---
title: Product principles
doc_status: draft
audience: [developer, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Product principles

Principles that guide product and engineering decisions on Akoro. The
learning-runtime rules are locked in the Grand Plan
(`reference/Grand Plan.md`, section 2); this page states them in product
terms and adds the platform-wide rules from this documentation system.

## Learning integrity

1. **Evidence over claims.** Mastery, retention and progress come only from
   recorded evidence. A learner's self-report, and a model's impression of a
   conversation, are not mastery evidence.
2. **The model never scores.** The LLM proposes; the harness disposes; the
   database confirms. Scores, pass/fail, thresholds, mastery and charges are
   decided by deterministic code, never by the model.
3. **States are deterministic; the path is adaptive.** Workflow states and
   transitions are fixed in code. The agent chooses what to do next inside
   those states.
4. **Approved content only.** Learner workflows ground in verified learning
   materials and the learner's own records — not open web research — and
   closing claims stay inside the evidence.

## Learner control

5. **Gates before spend and before change.** No coins are spent on learning
   work before the learner confirms the plan. Writes proposed by the agent
   are shown on a card and applied only on the learner's tap, exactly as
   listed — no second card, no extra changes under the same approval.
6. **One voice in the chat.** The agent drives the work with tools and
   narrates each step. The server does not post its own messages into the
   learner's chat; outcomes exist only as agent narration.
7. **Resume means resume.** "Continue" resumes an existing workflow; it
   never silently creates a new one. Workflows persist independently of the
   UI that launched them.

## Privacy and ownership

8. **Owner-scoped by default.** Records, memory and evidence belong to one
   learner. School data is isolated by school. Documentation explains
   permissions; the backend enforces them.
9. **No internals in the UI.** Backend names — tool names, parameter
   syntax, service names — never reach the learner. No hidden
   chain-of-thought is stored or shown; the UI shows bounded activity.

## Engineering

10. **Bounded autonomy.** All agent autonomy is capped: iterations, tool
    calls, retries and strategy choices have limits in code. Workflow
    actions that create things are idempotent; state transitions are
    conditional and concurrency-safe.
11. **Verify, don't infer.** A feature is available only when the
    capability registry says so and a live check proves it. Code presence
    is not verification, and a pattern-matching test is not a live run.
12. **Docs move with behaviour.** A change that alters behaviour updates
    the relevant feature doc, data model and changelog in the same pull
    request.

## Related

- [Platform overview](platform-overview.md)
- [Terminology](terminology.md)
- [Agent guide](../AGENTS.md)
