# capability-requests

## Purpose

Structured intake for capabilities the platform does not yet have — a missing
tool executor, a missing learning component, or another gap — plus a small admin
triage router that moves each request through a fixed status list and notifies
the requester when a request ships. The task-agent tool is wired; the HTTP
router in this directory is present but not mounted.

## Entry points

- `modules/capability-requests/routes.js` exports a Router for
  `POST /`, `GET /` and `PATCH /:id`, intended for
  `/api/capability-requests`. **No file imports or mounts it today**; `app.js`
  has no capability-requests import.
- The live write path is `modules/tasks/tools/submit-capability-request.js`.
  The teacher/instructor task agent calls its `submit_capability_request` tool,
  which inserts directly into `public.capability_requests` after the user
  explicitly confirms.
- `migrations/2026-capability-requests.sql` creates the schema and the status
  constraint, but it is **not listed in `migrations/manifest.json`**, so deploy
  and boot migrations do not apply it; the table has to exist by another route.
  `modules/tasks/tools/index.js` registers the tool above; no other writer to
  the table exists in the API.
- There is no `index.js`; the router file's default export is the only public
  surface.

## How it works

- `public.capability_requests` stores `user_id`, `user_role`, `agent_id`,
  `source` (`executor` | `component` | `other`), `intent`, `missing_capability`,
  optional `closest_match`/`description`, `status`, and timestamps.
- Status values are constrained by the migration to `new`, `triaged`,
  `planned`, `shipped`, `declined`; `new` is the default.
- The intended `POST /` validates `intent` (≤300) and `missing_capability`
  (≤2000), plus optional `source`, `closest_match` and `description`, then
  inserts with the caller's id/role when present.
- The intended `GET /` and `PATCH /:id` are admin-only
  (`authenticateToken` + `requireRole(["admin"])`). The list can filter by
  status and returns an `open` count; the update validates the status and
  returns 404 for an unknown id.
- In the router, setting a request to `shipped` inserts a
  `public.notifications` row (`type: "capability_request"`) for the requester.
  This notification is best-effort and does not fail the update.

## How to extend

- If the HTTP surface is meant to be used, add the import and
  `app.use("/api/capability-requests", standardLimit, ...)` to `app.js` first;
  until then the admin triage routes are unreachable.
- Keep the table shape in sync across three places: the migration, the router's
  validators/insert, and `modules/tasks/tools/submit-capability-request.js`.
- Add an `index.js` before another module needs to import this one, and import
  other modules only through their `index.js`. Keep new files under 600 lines.
- Prefer one write path: either the task tool or the HTTP route, not two
  independently evolving inserts.

## Known limits

- `routes.js` is not mounted anywhere, so its triage endpoints and the
  shipped-notification path are dead code in the running API; the only live
  intake is the task-agent tool.
- The table's migration is absent from `migrations/manifest.json`, so a fresh
  database will not have `capability_requests`; the task tool would fail on
  insert until the SQL is applied manually.
- If mounted as written, `POST /` still has no auth middleware despite its
  header saying "authenticated"; it would accept anonymous rows with
  `user_id: null`, and never notify anyone.
- The router and the task tool duplicate the insert logic and validation
  limits, which can drift.
- There are no tests for the router or the tool, so the table constraint, the
  confirmation gate and the status transitions are unverified by CI.
- Protection today is the task runtime's own confirmation requirement; there is
  no per-user rate limit or duplicate suppression.
