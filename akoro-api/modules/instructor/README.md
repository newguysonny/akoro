# instructor

The instructor / teacher dashboard API. It covers a teacher's profile, agent
settings, courses, live sessions, modules, materials, students, battles,
streaming/social credentials, and printable document templates, plus the
platform tool/asset catalogue instructors and schools buy from.

## Purpose

Owns teacher-facing reads and writes over the platform's course, enrolment,
classroom, and session tables, the `edu` document-template and platform-tool
tables, and the credentials stored in the caller's `user_settings`.

## Entry points

`modules/instructor/index.js` re-exports `routes.js`. `app.js` mounts it at
`/api/instructor`. `tools.js` is imported and mounted separately at
`/api/instructor/tools` (before the generic mount), and `schedule.js` exports
the pure `generateSchedule` helper.

Under `/api/instructor`, after `authenticateToken`:

- `/streaming`, `/streaming/connect`, `/streaming/:platform`, `/social`,
  `/social/connect`, `/social/:platform` — credential management for
  `instructor`, `admin`, `school`, `school_admin`, and `teacher`.
- `/stats`, `/profile` (+ `/notifications`, `/agent`) — dashboard summary,
  teacher/agent profile and preferences.
- `/classrooms`, `/classrooms/:id/students`, `/courses`, `/courses/upload`,
  `/sessions`, `/courses/:courseId/modules`, `/courses/:courseId/schedule/`,
  `/courses/:courseId/curriculum`, `/sessions/:id/materials` — course
  authoring and scheduling.
- `/students`, `/battles`, `/documents/templates/*`, `/documents/preview` —
  enrolment, battle CRUD, and template rendering.

Under `/api/instructor/tools`: `GET /`, `POST /checkout`,
`GET /verify/:reference`, `GET /purchases`, `GET /outputs[/:id]`, and
`/templates[/defaults]` CRUD.

## How it works

- `router.use(authenticateToken)` guards everything; the streaming/social
  routes accept school roles and are registered before
  `requireRole(["instructor", "admin"])` gates the rest.
- Lists are scoped to the caller. `/classrooms` includes classes the teacher
  owns plus classes of the school they administer, and the roster endpoint
  re-checks teacher, school-admin, or platform-admin access before reading.
- Course creation/upload calls `course-builder`'s `linkUnlinked` and records
  notifications through the local `notify`/`notifyMany` insert helpers.
- Scheduling splits pure recurrence expansion (`schedule.js`, WAT-stamped
  timestamps) from the preview/commit endpoints.
- Tools are priced in `edu.platform_tools`; kind `tool` is included free, paid
  assets use Paystack (`lib/paystackService.js`) and grant access in
  `edu.instructor_tool_access`. `audience` limits instructor vs school
  catalogues.
- Document templates use `edu` tables and are rendered by the school module's
  `renderDocument`; sample uploads can be turned into a template with a model
  call (`lib/aiModel.js`).

## How to extend

Add ordinary CRUD in the relevant section of `routes.js`, pure date/recurrence
logic in `schedule.js`, and catalogue/purchase behaviour in `tools.js`. Export
new public helpers through `index.js`; cross-module imports must target another
module's `index.js` (`modules/README.md`). Files stay at or under 600 lines.

## Known limits

- `routes.js` is 2020 lines and is baselined as oversized in
  `modules/structure-baseline.json`; it may only shrink.
- `index.js` exports only the dashboard router. The tools router is not
  re-exported, so `app.js` imports `tools.js` directly.
- Tests are source-contract only (`classroom-roster-ownership.contract.test.mjs`)
  and cover classroom roster ownership, not the other route groups.
- Uploads are held in memory by multiple; large documents depend on the
  configured cap, and AI template extraction falls back to a raw structure when
  the model call or JSON parse fails.
- Streaming/social credentials are stored as JSON in `user_settings`.
