---
title: AI and agent runtime overview
status: beta
doc_status: overview
tier: 3
audience: [developer, agent, product]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# AI and agent runtime overview

## What it covers

The AI protégé, agent runtime, tool gateway, memory, autonomy, proposals,
ratings, self-tooling, verification and model routing.

## Observed surfaces

- `adaptive-learning` chat and teaching modules.
- `agent-tools` private gateway (`/api/internal/agent-tools/v1`).
- Agent runtime/context/memory/capability modules.
- `agent-network`, `agent-proposals`, `agent-ratings`, `autonomy`,
  `self-tooling`, `capability-requests`.
- Verification gate and agent console (key-guarded).

## Runtime model

```text
system instructions -> tool registry -> task context
-> documentation index -> retrieved docs -> execution -> verification
```

The runtime must not load the entire knowledge base. It retrieves only what the
task needs. See [AGENTS.md](../../AGENTS.md).

## Status

Implemented but internal; treat as **beta** and do not expose private gateway
routes in public docs. The capability registry and documentation index are the
public-safe discovery layer.

## Permissions

- Service credential plus short-lived capability token for the private gateway.
- Learner/session scoping.
- Write tools may require confirmation.
- Documentation explains permissions; the gateway enforces them.

## Documentation gaps

- Tool catalogue and input schemas.
- Memory policy (learner memory vs operational memory).
- Autonomy levels and confirmation policy.
- Agent evaluation and failure taxonomy.
- Model routing and fallback policy.
- Verification scenarios.

## Related

- [Agent guide](../../AGENTS.md)
- [Capability registry](../../capability-registry.yaml)
- [Agent capability workflow](../../13-examples/workflows/agent-capability.md)
- [Phase 0 audit](../../../docs/audits/phase-0-documentation-audit.md)
