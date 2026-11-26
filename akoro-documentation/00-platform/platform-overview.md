---
title: Platform overview
doc_status: complete
audience: [developer, product, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# Platform overview

Akoro is an education platform with four primary web applications, an API, a
library and extraction pipeline, a course and media system, an AI protégé/agent
runtime, curriculum and assessment tools, and a full school management system.

This page describes the surfaces observed in the Phase 0 audit. It is a
foundation overview, not a complete product specification.

## Applications

| Application | Primary users | Observed scope |
| --- | --- | --- |
| Learner | Students, independent learners | Dashboard, onboarding, library, AI protégé, teaching, study prep, exam prep, practice, communities, battles, wallet, public catalogue |
| Instructor | Teachers, course creators | Courses, course builder, live/on-demand lessons, students, assignments, submissions, assessments, tasks, wallet, documents, library |
| School | School administrators and staff | Admissions, students, attendance, academics, timetable, exams, fees, HR/payroll, library, inventory, transport, hostel, assets, website builder, settings |
| Admin | Platform operators | Users, instructors, schools, courses, programmes, approvals, content, analytics, AI models/spend, evaluations, billing, agent capabilities, prompts |

## Backend domains

- Authentication, sessions, 2FA and Google OAuth.
- Profiles, roles and portal-scoped access.
- Library records, uploads, previews, extraction, chunking, retrieval and ask.
- Courses, lessons, enrolments, progress, live sessions, videos and HLS.
- Programmes, curriculum, syllabus, past questions and PharmD.
- Adaptive learning, teaching sessions, Study Prep, Exam Prep, practice and
  assessment evidence.
- Learner memory, concept state, goals, decay review and autonomy.
- Communities, battles, agent network, self-study, marketplace and vouchers.
- Payments, wallets, payouts, subscriptions and webhooks.
- School ERP and school website/domain management.
- Admin operations, AI model routing, evaluations and the verification gate.

## Core concepts

- **Learner** — the person learning; owns progress, evidence and memory.
- **Instructor** — creates and teaches courses, assignments and assessments.
- **School** — an institution with staff, students, classes and an ERP.
- **Admin** — a platform operator with cross-tenant privileges.
- **AI protégé** — the learner-facing agent persona that teaches and studies with
  the learner.
- **Agent runtime** — the tool-using system that plans, calls tools, verifies
  results and recovers from failure.
- **Record** — a library material: PDF, document, image, audio, video, paste or
  link.
- **Capability** — a stable, documented action Akoro can perform.
- **Workflow** — an ordered combination of capabilities that completes a task.

## Important boundaries

- Akoro is not only a chatbot. Its learning methodology, evidence and mastery
  rules are part of the product.
- The school app is not a small admin panel; it is a broad ERP with more than
  170 API route declarations and 128 management tables.
- The API contract exists as an OpenAPI specification
  (`02-api/openapi.yaml`); Tier-1 coverage is complete (36 documented
  operations) and Tier-2 domains are still being documented.
- Documentation explains permissions; the backend enforces them.
- Public documentation is an allow-listed subset of this repository.

## Evidence

- Phase 0 audit: `docs/audits/phase-0-documentation-audit.md`
- App route inventory: `docs/audits/phase-0/app-route-inventory.csv`
- Module inventory: `docs/audits/phase-0/module-inventory.csv`
- Table inventory: `docs/audits/phase-0/table-inventory.csv`

## Open questions

- Is the school ERP partner-facing in the first public release?
- Which capabilities are public versus internal?
- `/api/v1` policy — decided 2026-11-26: keep the API unversioned for now;
  versioning stays a documented proposal to revisit if external consumers
  arrive.
- Who owns each domain's feature and API documentation?
