# Phase 3 Documentation Tooling

| Field | Value |
| --- | --- |
| Date | 2026-11-25 |
| Status | Implemented — documentation-tooling slice |
| Scope | Context Manager contract, tool registry, offline search, validation |

## Delivered

- `akoro-documentation/06-agents/context-manager.md` — loading stages, source
  precedence, retrieval, deduplication, summarisation, per-agent profiles and
  failure behaviour.
- `akoro-documentation/06-agents/agent-capabilities.md` — discovery → registry →
  docs → tool → verification, with explicit “docs are not authorization”.
- `akoro-documentation/tool-registry.yaml` — 13 tools mapped one-to-one to
  existing capability-registry entries.
- `akoro-documentation/_schemas/tool-registry.schema.json` — tool contract,
  permission and confirmation rules.
- `akoro-documentation/scripts/search-docs.mjs` — offline search over the index,
  capabilities and tools; JSON output and reference validation.
- `akoro-documentation/scripts/validate-tool-registry.mjs` — capability, doc,
  OpenAPI, permission and confirmation checks.

## Validation

```text
Documentation validation passed: 12 features, 13 capabilities, 13 tools,
34 OpenAPI paths, 70 Markdown files.

Tool registry validation passed: 13 tools across 13 capabilities.
```

Negative tests confirmed detection of duplicate IDs, unknown capabilities,
missing docs, wrong OpenAPI paths and missing confirmation reasons.

## Deferred

- Runtime Context Manager implementation and agent-runtime wiring.
- `ajv` meta-schema validation (structural checks only today).
- Tool gateway execution changes.
- Sandbox runtime verification for the remaining write paths.

The registry and docs are contracts; backend authentication, authorisation and
tenant isolation remain authoritative.
