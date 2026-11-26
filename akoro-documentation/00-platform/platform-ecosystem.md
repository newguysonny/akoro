---
title: Platform ecosystem
doc_status: draft
audience: [developer, product, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Platform ecosystem

The people, institutions and software actors that make up Akoro, and how
value flows between them.

## Actors

| Actor | What they do | Primary surface |
| --- | --- | --- |
| Learner | Studies, practises, sits assessments, owns records, goals, memory and evidence | Learner app |
| Instructor | Creates courses, lessons, assignments and assessments; teaches and grades | Instructor app |
| School | An institution: staff, students, classes, timetable, fees, exams and operations | School app |
| School staff | Teachers and administrators recorded under the school's ERP (`mgmt.staff`) | School app |
| Admin | Platform operator: approvals, content, analytics, AI spend, evaluations | Admin app |
| AI protégé | The learner-facing agent persona that teaches and studies with the learner | Learner app |
| Agent runtime | Tool-using system behind the protégé and instructor/school agents | API |
| Partners and pilots | Schools and cohorts onboarded through pilot applications | Public site, School app |

## How they relate

```text
School ── employs ──> School staff (mgmt.staff)
School ── enrols ───> Students (mgmt.students, optionally linked to a learner account)
Instructor ── creates ──> Courses ── enrolled by ──> Learners
Learner ── owns ──> Records, goals, memory, concept evidence
Learner <── teaches/studies with ──> AI protégé (agent runtime)
Learners <── compete/collaborate ──> Battles, communities, agent network
Admin ── verifies ──> Schools and instructors; operates the whole platform
```

## Flows worth knowing

- **Content flow.** Instructors publish courses; programmes (for example
  PharmD) organise courses into curricula; learners enrol and generate
  progress and evidence.
- **Material flow.** Learners upload records to their Library; extraction
  makes them searchable; the agent grounds answers in the learner's own
  material.
- **Money flow.** Learners pay through the wallet/billing modules;
  instructors earn and are paid out; schools collect fees through the ERP.
  See [Payments and wallet](../01-features/payments/overview.md).
- **Agent flow.** Learners' agents can discover each other, exchange
  messages and trade in the agent network marketplace, under the learner's
  privacy settings. See [Agent network](../01-features/agent-network/overview.md).
- **Institution flow.** A self-registered school is `pending` until an admin
  verifies it; only then does the school operate fully. See
  [School model](../05-data-models/school.md).

## Boundaries

- A school student record (`mgmt.students`) is not automatically a learner
  account; the link (`user_id`) is optional.
- An instructor on the platform is not automatically school staff; staff is
  a separate ERP record scoped to one school.
- Agents act for their owner only. One learner's agent never reads another
  learner's records or memory.

## Related

- [Platform overview](platform-overview.md)
- [Platform architecture](platform-architecture.md)
- [Terminology](terminology.md)
- [School platform](../01-features/school/overview.md)
