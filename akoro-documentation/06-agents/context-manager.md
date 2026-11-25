---
title: Context Manager contract
status: beta
doc_status: overview
tier: 3
audience: [agent, developer]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# Context Manager contract

This page defines how an Akoro agent assembles task context from the
documentation system. It is a retrieval and loading contract, not a runtime API
specification. It does not add endpoints and it does not grant permissions.

The machine-readable inputs already exist in this repository:

- [`documentation-index.json`](../documentation-index.json) — discovery layer.
- [`capability-registry.yaml`](../capability-registry.yaml) — what exists and
  who may use it.
- [`tool-registry.yaml`](../tool-registry.yaml) — tools linked to capabilities.
- [`02-api/openapi.yaml`](../02-api/openapi.yaml) — request and response
  contract.
- [`scripts/search-docs.mjs`](../scripts/search-docs.mjs) — offline keyword
  search over the index and registries.

## 1. Goals and non-goals

The Context Manager decides **what knowledge enters a task's context**, in what
order, and what is removed when the context is too large.

Goals:

- load the smallest useful set of documents;
- confirm capability availability before reading details;
- prefer precise endpoint and data-model pages over prose;
- avoid re-reading the same file inside one task;
- keep permissions, confirmation rules and verification steps intact.

Non-goals:

- choosing the next action (that belongs to the agent runtime);
- executing tools (that belongs to the tool executor and gateway);
- enforcing access (that belongs to the backend);
- inventing routes, fields or capabilities that are not in the registries.

## 2. Loading stages

Stages run in order. A stage may stop the task when a stop condition is met.

| Stage | Source | Purpose | Stop condition |
| --- | --- | --- | --- |
| 0. Always loaded | System instructions, [`AGENTS.md`](../AGENTS.md), current task and state | Safety, source rules and the requested outcome | Never skipped |
| 1. Discovery | [`documentation-index.json`](../documentation-index.json) | Map the task to feature IDs, tiers and candidate capabilities | No plausible feature or capability |
| 2. Capability confirmation | [`capability-registry.yaml`](../capability-registry.yaml) | Confirm status, access, confirmation and verification rules | Status is `planned`, `disabled` or `deprecated` without a replacement; access excludes the actor |
| 3. Tool selection | [`tool-registry.yaml`](../tool-registry.yaml) | Choose a documented tool whose capability matches | No tool for the capability, or capability mismatch |
| 4. Targeted retrieval | Documents linked from the selected tool and feature | Read prerequisites, request fields, side effects, errors and verification | Required doc is missing or contradicts the registry |
| 5. Contract depth | [`02-api/openapi.yaml`](../02-api/openapi.yaml) and linked data models | Confirm exact operation, parameters, schemas and ownership | Operation or schema does not match the documentation |
| 6. Assembly | All retrieved material | Deduplicate, summarise and prune to the context budget | Security, permission or verification facts would be lost |

Stages 1–3 are cheap. Stage 4 is where token cost grows, so retrieve only the
documents linked to the chosen capability or tool. Stage 5 is required before
constructing a write request.

## 3. Source precedence

When two sources disagree, the higher row wins for the question it answers. If
the conflict affects an action, stop and report it instead of guessing.

| Priority | Source | Authoritative for |
| --- | --- | --- |
| 1 | Current implementation and executable API contracts | What the system actually does today |
| 2 | [`capability-registry.yaml`](../capability-registry.yaml) | Whether a capability is available, who may use it, and whether confirmation is required |
| 3 | [`02-api/openapi.yaml`](../02-api/openapi.yaml) | Request and response shape of documented operations |
| 4 | [`tool-registry.yaml`](../tool-registry.yaml) | Which tool maps to a capability and what its input schema is |
| 5 | Capability, endpoint, architecture and data-model documents | Intent, prerequisites, side effects and recovery guidance |
| 6 | Workflows and examples | How tasks are combined; they do not override registries |
| 7 | Historical notes and roadmap material | Context only; never proof of availability |

A tool may be narrower than its capability (for example, a read-only subset) but
it may never claim more access than the capability registry grants. Prose in a
feature document cannot mark a capability available.

## 4. Retrieval rules

1. Start from the index or a search result. Do not load the repository.
2. Search by feature ID, capability ID, tool ID, endpoint path or a small set of
   task terms. All search terms must match.
3. Expand one hop through index links by default. Expand further only when the
   task depends on a named dependency, event or data model.
4. For a specific call, prefer the endpoint page and the OpenAPI operation over
   the feature overview.
5. Load a data model when the task constructs, filters or validates fields.
6. Load a workflow when the task spans more than one capability.
7. Before a write, load the endpoint's errors and verification sections and the
   capability's confirmation rule.
8. For roadmap or research questions, documents for `planned` or `disabled`
   capabilities may be read for context but must be labelled unavailable.
9. Treat external URLs as unverified until the linked local document or the
   OpenAPI operation confirms the claim.
10. Record every retrieved path and the stage that requested it. Retrieval is
    reproducible: the same task and index version should load the same set in
    the same order.

