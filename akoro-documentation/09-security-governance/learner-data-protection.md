---
title: Learner data protection
status: beta
doc_status: draft
audience: [engineer, security, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Learner data protection

Learner data is the core asset Akoro holds in trust: uploaded materials,
library contents, chat history, study activity, assessment attempts,
mastery evidence, goals and wallet records. This document states how that
data is protected. It builds on [Privacy policy](privacy-policy.md) and
[Data classification](data-classification.md), where learner data is
classified Private (personal), with payment details Restricted.

## Protection rules

1. **Owned by the learner, scoped to the learner.** Every learner-owned
   record carries its owner's identity, and every read, list, search and
   download is filtered by that ownership in the backend. There is no
   "fetch by ID" path for learner records that skips the ownership check.
2. **Private storage, checked downloads.** Uploaded files live in private
   object storage. A download URL is issued only after the caller's session
   and ownership are verified, and it expires; there are no permanent
   public links to private files. Non-owners receive a not-found response,
   and private or premium records are invisible to them in lists.
3. **Visibility changes are explicit owner actions.** A learner's material
   becomes visible to others only when the learner publishes or shares it,
   or when a documented relationship applies (their instructor, their
   school's scoped roles, a community they joined). Each such surface
   exposes only what its feature requires.
4. **Younger and protected learners get stricter defaults.** Agent-network
   and social features apply additional gates for protected learners —
   for example, protected junior learners never auto-answer network chat —
   and discovery surfaces respect each learner's privacy settings.
5. **Learning evidence is integrity-protected.** Mastery, scores and
   progress are written only by the assessment and learning engines from
   actual learner activity. Neither agents nor other learners can fabricate
   or edit another learner's evidence; an agent must never invent a score
   or mark a concept mastered without evidence.
6. **Agent access is the learner's access.** When the AI agent reads a
   learner's materials to answer a question, it does so under that
   learner's own permissions, and answers are grounded in the learner's
   own content with citations. One learner's content is never used to
   answer another learner.
7. **Support and admin access is exceptional.** Platform staff do not
   browse learner content as a routine tool. Operational access (usage,
   spend, error investigation) works on metadata and aggregates; content
   access for a specific support case is a deliberate, attributable act
   under [Audit logging](audit-logging.md).

## Data in transit between features

- **Communities and battles** show other participants only the artefacts
  the feature is about (a post, a battle entry, a score) — never the
  author's library, chats or records.
- **Instructor views** of a learner are limited to the teaching
  relationship: assigned work, submissions and progress in the
  instructor's own classes.
- **School views** are limited by the tenancy and role scopes in
  [Tenant isolation](tenant-isolation.md).

## Incidents

Suspected exposure of learner data is treated as a security incident under
[Security policy](security-policy.md): contain (revoke, unpublish,
re-scope), verify the actual exposure from records rather than assumption,
and inform the policy owners before any external statement.

## Related

- [Privacy policy](privacy-policy.md)
- [Data classification](data-classification.md)
- [Access control](access-control.md)
- [Tenant isolation](tenant-isolation.md)
- [Data retention](data-retention.md)
