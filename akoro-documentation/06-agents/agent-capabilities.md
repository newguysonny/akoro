---
title: Agent capability discovery and execution
status: beta
doc_status: overview
tier: 3
audience: [agent, developer]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# Agent capability discovery and execution

This page explains the supported path from a task to a verified action:

```text
discovery -> capability registry -> documentation -> tool -> verification
```

> **Docs are not authorization.** Reading this page, a feature document or a
> tool definition grants nothing. The backend enforces authentication,
> authorisation, ownership, tenant isolation and confirmation. A tool's
> presence in [`tool-registry.yaml`](../tool-registry.yaml) is a contract, not a
> permission.

## 1. The five stages

| Stage | Question | Source | Exit condition |
| --- | --- | --- | --- |
| 1. Discovery | What part of Akoro covers this task? | [`documentation-index.json`](../documentation-index.json) or [`search-docs.mjs`](../scripts/search-docs.mjs) | One or more feature and capability candidates |
| 2. Registry | Does the capability exist, and may this actor use it? | [`capability-registry.yaml`](../capability-registry.yaml) | Status is `implemented` or `beta`, and `access` includes the actor |
| 3. Documentation | What are the prerequisites, fields, side effects and failures? | Documents linked from the feature, capability and tool | Contract is understood and internally consistent |
| 4. Tool | Which documented tool matches the capability, and what is its input schema? | [`tool-registry.yaml`](../tool-registry.yaml) | Tool capability matches; input validates; execution mode is understood |
| 5. Verification | Did the intended side effect happen? | Capability `verification`, endpoint verification section, or a follow-up read | Evidence matches the expected state |

Stages 1–3 are always read-only. Only stage 4 may act, and only after stage 2
confirmed availability and stage 3 confirmed the contract.

## 2. Stage details

### 2.1 Discovery

Use the index first. It maps feature IDs to descriptions, tiers, statuses,
capabilities and document lists. [`scripts/search-docs.mjs`](../scripts/search-docs.mjs)
searches the index and both registries offline:

```bash
node akoro-documentation/scripts/search-docs.mjs "published course"
node akoro-documentation/scripts/search-docs.mjs --json "record upload"
```

Search results are candidates, not proof. Continue to the registry.

### 2.2 Capability registry

Read the capability entry, not the prose:

- `implemented` — available.
- `beta` — available with the documented limitations.
- `planned` — not available.
- `deprecated` — use the linked replacement.
- `disabled` — unavailable.

Check `access`, `requires_confirmation`, `side_effects` and `verification`.
`documentation` and `api_reference` must resolve. An `implemented` capability
whose documents or operations are missing is a documentation defect, not an
invitation to improvise.

### 2.3 Documentation

Retrieve only the documents linked from the chosen capability and tool, plus the
specific OpenAPI operation and any data model needed to build the request.
Prefer:

1. the endpoint page for request fields and errors;
2. the OpenAPI operation for the exact schema;
3. the capability or feature overview for purpose and side effects;
4. the workflow for multi-step tasks;
5. the data model for ownership and field meaning.

Source precedence and retrieval rules are defined in the
[Context Manager contract](context-manager.md). If documents conflict, stop and
report the conflict.

### 2.4 Tool selection

[`tool-registry.yaml`](../tool-registry.yaml) defines the agent-facing tools.
Each entry has:

- `id`, `name` and `description`;
- `capability` — exactly one ID from the capability registry;
- `input_schema` — JSON Schema for tool arguments;
- `documentation` — paths that must resolve;
- `api_reference` — OpenAPI method, path and operation ID for `http` tools;
- `execution_mode` — `http` or `internal`;
- `permissions` — `access`, `requires_authentication`,
  `requires_confirmation` and `confirmation_reason`;
- optional `side_effects` and `notes`.

Select by capability, not by guessing a tool name. If no tool exists for an
available capability, report the gap. Do not call an undocumented route or an
internal gateway directly.

### 2.5 Verification

A successful response is not the same as a verified side effect. Use the
capability's `verification` list and the endpoint's verification section. For
writes, prefer a follow-up read capability. For ambiguous results, verify before
retrying. Retry only idempotent calls or calls with an idempotency key.

