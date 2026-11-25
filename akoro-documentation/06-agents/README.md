# Agent documentation

Operating principles, capabilities, tools, permissions, context loading,
workflows, verification, error recovery and safety.

Status: Phase 3 in progress. The discovery, tool and context contracts are
documented; runtime autonomy and memory policy remain future work.

## Start here

- [Agent guide](../AGENTS.md)
- [Capability discovery and execution](agent-capabilities.md)
- [Context Manager contract](context-manager.md)
- [Tool registry](../tool-registry.yaml)
- [Capability registry](../capability-registry.yaml)
- [Documentation index](../documentation-index.json)
- [llms.txt](../llms.txt)

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

## Still planned

- Learner memory versus operational memory.
- Autonomy levels and the human-approval policy beyond tool confirmation.
- Handoff protocol between agents.
- Evaluation and failure taxonomy.
- Model routing and fallback policy.
