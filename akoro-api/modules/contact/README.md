# contact

## Purpose

Public contact and partner intake for the marketing site, plus the admin inbox
that reads and triages those submissions. A visitor submits a message with a
kind of `contact` or `partner`; admins list/filter submissions and move them
between `new`, `read` and `archived`. Nothing is emailed or forwarded from here —
the table is the inbox.

## Entry points

- `modules/contact/routes.js` is imported directly by `app.js` and mounted as
  `app.use("/api/contact", standardLimit, contactModule)`. There is no
  `index.js`; the default export is the whole surface.
- `POST /api/contact` — public submission. Required: `name`, a valid `email`,
  and `message`. Optional: `kind` (`contact` | `partner`, default `contact`),
  `organisation`, `subject`.
- `GET /api/contact/messages` — admin list, optional `status` and `kind`
  filters, capped at 500 rows (default 200), plus an `unread` count.
- `PATCH /api/contact/messages/:id` — admin status update.

## How it works

- The POST body is validated with express-validator, including email
  normalization and length caps (name 200, organisation/subject 200, message
  5000). A validation failure returns 422 with a single user-facing message.
- The submission is inserted into `contact_messages` with the optional fields
  stored as null when absent.
- The two admin routes are wrapped in `authenticateToken` +
  `requireRole(["admin"])`.
- The list orders newest first and computes the `new` count for the inbox badge
  in a second lightweight query.
- The PATCH route validates the status against `new`, `read`, `archived`, uses
  `maybeSingle()`, and returns 404 when the id does not exist.

## How to extend

- Add fields to the validator array and to the insert object in the POST
  handler; keep the migration for `contact_messages` in sync.
- New inbox operations (for example assigning an owner) belong in this file
  next to the existing admin handlers.
- If the module grows beyond a single coherent router, import another module
  only through its `index.js` and keep any new file under 600 lines. A new
  module-level file would also need mounting, because there is no barrel.
- Do not send external notifications from this module without an explicit
  delivery step; it currently only persists rows.

## Known limits

- There is no `index.js` and no test file for this module, so validation, the
  status transition and the `unread` count are not covered by CI.
- The public endpoint is protected only by the global `standardLimit`: there is
  no CAPTCHA, per-IP submission cap, or duplicate suppression, so it can be
  used to fill the table.
- No email/SMS/webhook is sent on submission or status change; admins must poll
  the inbox through the API.
- `GET /messages` has no pagination cursor beyond `limit`; the header count is
  the only aggregate.