Illustrative budgets from the platform plan (not measured Akoro costs) suggest
a few thousand tokens for the index and retrieved docs, not the whole corpus.
Budget numbers may change; the ordering rules must not.

## 5. Deduplication

- Key documents by their canonical path relative to `akoro-documentation/`.
- Resolve `./` and `../` before comparing; do not compare raw link strings.
- A document may appear under several features, capabilities and tools. Load it
  once and keep all provenance labels.
- When a tool-linked doc and a feature doc are the same file, keep one copy and
  merge the reason for retrieval.
- Do not merge different files that share a title.
- Do not re-retrieve a document that is already in the current task context
  unless its content changed or the index version changed.
- Keep the OpenAPI file as one document even when several tools reference it.

## 6. Summarisation and pruning

Summarise only after deduplication and only when the context budget requires it.

Keep, in priority order:

1. Frontmatter status, `doc_status`, tier and capability IDs.
2. Permission, confirmation and ownership statements.
3. Exact operation, path, method, field names, enums and limits.
4. Error tables and recovery steps.
5. Verification requirements and side effects.
6. Headings and short definitions.

Remove first:

1. Repeated examples and screenshots.
2. Historical notes and roadmap prose.
3. Marketing or background prose that does not change an action.
4. Duplicated tables already covered by a higher-priority document.

Never summarise away a prohibition, a "docs are not authorization" warning, a
confirmation requirement or an error/verification step. Never invent a field,
route or status while shortening. Mark any summarised document so the runtime
can show that the agent saw a summary, not the full page.

## 7. Per-agent profiles

All agents load stage 0 and the three registries. Profiles change which feature
documents are retrieved in stages 4–5.

| Profile | Prioritise | Avoid unless the task requires it |
| --- | --- | --- |
| Learner agent | [`learning`](../01-features/learning/overview.md), [`records`](../01-features/records/overview.md), [`pharmd`](../01-features/pharmd/overview.md), [`learner`](../05-data-models/learner.md), [`learning-session`](../05-data-models/learning-session.md), [`concept`](../05-data-models/concept.md) | Admin, school ERP and internal agent-console material |
| Instructor agent | [`instructor`](../01-features/instructor/overview.md), [`courses`](../01-features/courses/overview.md), [`programmes`](../01-features/programmes/overview.md), [`course`](../05-data-models/course.md) | Learner private records unless the task is about that learner |
| School agent | [`school`](../01-features/school/overview.md), programme and course models | Public blog and careers material |
| Coding agent | [`03-architecture`](../03-architecture/README.md), [`02-api`](../02-api/README.md), [`05-data-models`](../05-data-models/README.md), [`08-engineering`](../08-engineering/README.md), [`10-testing-quality`](../10-testing-quality/README.md) | Roadmap prose treated as current behaviour |
| Operations agent | [`09-security-governance`](../09-security-governance/README.md), [`10-testing-quality`](../10-testing-quality/README.md), [`11-changes-releases`](../11-changes-releases/README.md), both registries | Marketing content and examples presented as contracts |

Profile selection must not widen permissions. A learner agent that retrieves an
instructor document still has learner access.

## 8. Failure behaviour

| Condition | Required behaviour |
| --- | --- |
| No matching feature or capability | Search by synonyms and capability ID; if still empty, report a documentation gap and stop |
| Capability is `planned` or `disabled` | Do not load it into actionable context; report unavailability |
| Capability is `deprecated` | Load the replacement named in the registry; do not use the old capability unless the task is explicitly historical |
| Capability access excludes the actor | Stop and report the permission issue; do not attempt a different token |
| No tool exists for an available capability | Report the gap; do not construct an ad hoc private call |
| Tool and capability disagree | Stop; the tool registry is invalid until corrected |
| Document path is missing | Report the broken reference; do not substitute an unverified URL |
| Sources disagree on a contract | Stop and report both sources and the conflicting claim |
| Index or registry is stale | Report the stale reference and validate with the scripts; do not silently retry |
| Context budget is exceeded | Prune according to section 6; if security, permission or verification facts cannot fit, stop rather than omit them |
| Search returns too many matches | Narrow by capability ID, tool ID or endpoint; do not dump the whole index |

Every failure report should name the task, the capability or document, the exact
error and the safest next step, as required by [`AGENTS.md`](../AGENTS.md).

## 9. Verification

A retrieval result is trustworthy when:

- every loaded path resolves and is listed in the index or a registry;
- every capability used is `implemented` or `beta`;
- the selected tool's `capability` matches the confirmed capability;
- the tool's access is no wider than the capability's access;
- the OpenAPI operation exists for the referenced method and path;
- no conflicting source was suppressed;
- the agent can show the retrieved paths and any summaries.

The scripts in [`scripts/`](../scripts/README.md) validate these invariants
offline. They do not verify runtime behaviour; sandbox and production checks
remain separate.

## Related

- [Agent discovery and execution](agent-capabilities.md)
- [Agent guide](../AGENTS.md)
- [Agent capability workflow](../13-examples/workflows/agent-capability.md)
- [Documentation index](../documentation-index.json)
- [Capability registry](../capability-registry.yaml)
- [Tool registry](../tool-registry.yaml)
