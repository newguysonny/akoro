---
title: Teacher model
status: beta
doc_status: draft
tier: 2
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Teacher model

## What it represents

"Teacher" is three different things in Akoro's data, and they must not be
conflated:

1. **Instructor** — a `public.users` row with role `instructor`, who creates
   and teaches courses on the platform.
2. **School teacher** — a person attached to a school: a `public.users` link
   in `public.school_teachers`, a class-teacher assignment in
   `mgmt.class_teachers`, and/or an ERP staff record in `mgmt.staff`.
3. **Teacher agent profile** — `edu.teacher_profiles`, the trained
   teacher-guide agent used by the adaptive teaching system.

## Identifier

- `public.users.id` — UUID, for instructors and school-linked teachers.
- `mgmt.staff.id` — UUID, for the school ERP staff record (no user account
  required).
- `edu.teacher_profiles.id` — UUID; `teacher_id` is unique per user.

## Important fields

Instructor profile columns on `public.users` (added by the instructor
profile migration): `bio`, `country`, `school_name`, `school_type`,
`subjects` (text array), `language`, plus the base account fields in
[Learner model](learner.md).

`public.school_teachers`: `school_id`, `teacher_id` (both foreign keys,
unique together).

`mgmt.class_teachers`: `school_id`, `class_id`, `section_id`, `teacher_id`
(a `public.users` id); unique per `(class_id, section_id)`.

`mgmt.staff` includes `school_id`, `staff_no`, `first_name`, `last_name`,
`department_id`, `designation_id`, `employment_type`
(`full_time|part_time|contract`), `monthly_salary`, `joined_on`, `status`
(`active|inactive`).

`edu.teacher_profiles` includes `teacher_id`, `agent_id`, `teacher_name`,
`agent_name` (default `Pythia`), `subject`, `style_profile` (JSONB),
`concepts_taught` (text array), `total_hours_trained`, `session_count`,
`last_trained_at`.

## Relationships

```text
public.users (instructor) -> courses -> lessons / live_sessions
                          -> classrooms -> classroom_students
                          -> instructor_earnings / payouts
public.school_profiles -> school_teachers -> public.users (teacher)
mgmt.classes -> mgmt.class_teachers -> public.users (teacher)
edu.teacher_profiles -> edu.adaptive_sessions (teacher_agent_id)
```

## Ownership and access

- Owner: the instructor for their profile and courses; the school for its
  staff and class-teacher records.
- Readers: public instructor profiles are visible on published courses;
  staff records are school-private.
- Writers: the instructor (own profile), school staff (ERP records),
  the training system (teacher agent profiles).
- Tenant isolation: all `mgmt` teacher data is scoped by `school_id`.

## Lifecycle

- Instructor: registered -> (verification where required) -> active.
- Staff: `active` -> `inactive`; class-teacher assignments are replaced per
  class/section, not versioned.
- Teacher agent profile: created on first training; `session_count` and
  `total_hours_trained` grow with training sessions.

## Agent guidance

- Never assume an instructor is school staff, or a staff record has a user
  account.
- Never publish a course or change a staff record on a teacher's behalf
  without authorisation.
- Do not treat `edu.teacher_profiles` as a human record; it describes an
  agent trained by a teacher.

## Related

- [Instructor](../01-features/instructor/overview.md)
- [School model](school.md)
- [Course model](course.md)
- [Learner model](learner.md)
