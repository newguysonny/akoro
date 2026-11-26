---
title: Agent tool registry
status: implemented
doc_status: draft
audience: [agent, engineer]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Agent tool registry

How agent-facing tools are defined, selected and validated. There are two
different "tool" layers in Akoro and they must not be confused:

| Layer | Where | Who uses it |
| --- | --- | --- |
| Documented agent tools | [`tool-registry.yaml`](../tool-registry.yaml) | Agents acting through the documented capability path |
| Runtime tool catalogue | The API's agent runtime (chat loop, self-tooling) | The learner protégé inside a session |

## 1. The documented registry

[`tool-registry.yaml`](../tool-registry.yaml) is the contract layer. Every
entry has an `id`, `name`, `description`, exactly one `capability` from the
[capability registry](../capability-registry.yaml), a JSON Schema
`input_schema`, `documentation` paths that must resolve, an `api_reference`
for `http` tools, an `execution_mode` (`http` or `internal`), and a
`permissions` block (`access`, `requires_authentication`,
`requires_confirmation`, `confirmation_reason`), plus optional `side_effects`
and `notes`.

Rules enforced by validation:

- Only capabilities that already exist in the capability registry may appear.
  No speculative, planned or internal-only tools are included.
- A tool's `access` may be narrower than its capability's; it may never be
  wider.
- If a capability requires confirmation, its tool must require confirmation
  and state the reason.
- Public capabilities must not require authentication at the tool layer.

Agents select a tool **by capability**, never by guessing a tool name. If no
tool exists for an available capability, the agent reports the gap instead of
calling an undocumented route or the private gateway directly. See
[Agent capability discovery and execution](agent-capabilities.md).

## 2. The runtime catalogue

Inside the API, the learner agent's turn is assembled from a core tool set
plus the tools of the currently active areas. Areas come from a single
taxonomy; per-turn selection is driven by the sticky conversation, message
keywords and any forced tool, and can be disabled wholesale by an environment
kill switch. Built-in tools cover the platform's data views (library, chats,
tasks, goals, notes, sessions, past questions, weak topics and more).

Learners can also build their own tools through self-tooling:

- **Domain tools** package one data view's questions as a fixed action set.
- **Computed tools** compose views freely and never call a domain tool.
- A data-driven **view registry** lets administrators register new data views
  in a database table; active specs merge into the runtime at boot and on a
  refresh interval, fail-open, so a registered view goes live with no deploy.
  A stored spec can never shadow a built-in view.
- New learner tools are saved off, as drafts, behind a build-consent card;
  only the learner's tap activates one. A per-learner tool cap applies.
- Writes stay code-only: capabilities that mutate data are defined in code,
  not in learner- or admin-authored specs.

## 3. The private gateway

Runtime tool execution for external agent processes goes through the private
agent-tools gateway (`/api/internal/agent-tools/v1`). It is guarded by a
service credential plus a short-lived capability token, is scoped to a
learner/session, and is never exposed in public documentation or clients.
Tool access decisions are centralised server-side; the gateway enforces what
the registries describe.

## 4. Validation

```bash
node akoro-documentation/scripts/validate-docs.mjs
node akoro-documentation/scripts/validate-tool-registry.mjs
```

The tool-registry validator checks tool IDs, capability IDs, documentation
and API references, permission metadata and duplicate IDs. A registry that
fails validation is invalid until corrected; agents stop rather than
improvise around it.

## Related

- [Tool registry](../tool-registry.yaml)
- [Capability registry](../capability-registry.yaml)
- [Agent permissions](agent-permissions.md)
- [Agent capability discovery and execution](agent-capabilities.md)
