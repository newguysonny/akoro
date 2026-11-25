---
title: School platform overview
status: beta
doc_status: overview
tier: 2
audience: [school, developer, agent]
last_reviewed: 2026-11-25
owners: [TBD]
capabilities: []
---

# School platform overview

## What it covers

The school portal and ERP: admissions, students, attendance, academics, exams,
fees, HR/payroll, front office, library, inventory, transport, hostel, assets,
communications, website builder and settings.

## Scale

- School app: 245 frontend routes.
- `school` module: 177 API route declarations.
- `mgmt` schema: 128 tables.
- Additional school tables in `edu` and `public` schemas.

This is a full ERP. It must be documented by module group, not endpoint.

## Module groups

1. Admissions and front office.
2. Student records and wellbeing.
3. Attendance and behaviour.
4. Academics: classes, sections, subjects, timetable, syllabus.
5. Exams, marks, report cards, CBC.
6. Fees, accounts, income, expenses, challans.
7. HR: staff, payroll, leave, appraisals.
8. Library.
9. Inventory and procurement.
10. Transport.
11. Hostel.
12. Assets.
13. Communications, notices, events, gallery.
14. Website builder and domains.
15. Settings, roles, backups, audit.
16. AI help/chat.

## Status

**Beta.** The breadth is large and the product/privacy boundary for public docs
is not decided. Do not publish school endpoints in the public API reference
until the school product owner approves the surface.

## Permissions and isolation

- School-scoped data, with staff roles within a school.
- Tenant isolation is enforced by school id and host mapping.
- Learner/student PII requires strict redaction in all examples.
- Platform admins may access cross-tenant views; never expose them publicly.

## Documentation approach

1. One overview per module group.
2. One workflow per high-value task (admit student, mark attendance, generate
   report card, collect fees, run payroll).
3. Endpoint reference only after the group overview and workflow are verified.
4. No public examples with real school data.

## Documentation gaps

- School role matrix and permissions.
- Data ownership and retention per module.
- Academic year/term lifecycle.
- Fee/payment reconciliation.
- Website/domain lifecycle.
- Backup and recovery.

## Related

- [Phase 0 audit](../../../docs/audits/phase-0-documentation-audit.md)
- [Learner model](../../05-data-models/learner.md)
