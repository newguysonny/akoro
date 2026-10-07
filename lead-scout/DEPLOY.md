# Deploying lead-scout (separate service)

lead-scout runs as its **own** deployment, independent of `akoro-api`. The API
talks to it over HTTP via `LEAD_SCOUT_URL`. If that var is unset (or the
service is down), the admin Marketing page shows a clear "service not running"
error — it never breaks anything else.

It's a tiny pure-Python service (httpx + fastapi), so it fits the smallest CPU
plan and builds in seconds.

---

## Option A — Railway (Docker)

1. **New service from this repo.** Railway → New → Deploy from GitHub repo →
   pick `newguysonny/akoro`.
2. **Point it at this folder.** Service → Settings → **Root Directory** =
   `lead-scout`. The included `railway.toml` selects the Dockerfile builder and
   the `/health` healthcheck automatically.
3. **Set variables** (Service → Variables):
   ```
   LEAD_SCOUT_SECRET=<a long random string>   # must match akoro-api's copy
   # optional richer sources:
   GOOGLE_MAPS_API_KEY=<google places key>
   YELP_API_KEY=<yelp fusion key>
   ```
   (OpenStreetMap needs no key and always works.)
4. **Persist results (recommended).** Service → **Volumes** → add a volume
   mounted at **`/app/data`** so jobs/CSVs survive restarts. Without it,
   results live only in the ephemeral container filesystem.
5. **Deploy**, then Settings → Networking → **Generate Domain**
   (e.g. `https://akoro-lead-scout-production.up.railway.app`).
6. **Wire the API.** In the **akoro-api** service variables, set:
   ```
   LEAD_SCOUT_URL=https://akoro-lead-scout-production.up.railway.app
   LEAD_SCOUT_SECRET=<same secret as step 3>
   ```
   Redeploy / restart akoro-api so it picks them up.
7. **Verify.**
   ```
   curl https://<your-lead-scout-domain>/health
   # {"ok":true,"providers":{"osm":true,"google_maps":...,"yelp":...}}
   ```
   Then open the admin app → **Marketing** → run a search.

---

## Option B — Any Docker host / VM

```
docker build -t akoro-lead-scout ./lead-scout
docker run -p 8100:8100 \
  -e LEAD_SCOUT_SECRET=xxx \
  -e GOOGLE_MAPS_API_KEY=... -e YELP_API_KEY=... \
  -v $(pwd)/lead-scout-data:/app/data \
  akoro-lead-scout
```

---

## Notes
- **Auth:** if `LEAD_SCOUT_SECRET` is set, every request must carry
  `X-Internal-Secret: <secret>`. The akoro-api proxy adds this automatically, so
  set the SAME value on both services. Leave it unset only for local dev.
- **Sources:** Yellow Pages / Instagram / Facebook / Twitter are intentionally
  not scraped (ToS + login walls); selecting them just adds a job warning.
