---
title: Memory architecture
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Memory architecture

## Purpose

"Memory" in Akoro is what the agent layer retains about a learner between
conversations: stored agent memories, persona ("soul") preferences,
check-ins and episodes, conversation summaries, and the learner's concept
state. All of it is database state, not model state — the model is
stateless between calls and re-reads what it needs.

## Boundaries

Memory is per-learner and owner-scoped. It is distinct from mastery:
memories and self-reports never become concept evidence, and concept state
is written only by the learning engine from assessed activity (see the
[learner model](../05-data-models/learner.md) and the
[concept model](../05-data-models/concept.md)). The documentation Context
Manager in [06-agents](../06-agents/context-manager.md) is a separate
concern — it governs which documents enter a task, not learner memory.

## Diagram

```text
chat turns (edu chat sessions/messages)
      |
      +-- during the turn: conversation context assembled per call
      |   (modules/agent-context; stored memories + soul preferences
      |    are loaded as part of the learner's context)
      |
      +-- after the chat settles: quiet learning pass
          (modules/agent-memory/quietLearning.js)
          settle timer -> summary written, memories merged
          (add / update / forget), capped per learner
      |
      v
edu.learner_agent_memories        edu.learner_soul_preferences,
edu check-ins / episodes          edu.learner_concept_state (engine-owned)
```

## Request/event flow

1. During a turn, the agent's context is assembled from the conversation,
   the learner's stored memories and preferences, and grounded content —
   bounded, like every other part of the loop (see
   [Agent architecture](agent-architecture.md)).
2. After every saved chat turn, quiet learning (re)arms one delayed job per
   chat. The wait itself is held in Postgres (a deferred job), so a busy
   chat simply pushes its row back with no Redis traffic.
3. When the chat has settled and enough new messages exist since the last
   pass, the pass runs on the shared background queue: it writes a real
   summary of the conversation and merges the learner's memories. One pass
   per (chat, watermark) — a replay is a no-op.

## Data and storage

- `edu.learner_agent_memories` — the agent's active memories, capped per
  learner (`QUIET.MAX_ACTIVE` in the quiet-learning core).
- `edu.learner_soul_preferences`, check-ins and episodes — persona state.
- `edu.learner_agent_autonomy` — the consent record quiet learning checks.
- Conversation summaries are written by the quiet-learning pass alongside
  the memory merge.

## Dependencies

The shared background queue and deferred-jobs store (see
[Background workers](background-workers.md)); the model layer for the
summarisation call; the jobs gate for standing the worker down.

## Failure modes

- Consent unavailable or the learner's agent is offline: the pass reports
  not-allowed and writes nothing — memory fails closed.
- The pass is best-effort background work: if it never runs, the next
  conversation simply starts from the older memory set; nothing in the
  live chat path depends on it.

## Security and permissions

Quiet learning is consent-gated in code: it runs only when the learner's
agent is Online and "Learn from my conversations" is on. The platform pays
for the pass within daily and weekly budgets; the learner is never charged
for background memory work. Sensitive content is never stored as memory.

## Invariants

- Memory never feeds mastery: no memory write can change concept state.
- A learner's memories are readable and writable only for that learner.
- The live chat path never blocks on memory maintenance.

## Observability

Quiet-learning runs are worker jobs with the standard worker logging; the
pass budgets are tracked in the budget state the worker checks before
running.

## Related

- [Agent architecture](agent-architecture.md)
- [Background workers](background-workers.md)
- [Learner model](../05-data-models/learner.md)
- [Learning session model](../05-data-models/learning-session.md)
