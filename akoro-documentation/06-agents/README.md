# Agent documentation

Operating principles, capabilities, tools, permissions, context loading,
memory, workflows, handoffs, verification, error recovery and safety for
agents working with Akoro.

Status: Phase 3 in progress. The discovery, tool and context contracts are
documented, and the operating layer below is drafted from the current
runtime; live verification of the runtime behaviours is still pending.

## Start here

- [Agent guide](../AGENTS.md)
- [Agent operating principles](agent-operating-principles.md)
- [Capability discovery and execution](agent-capabilities.md)
- [Context Manager contract](context-manager.md)
- [Tool registry](../tool-registry.yaml)
- [Capability registry](../capability-registry.yaml)

## Documents

- [Agent operating principles](agent-operating-principles.md) — the standing rules: docs are not authorization, the model drives the work, verify do not assume.
- [Capability discovery and execution](agent-capabilities.md) — the five-stage path from a task to a verified action.
- [Context Manager contract](context-manager.md) — what enters a task's context, in what order, and what is pruned.
- [Agent tool registry](agent-tool-registry.md) — the documented tool registry, the runtime catalogue, self-tooling and the private gateway.
- [Agent permissions](agent-permissions.md) — the capability access ceiling, confirmation and decision cards, learner-built tool permissions.
- [Agent memory policy](agent-memory-policy.md) — conversation context vs learner memory vs operational memory; evidence-based mastery.
- [Agent workflows](agent-workflows.md) — the agent turn, upload workflow, self-tooling workflow, autonomy cycles, scheduled follow-ups.
- [Agent handoffs](agent-handoffs.md) — peer consultation, the marketplace, the agent-service relay, human decision points.
- [Agent verification](agent-verification.md) — per-action verification, the sandbox verification gate, documentation validation, agent evaluation.
- [Agent error recovery](agent-error-recovery.md) — failure classes, retry discipline, model failover, partial failure.
- [Agent safety](agent-safety.md) — authorization boundaries, untrusted content, output hygiene, learner protection.

## Rules

- Documentation explains permissions; the backend enforces them.
- Docs are not authorization.
- Read `AGENTS.md` before a task.
- Check capability status before use.
- Select a documented tool by capability, not by guessing a name.
- A tool may narrow its capability's access; it may never widen it.
- Use the templates in `_templates/`.
- Link capabilities, API operations, data models and workflows.

## Validation

```bash
node akoro-documentation/scripts/validate-docs.mjs
node akoro-documentation/scripts/validate-tool-registry.mjs
node akoro-documentation/scripts/search-docs.mjs "records ask"
```
