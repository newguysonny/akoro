# akoro cron-ticker

A ~40-line Cloudflare Worker that is the **edge clock** for the API's
scheduled jobs. It fires on Cloudflare's cron triggers and pokes the
API's internal tick endpoint — it carries no business logic. The API
owns *what* each tick does (`lib/cronTicks.js` + the registered
functions); this owns *when*.

Why it exists: `node-cron` schedules died with the API process (missed
during every deploy/restart, drifted with server timezone, and never
fired while a free Render instance slept). Edge cron fires on time,
wakes the instance, and costs nothing.

## Setup

```bash
cd cf/cron-ticker
npx wrangler login
npx wrangler secret put API_BASE_URL      # https://akoro.onrender.com
npx wrangler secret put INTERNAL_SECRET   # the API's own INTERNAL_SECRET
npx wrangler deploy
```

Done — the Worker deploys with three cron triggers (see `wrangler.toml`):

| Cron (UTC) | Tick | What it runs in the API |
|---|---|---|
| `20 2 * * *` | `ladder-prewarm` | prewarms curriculum ladders (the `LADDER_PREWARM_CRON` default) |
| `0 3 * * *` | `decay-scheduler` | the nightly forgetting-curve pass + review alerts |
| `30 3 * * *` | `pilot-expiry-check` | pilot-ending reminders + cohort expiry sweep |

## Flip it on (the API side)

Set on Render:

```
CRON_SOURCE=cloudflare
```

That disarms the in-process `node-cron` schedules (no double-runs) and
leaves the registered ticks to be fired from the edge. Unset (default
`local`) → node-cron runs exactly as before and this Worker's pokes are
harmless (they run the same function, guarded against overlap — but
don't leave both clocks armed long-term).

## Notes

- **Timezone**: cron triggers fire in UTC. The old node-cron entries ran
  in the server's timezone — if that wasn't UTC, shift the times here.
- **Custom ladder schedule**: if you set `LADDER_PREWARM_CRON` on Render
  to something other than the default, mirror it in `wrangler.toml`
  crons **and** the `TICKS` map in `src/worker.js`.
- **Scaling**: this is a standard Worker — Cloudflare auto-scales it,
  scales it to zero between ticks, and cron triggers are included in
  the free tier. There is nothing to size. The box that executes the
  jobs (the API) is sized exactly as before.
- **Overlap**: if a tick is poked while its previous run is still going,
  the API answers `skipped: true` instead of piling runs up.
