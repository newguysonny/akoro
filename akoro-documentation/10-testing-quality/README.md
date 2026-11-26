# Testing and quality

QA strategy, feature/API/agent/learning/security testing, regression and release acceptance.

Status: Drafted 2026-11-26 from the test systems that exist today — the co-located `node --test` suites, the verification gate's scenario registry, and the sandbox smoke scripts. Coverage is described as found; no coverage percentages or pass rates are claimed beyond named runs.

## Documents

- [Quality assurance strategy](quality-assurance-strategy.md)
- [Feature test cases](feature-test-cases.md)
- [API test cases](api-test-cases.md)
- [Agent evaluation](agent-evaluation.md)
- [Learning effectiveness evaluation](learning-effectiveness-evaluation.md)
- [Security testing](security-testing.md)
- [Regression testing](regression-testing.md)
- [Release acceptance criteria](release-acceptance-criteria.md)

## Rules

- Distinguish software correctness, agent correctness, educational effectiveness and security correctness.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
- Report run verdicts as they came back, with target and build; never invent metrics.
