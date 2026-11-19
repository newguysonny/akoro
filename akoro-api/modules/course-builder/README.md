# course-builder

Course-builder drafts that link to real courses and keep their fields in sync.

## Entry

`index.js` is the cross-module entry point. It re-exports `linkUnlinked`, the
backfill that adopts unlinked drafts. The Express router is mounted directly
from `routes.js` by `app.js`.

## Extend

Field mapping belongs in `link-map.js` so it stays pure and testable; database
writes belong in `link.js`.

## Limits

Linking is one-way at import time: later edits sync through the explicit
publish/sync functions, not automatically.
