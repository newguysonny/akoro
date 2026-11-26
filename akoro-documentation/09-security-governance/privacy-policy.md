---
title: Privacy policy
status: planned
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Privacy policy

This is the internal privacy governance document for the Akoro platform. It
records what personal data the platform holds, why, and the rules that govern
its use. It is a policy document: the public-facing privacy notice for users
is a separate, owner-approved text, and nothing here invents commitments
(periods, jurisdictions, contact addresses) that the policy owners have not
set. Where a rule below is enforced in code it says so; the rest is binding
team intent until the owners formalise it.

## Data the platform holds

- **Account data** — name, email, username, role and portal, needed to
  authenticate and operate the account.
- **Learning data** — uploaded materials, chat history, study activity,
  assessment attempts, mastery evidence and goals. This is the learner's own
  record of learning; see [Learner data protection](learner-data-protection.md).
- **School data** — class, enrolment and school-management records held under
  the school's tenancy; see [Tenant isolation](tenant-isolation.md).
- **Transaction data** — wallet, voucher and subscription records needed to
  operate payments.
- **Operational data** — logs and usage records needed to run, secure and
  cost-manage the platform; see [Audit logging](audit-logging.md).

## Rules

1. **Purpose limitation.** Data collected to run learning features is not
   repurposed for unrelated profiling or advertising. Any new purpose needs
   an owner decision recorded in this document first.
2. **Ownership and visibility.** A learner's private materials, chats and
   learning records are visible to that learner. Other actors see them only
   through an explicit, documented relationship (for example an instructor
   teaching that learner, or a school role scoped to its own tenancy) and
   only to the extent that relationship requires.
3. **No real data in examples.** Documentation, tests, screenshots and
   support material use sandbox demo accounts and synthetic data. Real
   learner data is redacted before it appears in any report.
4. **Agents inherit the user's privacy boundary.** An agent acting for a
   learner may only read and write what that learner could; agent-to-agent
   and network features apply their own privacy gates and never widen a
   learner's audience silently.
5. **Data minimisation for AI.** Prompts and tool calls carry the minimum
   content needed for the task. Secrets and credentials are never placed in
   a prompt, example or report.
6. **Deletion and retention** follow [Data retention](data-retention.md).
   The periods themselves are set by the policy owners; until they are,
   no document may state one.

## Roles

Data is classified in [Data classification](data-classification.md); the
classification drives who may access it under
[Access control](access-control.md). School-held data about pupils is
governed jointly by this policy and the school's own obligations — the
platform's part is to enforce the tenancy boundary and the role scopes
within it.

## Open items for the policy owners

- Formal retention periods per data class (see
  [Data retention](data-retention.md)).
- The public privacy notice text and its approval.
- A named contact route for privacy requests (access, correction, deletion).

Until these are decided, engineers must not invent them in code comments,
UI copy or documentation.

## Related

- [Learner data protection](learner-data-protection.md)
- [Data classification](data-classification.md)
- [Data retention](data-retention.md)
- [Tenant isolation](tenant-isolation.md)
