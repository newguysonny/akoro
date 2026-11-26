---
title: Release acceptance criteria
status: beta
doc_status: draft
audience: [engineer, qa, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Release acceptance criteria

A release is accepted when the evidence below exists and passes — not
when the code is merged. These criteria formalise the checks the platform
already runs; where a criterion describes an aspiration rather than a
current mechanism, it says so.

## Criteria

### 1. Build and unit layer

- The API and each frontend build cleanly.
- The co-located `node --test` suites for every touched module pass,
  including contract and behaviour suites.
- Documentation validation passes (`validate-docs.mjs`,
  `validate-tool-registry.mjs`) when the change touches docs, registries
  or the API contract.

### 2. Verification gate (sandbox)

- The `regression` suite runs against the sandbox on the release build
  and returns no FAIL. ERROR verdicts are re-run; a persistent ERROR in a
  touched area blocks acceptance until explained.
- Suites owning the changed areas run green, including write suites
  (`self-tooling-writes`, `writes`) when the change writes data, with the
  no-residue case passing.
- Security scenarios pass in full — no exceptions, no waivers (see
  [Security testing](security-testing.md)).

### 3. Behaviour-specific evidence

- **Agent changes:** the relevant chat/workflow scenarios and benchmark
  evals pass; known model-side variance is documented in the release
  notes if a benchmark is carried as a known defect (see
  [Agent evaluation](agent-evaluation.md)).
- **Learning changes:** learning-event, signal and review-scheduling
  scenarios pass; no release may claim an effectiveness improvement
  without the evidence machinery behind it (see
  [Learning effectiveness evaluation](learning-effectiveness-evaluation.md)).
- **Visible frontend changes:** the change is loaded and checked at
  desktop, tablet and mobile widths; the mobile load is the acceptance
  test, not an afterthought.
- **Deploys:** acceptance is against the actually-deployed build —
  the deployed build identity is confirmed from the target itself (for
  the API, its health/build reporting; for frontends, the served bundle),
  never assumed from the merge.

### 4. Safety and rollback

- Sandbox write smoke scripts pass for any change to auth, records or
  course-media write paths (see [Scripts README](../scripts/README.md)).
- Feature-flagged changes name their kill switch in the release notes.
- Migrations are listed, are applied by the normal boot process, and have
  been exercised on the sandbox before production.

### 5. Documentation and registry

- Behaviour changes update the feature/capability docs, the OpenAPI
  contract where applicable, and the capability registry status where
  availability changed — in the same change or a linked follow-up that
  lands before the release is announced.
- Statuses are honest: a capability verified only on the sandbox is not
  described as production-verified.

## Waivers

A criterion may be waived only by a named owner, in writing, in the
release record, with the defect and its follow-up stated. Security
scenario failures (criterion 2) and no-residue failures are not
waivable. A waived release is reported as waived, not as passed.

## Not yet formalised

- Performance budgets (latency/cost thresholds as hard gates) exist as
  scenarios today, not as acceptance thresholds.
- Accessibility and external security review are not yet release gates;
  adding them is an owner decision.

## Related

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Regression testing](regression-testing.md)
- [Security testing](security-testing.md)
- [Root README](../README.md)
