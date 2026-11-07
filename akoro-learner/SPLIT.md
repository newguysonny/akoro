# Landing / app split — runbook

One codebase, two deployments, chosen by `VITE_TARGET` at build time (`src/config/target.js`):

| Site | Host | `VITE_TARGET` | Build |
|---|---|---|---|
| Landing (marketing, public blog, legal) | `akoro.name.ng` (+ `www`) | `landing` | `npm run build:landing` — no service worker |
| Learner app | `app.akoro.name.ng` | `app` | `npm run build:app` |
| Unsplit (local dev, today's deployment) | — | unset / `full` | `npm run build` |

Each site answers for its own paths and forwards the other's (old links keep working): `/signin` on the landing → `app.akoro.name.ng/signin`;
`/pricing` on the app → `akoro.name.ng/pricing`. `/` on the app → the dashboard (signed in) or `/signin`.
Overrides: `VITE_APP_URL`, `VITE_SITE_URL` (defaults are the two hosts above).

## Cut-over (infra — the part code can't do)

1. **Vercel**: create a second project from this repo (root `akoro-learner`). Project A (landing): env `VITE_TARGET=landing`. Project B (app): env `VITE_TARGET=app`.
   Both use the existing `vercel.json` / `scripts/build-with-chat.sh`; the script skips the AI-chat bundle for `landing` and `app`.
2. **Domains**: `akoro.name.ng` + `www` → project A; `app.akoro.name.ng` → project B. The wildcard `*.akoro.name.ng` and school custom domains stay on the
   current (unsplit) deployment until the school deployment takes them over (see below).
3. **API env (Render)**: `FRONTEND_URL=https://app.akoro.name.ng` (emails, links), `MAIN_SITE_URL=https://akoro.name.ng`; set `SITE_BASE_DOMAIN=akoro.name.ng` explicitly.
   (Code already treats a leading `app.` as not part of the base domain and reserves `app`, `admin`, `api`, `instructors`, `school`… from schools.)
4. **Sign-in providers** (Google etc.): add `https://app.akoro.name.ng/auth/callback` to the allowed redirect URIs before switching `FRONTEND_URL`.
5. **Old links**: emails already sent point at the old host — keep `akoro.name.ng` forwarding product paths (done by the landing build) for a long time.
6. **Users**: sessions don't carry across hosts (one re-sign-in); PWA installs are tied to the origin (reinstall from `app.`). The old service worker on
   `akoro.name.ng` is repaired by `sw-repair.js` on the next load of the landing build.

## Still to do (not in this change)

- Move the wildcard `*.akoro.name.ng` and custom-domain school sites (today rendered by the tenant guard in `src/main.jsx` on the learner deployment, plus the
  `/ai-chat` bundle) to the **school deployment**, on the primary domain. Needs the tenant guard ported to `akoro-school` and the Vercel wildcard re-pointed.
- Prune the landing bundle (today it still ships the app's lazy chunks; they are never loaded) — a separate `akoro-landing` package is the clean fix.
- The landing's "Install app" prompt: the landing has no manifest/service worker now; point it at `app.akoro.name.ng`.
