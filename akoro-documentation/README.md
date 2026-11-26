# Akoro Platform Documentation

Canonical knowledge base for the Akoro platform, its APIs, learning model,
agents, data, operations and change history.

Status: **All categories populated** — the Phase 1 foundation and Phase 2
capability/API content are in place, and on 2026-11-26 the remaining categories
(architecture, learning methodology, data models, agents, integrations,
engineering, security/governance, testing/quality, changes/releases, roadmap,
examples) were written from the module code. Documents are `doc_status: draft`
until reviewed; capability status still comes only from the registry.

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

## Ownership

Ownership follows the roles in the Platform Documentation System Plan (§18.1).
Akoro is a single-owner platform today: **Matt (GitHub `newguysonny`) holds
every role below and is the owner of record for every document in this
repository**, including documents whose frontmatter still says
`owners: [TBD]` — read TBD as "the documentation lead" until a document is
explicitly reassigned.

| Role | Responsibility | Held by |
| --- | --- | --- |
| Documentation lead | Structure, templates, editorial, CI, public site | Matt |
| Domain owner | Feature and API accuracy | Matt |
| Agent-platform owner | Registry, index, tool definitions, context loading | Matt |
| Security | Sensitive content, permissions, data classification | Matt |
| Operations | Status, incidents, runbooks | Matt |
| Product | Roadmap, feature status, changelog | Matt |

Agents draft and validate documentation; only the owner approves a capability
status change (for example `beta` → `implemented`), a public-docs addition, or
a security sign-off. Review follows §18.2 of the plan: technical accuracy by
the domain owner, structure by the documentation lead, security review for
auth, data, permissions and infrastructure content.

## Plans and audit

- [`docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`](../docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md)
- [`docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md`](../docs/PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md)
- [`docs/audits/phase-0-documentation-audit.md`](../docs/audits/phase-0-documentation-audit.md)

## Validation

```bash
node akoro-documentation/scripts/validate-docs.mjs
```

This checks JSON/YAML parsing, registry/index references, OpenAPI refs and local
Markdown links. Route coverage against the runtime Express table is enforced in
CI (`akoro-api/scripts/export-routes.mjs` + `route-coverage.mjs --check` in the
Docs workflow); the 2026-11-26 report (`docs/audits/phase-2-route-coverage.md`)
shows all 36 documented OpenAPI operations present in the runtime table, 0
missing. `validate-secrets.mjs` scans both documentation trees for
credential-shaped content, and the weekly Docs health workflow runs all
validators plus `check-doc-gaps.mjs` (undocumented modules, the
beta-verification backlog, stale reviews).

## Current phase

Phase 2 is complete except for the remaining sandbox write paths. Phase 3
knowledge-tooling is in place. The repository now has:

- auth and records endpoint pages;
- five end-to-end workflows;
- core learner, record, course, programme, learning-session and concept models;
- 35 OpenAPI paths covering auth, records, public catalogue, blog/careers,
  contact and pilot intake;
- a validator that checks registry/index/OpenAPI/link integrity;
- a tool registry, Context Manager contract, agent capability guide and offline
  documentation search;
- full category coverage: 174 Markdown documents across `00-platform` through
  `13-examples`, including the learning-methodology and architecture sets,
  written from the code on 2026-11-26 (see
  `docs/PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md`).

Still pending: live sandbox re-verification of the remaining beta capabilities
(agent chat, battles and the agent network are sandbox-verified as of the
2026-11-25 verify run), the public docs redeploy to the current commit, the
public site's accessibility pass, the security-review sign-off, the status
monitors and incident drill (runbook: `08-engineering/incident-drill-runbook.md`),
and the `/api/v1` decision.
