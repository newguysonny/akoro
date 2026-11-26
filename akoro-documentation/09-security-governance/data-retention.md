---
title: Data retention
status: planned
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Data retention

This document is the retention policy framework for Akoro data. **The
retention periods themselves are not yet set.** No period is stated in the
codebase, and this document deliberately invents none: periods are a
decision for the policy owners, recorded here once made. Until then, the
rules below govern how retention must be treated in design and code, and
any document, UI copy or support answer that states a specific period
without an owner decision behind it is a defect.

## Retention classes

When the owners set periods, they will be set per class, aligned with
[Data classification](data-classification.md):

| Class of data | Retention questions the owners must answer |
| --- | --- |
| Account data | How long after account closure is the account record kept, and in what form? |
| Learner content (uploads, library, chats) | Deleted immediately on request, after a grace window, or retained for a set period? Are backups purged on the same schedule? |
| Learning evidence (attempts, mastery, progress) | Is evidence kept after content deletion, anonymised, or deleted with it? |
| School records | Which periods does the school's own obligations impose, and who — school or platform — executes deletion? |
| Transaction records (wallet, vouchers, subscriptions) | What do financial-record obligations require, and what is anonymised versus kept whole? |
| Operational records (logs, usage, verification evidence) | How long are they kept for security and cost investigation before aggregation or deletion? |
| Backups | What is the backup lifetime, and how does a deletion request propagate into backups? |

## Rules that apply now

1. **Deletion is real, not cosmetic.** Where the product offers deletion
   (a learner deleting a record, chat or tool; an admin deleting a user),
   the artefact stops being readable and usable immediately, and dependent
   indexes and derived data are cleaned up by the owning module. A deleted
   item must not resurface through search, agent tools or merged views.
2. **Sessions are learning history.** Some artefacts are permanent by
   design — teaching/study sessions, for example, have no delete operation
   because they are the learner's learning history. That is a product
   decision, recorded here so it is not mistaken for a missing feature;
   whether account closure overrides it is one of the owner decisions
   above.
3. **Anonymisation beats retention where identity is not needed.**
   Aggregates used for analytics and quality work should not retain
   identifiable learner data once the operational need passes.
4. **No silent indefinite growth in new features.** A new module that
   stores personal data must state, in its feature document, what it
   stores, what deletes it, and which retention class it expects — even if
   the period itself is still "to be set by policy owners".
5. **Legal and school holds override schedules.** Where a school or a
   legal obligation requires records to be kept, deletion waits; where it
   requires records to be removed, retention waits. The platform's job is
   to execute the decision, not to make it.

## Owner decisions required

- A period (or an event-based rule) for every row of the table above.
- The account-closure flow: what the user is told, what is deleted,
  anonymised and kept, and over what timeline.
- Who may approve an exception, and how exceptions are recorded under
  [Audit logging](audit-logging.md).

## Related

- [Privacy policy](privacy-policy.md)
- [Data classification](data-classification.md)
- [Learner data protection](learner-data-protection.md)
- [Audit logging](audit-logging.md)
