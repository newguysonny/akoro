# Security and governance

Security policy, privacy, data classification, access control, tenant isolation, learner-data protection, retention, audit logging, AI governance and human approval.

Status: Drafted 2026-11-26 from the current implementation and verified platform behaviour. Access control is implemented; several documents (privacy, classification, retention) state policy whose formal periods and registers are still owner decisions — each document says which parts are mechanism and which are intent.

## Documents

- [Security policy](security-policy.md)
- [Privacy policy](privacy-policy.md)
- [Data classification](data-classification.md)
- [Access control](access-control.md)
- [Tenant isolation](tenant-isolation.md)
- [Learner data protection](learner-data-protection.md)
- [Data retention](data-retention.md)
- [Audit logging](audit-logging.md)
- [AI governance](ai-governance.md)
- [Human approval policy](human-approval-policy.md)

## Rules

- Public content must never expose secrets, real learner data or exploitable internal details.
- Describe boundaries, roles and invariants — never bypass-relevant specifics.
- Use the templates in `_templates/`.
- Declare status and ownership.
- Link capabilities, API operations, data models and workflows where relevant.
- Never present a policy intention as an enforced mechanism.
