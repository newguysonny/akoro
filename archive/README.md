# archive/

Code kept for reference only. Nothing here is built, deployed, imported or
tested; nothing outside this folder may import from it.

| Folder | What it is | Archived |
|---|---|---|
| `update18-2026-10-07/` | A 7 Oct 2026 snapshot of `akoro-api` and `akoro-learner` (129 files) left at the repo root. No deploy config and no references. The live code is `akoro-api/` and `akoro-learner/`. | 2026-11-02 (Grand Plan Phase 19, step 7) |

Not archived, though they are not part of the Akoro product. They deploy from
their own folders, so they move only after their hosting settings point at
the new path:

- `kpemu-agent/`, `kpemu-business/`: Vercel projects (root directory = the
  folder; `vercel.json` builds only when that folder changes).
- `lead-scout/`: a Railway service (Root Directory `lead-scout`, see its
  `railway.toml` / `DEPLOY.md`).

`cf/cron-ticker/` stays: it is Akoro's own scheduled-job clock (the
Cloudflare Worker that pokes `/api/internal/ticks`).
