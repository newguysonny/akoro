---
title: Agent architecture
status: beta
doc_status: draft
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent architecture

## Purpose

Akoro's agents are model-driven workers inside the API: a learner's chat
agent, instructor tools, teaching workflows, and the agent-to-agent network.
This page describes the runtime shape they share. The documentation-side
contract for how an agent discovers and uses capabilities is separate — see
[Agent capability discovery](../06-agents/agent-capabilities.md).

## Boundaries

The agent layer owns deciding what to do next and narrating it. It does not
own enforcement: every tool executes through module code that re-checks
authentication, ownership and permissions. The server does not post its own
messages into a chat — outcomes exist only as agent narration of tool
results, and a permission-card decision is applied by the agent's
continuation, not written into the transcript by the server.

## Diagram

```text
Learner message
      |
      v
runAgentToolLoop (modules/adaptive-learning/chat.js)   <- live chat loop
  per-turn tool set = CORE + active areas' tools
  (taxonomy: modules/agent-capabilities, areas in self-tooling/areas.js)
      |  decide -> tool call -> observation (with a say-first narration
      |  steer on every step, including failures) -> decide -> ...
      v
tools execute in module code (reads via Data Views, writes via capabilities)
      |
      +-- change proposed? -> permission card -> learner tap ->
          in-turn continuation applies exactly the card's frozen targets

modules/agent-runtime/loop.js (runAgentLoop)           <- workflow runtime
  decide -> validate -> execute -> observe, with caps, a loop guard,
  per-tool time limits and a recorded basis for each decision
```

## Request/event flow

1. A chat turn assembles context (conversation, learner state, grounded
   document content) and selects the turn's tools: a core set plus the
   tools of the areas the conversation is sticky to, the message keywords
   imply, or a forced named tool selects. With no signal, the full list is
   offered.
2. The loop runs the model: each tool observation carries a narration steer
   so the model's own lines stream as activity between steps. A named tool
   mentioned with a run verb can be forced; a negated run verb never
   forces. A zero-execution answer that ends mid-sentence is retried once.
3. Writes with consequences go through confirmation: the proposal runs dry
   first, the card freezes the exact target references, and approval applies
   only that set — one listed item means exactly one change.
4. Learner-built tools (self-tooling) follow the same loop with extra gates:
   a brand-new tool is saved off as a draft behind a build-consent card,
   and building a copy of something a built-in already covers asks first.

## Data and storage

Chat sessions and messages (with per-message trace) live in `edu`; tool
definitions for learner-built tools live in `edu.agent_tools`; Data Views —
the read surface tools compose over — are code-defined built-ins merged at
runtime with admin-approved, database-registered views (refreshed every
60 s, fail-open). Writes stay code-only: a stored view can read, never
write.

## Dependencies

[Model routing](model-routing.md) for every model call; the coin wallet for
metering paid calls; Postgres for sessions, tools and memory (see
[Memory architecture](memory-architecture.md)).

## Failure modes

- Model-side variance is a designed-for failure: empty loop decisions,
  refusals and false "not in my set" claims are countered by the
  named-tool force, the narration guard and the fragment retry rather than
  by server-side scripting.
- A tool past its time limit returns as a `timeout` observation; a call
  that exactly repeats the previous one gets a loop-guard reminder in its
  observation.
- Insufficient coins surface as a stop code that ends the loop step.

## Security and permissions

Tools run as the learner: personal tools are strictly owner-scoped, reads
go through owner-checked views, and platform-promoted tools are the one
documented exception. Confirmation cards are bound to the dry run's frozen
targets, so an approval cannot be widened after the fact.

## Invariants

- One live chat loop (`runAgentToolLoop`) serves the learner Agent tab,
  instructor chat, scheduled follow-ups and card continuations, so
  narration and gating behaviour cannot drift between surfaces.
- Teaching sessions are permanent learning history: there is deliberately
  no `sessions.delete` capability.
- A learner's saved tool cap and per-domain action caps are enforced at
  save time by the self-tooling pipeline, not by the model.

## Observability

Every chat message carries its execution trace (tool calls, observations,
decisions), rendered in the client as activity blocks; AI calls are metered
and recorded by the model layer's telemetry.

## Related

- [Model routing](model-routing.md)
- [Memory architecture](memory-architecture.md)
- [Context Manager contract](../06-agents/context-manager.md)
- [Agent capability discovery](../06-agents/agent-capabilities.md)
- [AI and agent runtime feature overview](../01-features/ai/overview.md)
