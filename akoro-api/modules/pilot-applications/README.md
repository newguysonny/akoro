# pilot-applications

Public intake for the pilot-school application form used by the marketing
site's `/apply` page. It is the single unauthenticated write endpoint of the
Tiers & Credits plan (§4.2).

## Purpose

Owns submission of a pilot application: field validation, a short duplicate
guard, and insertion into `pilot_applications`. It does not own review,
approval, or account creation — those happen elsewhere.

## Entry points

`app.js` imports `modules/pilot-applications/routes.js` directly (there is no
`index.js`) and mounts it at `/api/public/pilot-applications` behind the
standard rate limit:

- `POST /api/public/pilot-applications` — submit one application.

The route accepts `school_name`, `state_city`, `est_students`, `contact_name`,
`contact_email`, `contact_phone`, and an optional `message` (snake_case or the
form's camelCase keys, normalised by the shared validator).

## How it works

- `validatePilotApplication` from `lib/tiersModel.js` normalises the body and
  returns `{ errors, values }`. Any error becomes `422` with a per-field
  `fields` map.
- Before inserting, the route looks for the same `contact_email` +
  `school_name` created in the last 24 hours. A hit returns `409`
  (`duplicate_application`) with a friendly message instead of a second row.
- A valid submission inserts the normalised values into
  `pilot_applications` and returns `201 { success: true }`.
- Database errors are logged server-side and answered with a generic `500`; no
  schema details are returned.
- There is no auth, no email send, and no notification from this route.

## How to extend

Change form rules in `lib/tiersModel.js` (`validatePilotApplication`) so the
route and the `/apply` form stay aligned; its contract test lives at
`lib/tiersModel.contract.test.mjs`. Keep the route limited to intake. Admin
listing and status changes belong in the admin module, and any cross-module
call must go through that module's `index.js` (`modules/README.md`); files stay
at or under 600 lines.

## Known limits

- The duplicate check is a read followed by an insert, so two simultaneous
  submissions can both pass; the guarantee is best-effort, not a unique index.
- The module has no tests of its own. Validation is covered by the shared
  `lib/tiersModel` contract test; the route's 409/422/201 behaviour is not.
- Rate limiting is only the app-wide `standardLimit` mounted in `app.js`; the
  module does not add its own limiter.
- No confirmation email or notification is sent, and there is no public status
  lookup for an applicant.
