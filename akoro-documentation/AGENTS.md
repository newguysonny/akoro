# Akoro Agent Documentation Guide

This file is the entry point for coding, research and operational agents working
with Akoro.

Status: Phase 1 foundation. This guide is authoritative for how agents use the
documentation system. Product facts still come from code and the capability
registry.

## 1. Purpose

Akoro's documentation is a knowledge and research system, not only an API
reference. It explains:

- what Akoro does and why;
- what capabilities exist and their status;
- how to research a task;
- how to call the API safely;
- how features, data and agents relate;
- how to verify success and recover from failure;
- what an agent must never do.

## 2. Read order

Do not read the entire repository before reading your tools.

1. System instructions and safety rules.
2. Tool definitions and schemas.
3. The current task and relevant state.
4. `documentation-index.json` to find the relevant feature.
5. The linked capability, API and workflow documents.
6. `capability-registry.yaml` to confirm the capability is available.
7. Only then inspect code or implement.

## 3. Source-of-truth precedence

1. Current implementation and executable API contracts.
2. Current `02-api/openapi.yaml`.
3. Current capability documentation.
4. Workflow documentation.
5. Examples and historical documentation.

If sources disagree, stop and report the conflict. Do not silently choose one.

## 4. Capability status

Never infer availability from prose. Check `capability-registry.yaml`.

- `implemented` — available.
- `beta` — available with known limitations.
- `planned` — not available; do not use.
- `deprecated` — available temporarily; use the replacement.
- `disabled` — unavailable.

A capability that is only described in a feature document is not necessarily
implemented.

## 5. API rules

- Never invent endpoints, fields, identifiers or status codes.
- Read the current OpenAPI operation before constructing a request.
- Follow authentication and portal requirements.
- Respect rate limits and idempotency rules.
- Do not assume success from HTTP 200 alone; verify the documented side effect.
- On failure, read the error body and use the documented recovery path.
- Do not retry a permanent error without changing the cause.
- Do not call an internal route from a public client.

## 6. Permissions

Documentation explains permissions. The backend enforces them.

- Reading a capability document grants no access.
- Role checks, ownership checks, tenant isolation and shared-secret guards are
  enforced by the API.
- Agents must not attempt to bypass authentication or authorisation.
- Do not use production credentials in examples or tests.

## 7. Educational integrity

- Use verified learning materials and past questions when available.
- Distinguish verified questions from generated practice.
- Never invent examination sources, scores or mastery evidence.
- Do not mark a concept as mastered without evidence.
- Respect learner privacy and ownership.
- If a required capability is unavailable, report the gap; do not fake it.

## 8. Research workflow

For a task such as "build an adaptive learning experience":

1. Read `documentation-index.json`.
2. Identify required capabilities.
3. Check status, access and confirmation rules in the capability registry.
4. Read the feature overview and workflow.
5. Read the OpenAPI operations.
6. Read the data-model documents.
7. Inspect existing implementation and tests.
8. Produce a small research result, including missing information.
9. Implement only after the contract is clear.
10. Verify side effects and update docs/changelog if behaviour changed.

## 9. Tool use

- Prefer documented tools over ad-hoc API calls.
- A tool's description and schema are part of its contract.
- If a tool's documentation link resolves, read it before first use.
- Do not request new tools if an existing capability already covers the task.
- Report tool failures with the actual error, not a paraphrase.

## 10. Documentation changes

When behaviour changes:

1. Update OpenAPI if the contract changed.
2. Update the feature/capability document.
3. Update affected workflows.
4. Update examples.
5. Update `capability-registry.yaml` if availability changed.
6. Add a changelog entry if users or developers are affected.
7. Run documentation validation.

Agents may propose documentation changes. They may not silently rewrite the
official API contract or mark a capability implemented without verification.

## 11. Security

- Never write secrets, tokens, cookies or real learner/school data into docs.
- Use demo accounts and sandbox data.
- Redact personal information from examples and screenshots.
- Treat internal endpoints, admin routes and agent-console routes as private.
- Follow coordinated disclosure for security issues.

## 12. Verification

A task is not complete because code exists. Verify:

- the documented endpoint exists;
- the request schema matches;
- the response shape matches;
- permissions are enforced;
- side effects occurred;
- failure paths behave as documented;
- examples still work.

## 13. Reporting

When blocked, report:

- the task;
- the capability or endpoint attempted;
- the exact error;
- what was verified;
- the missing documentation or contract;
- the safest next step.

Do not invent an answer to fill a documentation gap.
