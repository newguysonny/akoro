# pharmd

PHARM.D course content: upload, parsing and the legacy-key hash backfill.

## Entry

`index.js` is the cross-module entry point. It re-exports
`runPharmdHashBackfill`, the batched admin backfill. The Express router is
mounted directly from `routes.js` by `app.js`.

## Extend

Keep key derivation in `hashBackfill.js`'s exported helpers so contract tests
can cover it without a database. Upload/parsing belongs in `uploader.js`.

## Limits

The backfill is batched by `limit`; callers repeat it until `checked < limit`.
