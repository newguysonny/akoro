# Akoro Documentation

This folder is the internal documentation workspace. Public documentation will be
published separately, but the plans and source notes live here.

## Plans

| Plan | Role |
| --- | --- |
| [Platform Documentation System](PLATFORM-DOCUMENTATION-SYSTEM-PLAN.md) | Master plan: platform knowledge, capability registry, agent context loading, templates, validation, governance and roadmap. This is the canonical strategy. |
| [Public Docs, Changelog and Status](PUBLIC-DOCS-CHANGELOG-STATUS-PLAN.md) | Implementation detail for the public docs site, API reference, changelog and status page. It is a subplan of the master. |

Do not create a third plan for the same system. Add detail to the master or its
public subplan, and keep the master as the source of truth.

## Audits

| Audit | Status | Role |
| --- | --- | --- |
| [Phase 0 Documentation Audit](audits/phase-0-documentation-audit.md) | Complete | Inventories routes, apps, features, data models, integrations and gaps before documentation begins. |
| [Phase 1 Capability Verification](audits/phase-1-verification.md) | Partial | Sandbox blocked by hibernation rate limit; production non-destructive smoke passed for 9 capabilities. |
| [Phase 2 Public API Verification](audits/phase-2-verification.md) | Partial | 16 public GET operations passed on production; write paths and sandbox remain pending. |

Supporting data: `docs/audits/phase-0/*.csv`.

## Canonical knowledge base

The platform documentation system now lives at
[`akoro-documentation/`](../akoro-documentation/README.md). It contains the
agent guide, capability registry, documentation index, API skeleton, feature
overviews and templates. This `docs/` folder remains the planning, audit and
internal-operations workspace.

## Current reference documents

- [Engineering guarantees](ENGINEERING_GUARANTEES.md)
- [Security checklist](SECURITY_CHECKLIST.md)
- [LLM cost model](llm-cost-model.md)
- [Learner smoke test](learner-smoke-test.md)
- [Chat commands](CHAT-COMMANDS.md)
- [Learner UI audit](UI-AUDIT-learner-2026-09.md)
- [Learner autonomy plan](learner-full-autonomy-plan.md)

## Working rules

- Internal notes stay internal; public docs are curated from the master plan.
- Every public API fact must come from OpenAPI or verified code.
- Every capability must have a status: `implemented`, `beta`, `planned`,
  `deprecated` or `disabled`.
- Planned features must never be presented as available.
- Documentation changes ship with the code change they describe.
- Security-sensitive content requires review before publication.

## Next step

Run the Phase 0 audit from the master plan: inventory routes, features, data
models, agents and existing docs before writing public documentation.
