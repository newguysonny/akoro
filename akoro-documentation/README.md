# Akoro Platform Documentation

Canonical knowledge base for the Akoro platform, its APIs, learning model,
agents, data, operations and change history.

Status: **Phase 1 foundation** — structure and templates are in place; content is
being populated from the Phase 0 audit.

## Start here

| Document | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | How agents research, execute and update Akoro knowledge |
| [llms.txt](llms.txt) | Compact discovery index for AI systems |
| [documentation-index.json](documentation-index.json) | Machine-readable feature and capability map |
| [capability-registry.yaml](capability-registry.yaml) | What Akoro can do, with explicit status |
| [02-api/openapi.yaml](02-api/openapi.yaml) | API contract skeleton |
| [00-platform/platform-overview.md](00-platform/platform-overview.md) | What Akoro is and who it serves |
| [00-platform/terminology.md](00-platform/terminology.md) | Akoro-specific terms |

## Structure

| Folder | Contents |
| --- | --- |
| `00-platform/` | Overview, ecosystem, terminology, principles, roadmap |
| `01-features/` | Capability-centred feature documentation |
| `02-api/` | OpenAPI, auth, errors, endpoints, webhooks, limits |
| `03-architecture/` | System, backend, data, agent and event architecture |
| `04-learning/` | Learning engine, methodologies, assessment, mastery |
| `05-data-models/` | Entities, relationships, lifecycle, ownership |
| `06-agents/` | Operating principles, tools, permissions, memory, workflows |
| `07-integrations/` | Supabase, AI, payments, storage, email, meetings |
| `08-engineering/` | Setup, repository, standards, testing, deployment |
| `09-security-governance/` | Security, privacy, data classification, AI governance |
| `10-testing-quality/` | Quality strategy, API/agent/learning/security tests |
| `11-changes-releases/` | Changelog, releases, migrations, upgrade guides |
| `12-roadmap/` | Direction, priorities, planned work |
| `13-examples/` | API, agent and workflow examples |
| `_templates/` | Required templates for every new document |
| `_schemas/` | JSON schemas for machine-readable registries |

## Status vocabulary

Every feature, capability and API page declares:

- `implemented` — exists, verified and supported.
- `beta` — exists, supported with known limitations.
- `planned` — not available; agents must not use it.
- `deprecated` — still works but will be removed; replacement linked.
- `disabled` — unavailable; reason and replacement linked.

Documents also carry `doc_status`:

- `draft` — being written, not approved.
- `overview` — initial accurate summary.
- `complete` — reviewed and release-ready.

## Source-of-truth precedence

1. Current implementation and executable API contracts.
2. Current OpenAPI specification.
3. Current capability documentation.
4. Workflow documentation.
5. Examples and historical documentation.

If sources conflict, do not silently choose one. Report the conflict and open a
documentation issue.

## Rules

- Documentation explains permissions; the backend enforces them.
- Planned features are never presented as available.
- Public docs are an allow-listed subset of this repository.
- Examples use demo accounts and sandbox data only.
- A pull request that changes behaviour updates the relevant docs and
  changelog entry.
- Do not create a new top-level plan; extend the existing plans under `docs/`.

## Plans and audit

- [`docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`](../docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md)
- [`docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md`](../docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md)
- [`docs/audits/phase-0-documentation-audit.md`](../docs/audits/phase-0-documentation-audit.md)

## Validation

```bash
node akoro-documentation/scripts/validate-docs.mjs
```

This checks JSON/YAML parsing, registry/index references, OpenAPI refs and local
Markdown links. Full route coverage and sandbox example validation arrive in
Phase 2.

## Current phase

Phase 2 is complete except for the remaining sandbox write paths. Phase 3
knowledge-tooling is in place. The repository now has:

- auth and records endpoint pages;
- five end-to-end workflows;
- core learner, record, course, programme, learning-session and concept models;
- 34 OpenAPI paths / 35 operations covering auth, records, public catalogue,
  blog/careers, contact and pilot intake;
- a validator that checks registry/index/OpenAPI/link integrity;
- a tool registry, Context Manager contract, agent capability guide and offline
  documentation search.

Still pending: live sandbox re-verification, write-capability cleanup tests,
runtime route-table coverage, and Tier-2/3 documentation.
