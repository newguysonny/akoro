---
title: Discover and execute an agent capability
status: beta
doc_status: overview
tier: 3
audience: [agent, developer]
last_reviewed: 2026-11-25
owners: [TBD]
workflow_id: agents.discover_and_execute
capabilities: []
---

# Discover and execute an agent capability

Internal agent workflow. This is not a public browser API.

## Objective

Find the right Akoro capability, check that it is available and permitted, call
it through the tool gateway, and verify the side effect.

## Required context

- Service credential for the private agent-tools gateway.
- Short-lived, session-bound capability token.
- Learner/session identity and task context.
- The capability registry and documentation index.

## Steps

| Step | Action | Success condition |
| --- | --- | --- |
| 1 | Read `AGENTS.md` and `documentation-index.json` | Relevant capability candidates |
| 2 | Read `capability-registry.yaml` | Status is `implemented` or `beta`; access allows the actor |
| 3 | Read the capability/workflow/API docs | Prerequisites, side effects, errors understood |
| 4 | `POST /api/internal/agent-tools/v1/catalog` | Tool catalogue for this session |
| 5 | Select a tool; validate its input schema | Required fields and constraints satisfied |
| 6 | Read-only: `POST /api/internal/agent-tools/v1/invoke` | Result + observation |
| 7 | Write: `POST /api/internal/agent-tools/v1/confirmations` | Confirmation prepared |
| 8 | `POST /api/internal/agent-tools/v1/execute-confirmed` | Confirmed write executed |
| 9 | Verify using a read capability or the returned observation | Side effect confirmed |
| 10 | On failure, follow the documented recovery path | No blind retries |

All gateway calls require the service credential and a capability token. The
gateway validates both; documentation never grants access.

## Decision rules

| Condition | Action |
| --- | --- |
| Capability `planned`/`disabled` | Stop; report unavailable |
| Capability `deprecated` | Use the linked replacement |
| Missing permission | Stop; report the permission issue |
| Write without confirmation | Request confirmation first |
| Schema validation fails | Fix the request; do not guess fields |
| Result ambiguous | Verify before reporting success |

## Failure and retry

- Retry only idempotent calls or calls with an idempotency key.
- A 401/403 is permanent for this session; do not bypass it.
- A 409 may mean state changed; re-read the state before retrying.
- A timeout after a write requires verification before retry.

## Verification

- The observation matches the expected side effect.
- A follow-up read shows the new state.
- The capability status and permissions were respected.

## Prohibited

- Do not call internal routes from public clients.
- Do not use a learner token for an admin capability.
- Do not invent tool names or parameters.
- Do not treat documentation as authorization.
- Do not mark mastery or grading complete without verified evidence.

## Related

- [Agent guide](../../AGENTS.md)
- [Capability registry](../../capability-registry.yaml)
- [Documentation index](../../documentation-index.json)
- [Agent documentation](../../06-agents/README.md)
