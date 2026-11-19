# programmes

The Program Courses admin API: generic academic programmes grouped into
sections, each holding courses and learning materials, plus the published
catalogue the learner app reads.

## Purpose

Owns the `edu` schema's programme hierarchy — `programmes`,
`programme_sections`, `programme_courses`, `programme_materials` — and the
`programme_log` activity feed shown on the admin home page. It also owns the
public, published-only view of that hierarchy.

## Entry points

`app.js` imports `modules/programmes/routes.js` directly (there is no
`index.js`) and mounts it at `/api/programmes`.

Public catalogue routes are registered before the admin guard:

- `GET /api/programmes/catalogue` — published programmes with published course
  counts.
- `GET /api/programmes/catalogue/:id` — one published programme → sections →
  published courses.
- `GET /api/programmes/catalogue/courses/:id` — one published course → its
  published materials.

Everything after `router.use(adminOnly)` requires `authenticateToken` plus
`requireRole(["admin"])`:

- `/overview`, `/log`, `/programs` and `/programs/:id` for counts, listings,
  create, edit, publish/unpublish, delete, section add/reorder, and programme
  reorder.
- `/sections/:id` for rename and delete.
- `/courses` for the cross-programme course list, `/courses/:id` for detail,
  edit, move up/down and delete.
- `/materials` for the cross-course material list, create, edit, move and
  delete.

## How it works

- Reads go through `db.schema("edu")`; all ids are opaque UUIDs supplied by the
  caller, and list endpoints enrich rows with sibling counts and parent names.
- Every write appends a line to `programme_log`, which is what the admin home
  page renders as "Updates".
- Status is `draft` or `published`. The catalogue filters it at every level, so
  a draft programme, course, or material never leaves the public API.
- Ordering is a `position` column. Section reorder and programme reorder take
  an explicit id list; course/material "move" swaps positions with its
  neighbour. `PATCH /programs/:id` with `years` replaces the section set.
- `material.type` is constrained to `pdf`, `video`, `audio`, `note`, `link`,
  or `slides`; unknown values fall back to `pdf` on create and are ignored on
  update.

## How to extend

Add new admin endpoints beside the matching section of `routes.js`, keep the
catalogue handlers published-only, and record a `logLine` for user-visible
writes. Use another module only through its `index.js` (`modules/README.md`);
keep files at or under 600 lines. If a new public view is added, register it
before `router.use(adminOnly)`.

## Known limits

- The module has no tests.
- `DELETE /programs/:id` deletes only the programme row; child sections,
  courses, and materials are cleaned up only if the database schema cascades.
- The programme list retries without `position` ordering when that column is
  missing, so an older schema silently falls back to `created_at`.
- Course create/update accept a `section_id` without checking that the section
  belongs to the same programme.
- Catalogue responses are assembled with several queries in memory; there is no
  pagination on any listing.
