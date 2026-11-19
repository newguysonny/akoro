# ranking

XP awards and the leaderboard.

## Entry

`index.js` is the cross-module entry point. It re-exports `awardXP` and the
`XP` amounts other modules award. The Express router is mounted directly from
`routes.js` by `app.js`.

## Extend

Add new XP reasons to the `XP` map and keep `awardXP` idempotent per event.

## Limits

Awards are best-effort: callers generally fire-and-forget and swallow errors so
a leaderboard problem never blocks the action that earned the XP.
