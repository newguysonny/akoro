# profiles

Profile management and the teacher/school/admin roster API: classrooms,
student accounts, school teachers, course invites, and account settings.

## Purpose

Owns the three profile types — teacher, school, and admin — and the data behind
them: `users` profile fields, `classrooms`, `classroom_students`,
`school_profiles`, `school_teachers`, notification preferences, and the
teacher↔school and learner↔teacher link requests. It also owns course-invite
issuing and redemption.

## Entry points

`app.js` imports `modules/profiles/routes.js` directly (there is no
`index.js`) and mounts it at `/api/profiles`.

- `/me` (GET/PATCH), `/me/location`, `/me/notifications`, `/me/avatar`,
  `/me/deactivate`, `/me` (DELETE), `/onboarding-prefill`, `/teaching-guides` —
  the caller's own account.
- `/teacher/me`, `/teacher/classrooms[/:classroomId/students|/upgrade]`,
  `/teacher/invite`, `/teacher/students/import`,
  `/teacher/join-requests[/:id]` — teacher roster management.
- `/schools` and `/schools/:schoolId/...` — school creation, classrooms,
  teachers, and student adds; `/schools/:schoolId/teacher-requests...` for
  approvals.
- `/admin/schools`, `/admin/teachers` — platform-admin listings.
- `/instructor/students`, `/students/:userId` (PATCH),
  `/students/:userId/message` — learners a teacher teaches.
- `/invite/:token` (public preview) and `/invite/redeem` (signed-in learner).
- `/directory/schools`, `/directory/teachers`, `/me/school-link`,
  `/me/school-request`, `/me/teacher-link`, `/me/teacher-request`.

## How it works

- `routes.js` wires authentication middleware and `express-validator` chains to
  thin handlers; it keeps the default export and `/api/profiles` mount.
- `service-*.js` holds the orchestration by resource: `settings` (the caller's
  account), `teacher` (classrooms/students), `school` (school profiles,
  classrooms, teachers, admin listings), `students` (instructor roll, CSV
  import, edit, message), `invites` (signed course invites) and `links`
  (directories, onboarding prefill, school/teacher requests and join queues).
- `rules.js` holds pure predicates and normalisers (no database import):
  limits, profile projections, timezone validation, class-level parsing and CSV
  parsing.
- `store-*.js` holds every Supabase query (no Express import), grouped by
  users/settings, classrooms, schools and invites.
- All routes use `authenticateToken`; teacher/admin routes add
  `requireRole(["instructor", "admin"])`, and admin-only listings add
  `requireRole(["admin"])`. Input is validated with `express-validator`.
- Adding a student calls `findOrCreateStudent`: an existing account is reused,
  otherwise a `student` account is created with a temporary password and
  `must_change_password`. A welcome message is sent by nodemailer/SMS on a
  best-effort basis.
- Free limits: one classroom and 20 students per classroom. The paid upgrade is
  ₦5,000; the create/upgrade handlers enforce the counters.
- If the teacher belongs to an approved school, classrooms carry its
  `school_id` and added students are mirrored into the school SIS
  (`mgmt.students`) via `ensureSisRecord`.
- Course invites are signed by the auth module (`signCourseInvite`, typed
  `course_invite`, expiry clamped to 1–30 days), previewed publicly, and
  redeemed idempotently into `enrollments` with notifications.
- Teacher listings and messaging are scoped by `teachesLearner` (owned courses
  or an active classroom seat), not by the requested id alone.
- Role changes invalidate the auth user cache (`invalidateCachedUser`).

## How to extend

Add a handler in the matching `service-*.js` and register the route in
`routes.js` with its validator chain. Put pure predicates/normalisers in
`rules.js` and every Supabase query in `store-*.js`. Keep ownership checks in
the store query (`teacher_id`, `school_id`, `admin_user_id`) and in the service
before any read or write. Another module is used only through its `index.js`
(`modules/README.md`); files stay at or under 600 lines.

## Known limits

- `routes.js` is no longer an oversized baselined entry; the split files stay
  well under the 600-line limit.
- `upgradeClassroom` is a simulated upgrade with a TODO to add Paystack; it sets
  `is_upgraded` and a 9999 student limit without taking payment.
- Tests are source-contract only (`routes`, `invite`, and `students-ownership`
  contract tests); the route behaviour is not exercised against a database.
- Welcome-email and invite-email failures are logged and swallowed; the API
  still reports success.
- `GET /me` falls back to a base column projection when optional profile
  columns are missing, so fields added by pending migrations can be absent.
