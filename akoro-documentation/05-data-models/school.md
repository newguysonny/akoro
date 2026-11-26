---
title: School model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# School model

## What it represents

A school is an institution on Akoro. Its identity is one row in
`public.school_profiles`; everything the school runs — students, staff,
classes, fees, exams, timetable, library, transport, hostel, assets — lives
in the `mgmt` schema, scoped by `school_id` (128 `mgmt` tables per the
school feature overview). A school is a tenant: no `mgmt` row is shared
between schools.

## Identifier

- `public.school_profiles.id` — UUID.
- Every `mgmt` table carries `school_id` referencing
  `public.school_profiles(id)`.

## Important fields

`public.school_profiles` includes `id`, `admin_user_id` (the owning user),
`name`, `description`, `logo_url`, `website`, `address`, `phone`,
`is_active`, timestamps, and `verification_status`
(`pending|verified|rejected`) with `verified_at`. Later migrations add
school details, address, portal settings and custom-domain/website fields.

Core `mgmt` groups (table names as created by the mgmt migrations):

- Academics: `academic_sessions`, `classes`, `sections`, `subjects`,
  `class_subjects`, `periods`, `timetable_slots`, `promotion_logs`.
- Students: `students`, `student_categories`, `student_houses`,
  `student_attendance`, `behavior_records`, `health_records`.
- Fees: `fee_groups`, `fee_types`, `fee_discounts`, `fee_assignments`,
  `fee_payments`, `fee_challans`, `due_slips`, `fee_carry_forwards`.
- HR: `departments`, `designations`, `staff`, `staff_attendance`,
  `leave_types`, `leave_requests`, `payroll_records`, `staff_loans`,
  `salary_templates`, `appraisal_cycles`, `appraisals`.
- Exams: `exam_types`, `exams`, `exam_schedules`, `exam_marks`,
  `grade_scales`, `report_card_setups`, `online_exams`, `question_bank`.
- Operations: library (`books`, `book_loans`), inventory and POS
  (`inventory_items`, `stock_entries`, `pos_sales`, `purchase_orders`),
  transport (`vehicles`, `transport_routes`), hostel (`hostels`,
  `hostel_rooms`, `hostel_allocations`), assets (`assets`,
  `asset_assignments`, `asset_maintenance`).
- Front office and communication: `enquiries`, `visitors`, `complaints`,
  `postal_records`, `notices`, `broadcasts`, `school_events`.

`mgmt.students` includes `admission_no` (unique per school), names, `dob`,
`class_id`, `section_id`, guardian fields, `status`
(`active|inactive|alumni`) and an optional `user_id` linking the record to
a learner account.

## Relationships

```text
public.users (school admin) -> public.school_profiles
  -> public.school_teachers -> teachers
  -> mgmt.classes -> mgmt.sections -> mgmt.students
  -> mgmt.staff -> mgmt.departments / designations / payroll_records
  -> mgmt.fee_* / mgmt.exams / mgmt.exam_marks
  -> mgmt.books / vehicles / hostels / assets
mgmt.students.user_id (optional) -> public.users (learner)
```

## Ownership and access

- Owner: the school, through its admin user.
- Readers/writers: school staff for their own school only; platform admins
  for verification and support.
- Tenant isolation: `school_id` on every `mgmt` row; queries must always be
  school-scoped.
- A newly self-registered school is `verification_status = 'pending'` until
  an Akoro admin verifies or rejects it.

## Lifecycle

- Registered (pending) -> verified -> active.
- Rejected schools do not operate; pre-existing schools were defaulted to
  `verified` when the gate was introduced.
- Academic structure is per academic session; students are promoted between
  classes with `promotion_logs` recording the move.

## Agent guidance

- Never read or write another school's `mgmt` data.
- Never treat a `mgmt.students` record as a learner account; follow the
  optional `user_id` link and respect learner ownership from there.
- Do not verify a school; verification is an admin decision.

## Related

- [School platform](../01-features/school/overview.md)
- [Teacher model](teacher.md)
- [Learner model](learner.md)
- [Entity relationships](entity-relationships.md)