## 3. Worked examples

### 3.1 Read-only catalogue lookup

Task: "Show the published video courses."

| Stage | Result |
| --- | --- |
| Discovery | Feature `courses`; capability `courses.list_published` |
| Registry | `implemented`, access `public`, no confirmation |
| Documentation | [`courses-public.md`](../02-api/endpoints/courses-public.md), [`courses overview`](../01-features/courses/overview.md) |
| Tool | `courses_list_published`; input `q`, `type: video`, `limit` |
| Contract | `GET /courses/published` in [`openapi.yaml`](../02-api/openapi.yaml) |
| Verification | Response contains only published course cards; private fields absent |

### 3.2 Multi-step learner write

Task: "Add my notes PDF to my Library and ask a question about it."

| Stage | Result |
| --- | --- |
| Discovery | Feature `records`; capabilities `records.request_upload`, `records.create`, `records.list`, `records.ask` |
| Registry | All `implemented`; access `learner`; no confirmation required |
| Documentation | [`records-upload-url.md`](../02-api/endpoints/records-upload-url.md), [`records-create.md`](../02-api/endpoints/records-create.md), [`records-ask.md`](../02-api/endpoints/records-ask.md), [upload workflow](../13-examples/workflows/records-upload-and-ask.md) |
| Tools | `records_request_upload`, then `records_create`, then `records_ask`; `records_list` for verification |
| Contract | `POST /records/upload-url`, `POST /records`, `POST /records/ask`, `GET /records` |
| Verification | `records_list` shows the new record; `records_ask` returns citations from that record |

The PUT to the presigned `uploadUrl` is object-storage transport, not a
registered Akoro capability or tool. The tool boundary starts and ends with the
API operations above.

## 4. Permissions and confirmation

- The capability `access` list is the ceiling. A tool may be narrower; it may
  not add an access value the capability does not grant. The validator enforces
  this.
- Public capabilities use `access: [public]` and must not require
  authentication at the tool layer.
- Authenticated capabilities use a learner, session or role scope and must
  require authentication.
- If a capability sets `requires_confirmation: true`, its tool must also require
  confirmation and provide a reason.
- Documentation can explain a rule; only the backend enforces it.
- Never place tokens, cookies, service credentials or real learner data in a
  request, example or report.

## 5. When to stop

| Condition | Action |
| --- | --- |
| Capability is `planned` or `disabled` | Stop; report unavailable |
| Capability is `deprecated` | Use the registry's replacement |
| Actor is outside the capability `access` list | Stop; report the permission issue |
| No matching tool | Report the gap; do not improvise |
| Tool capability does not exist or is unavailable | Stop; run the validator |
| Input schema cannot be satisfied | Fix the request; do not guess fields |
| Documented operation or path is missing from OpenAPI | Stop; treat the documentation as broken |
| Required confirmation is absent for a write | Request confirmation first |
| Result is ambiguous or timed out after a write | Verify the state before retrying |

## 6. Validation

Run from the repository root or from `akoro-documentation/`:

```bash
node akoro-documentation/scripts/validate-docs.mjs
node akoro-documentation/scripts/validate-tool-registry.mjs
node akoro-documentation/scripts/search-docs.mjs "auth refresh"
```

- [`validate-docs.mjs`](../scripts/validate-docs.mjs) checks the index, registry,
  Markdown links, OpenAPI refs and tool alignment.
- [`validate-tool-registry.mjs`](../scripts/validate-tool-registry.mjs) checks
  tool IDs, capability IDs, documentation and API references, permission
  metadata and duplicate IDs.
- [`search-docs.mjs`](../scripts/search-docs.mjs) searches offline and fails on
  broken references.

These checks are necessary but not sufficient. Runtime verification still
follows [`AGENTS.md`](../AGENTS.md) and the verification gate.

## Related

- [Context Manager contract](context-manager.md)
- [Agent documentation](README.md)
- [Agent guide](../AGENTS.md)
- [Agent capability workflow](../13-examples/workflows/agent-capability.md)
- [Tool registry](../tool-registry.yaml)
- [Capability registry](../capability-registry.yaml)
