# Landing / app split — runbook

## Folders and Vercel projects

The landing and the app are **the same folder** (`akoro-learner`) built twice with different env; the school is its own folder. That is three Vercel projects:

| Vercel project | Root Directory | Key env | Domains |
|---|---|---|---|
| landing | `akoro-learner` | `VITE_TARGET=landing` | `akoro.name.ng`, `www.akoro.name.ng` |
| app | `akoro-learner` | `VITE_TARGET=app` | `app.akoro.name.ng` |
| school | `akoro-school` | see `akoro-school/.env.example` | `akoro-school.akoro.name.ng`, `*.akoro.name.ng`, custom domains |


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
4. **Google sign-in: nothing to add for the app host.** Google redirects to the **API** (`GOOGLE_CALLBACK_URL`, `https://api.akoro.name.ng/api/auth/google/callback`), not to
   the app; the API then sends the browser on to `FRONTEND_URL/auth/callback`. So the Google console's "Authorized redirect URIs" must contain exactly the API address and
   it stays as it is — only change it if the API's own domain changes. (The app's `/auth/callback` is a page of ours, not something Google calls.)
5. **Old links**: emails already sent point at the old host — keep `akoro.name.ng` forwarding product paths (done by the landing build) for a long time.
6. **Users**: sessions don't carry across hosts (one re-sign-in); PWA installs are tied to the origin (reinstall from `app.`). The old service worker on
   `akoro.name.ng` is repaired by `sw-repair.js` on the next load of the landing build.

## School sites → the school deployment (done in code, needs the domain move)

`akoro-school` now serves both the portal and the schools' public sites: `src/main.jsx` classifies the host (`src/utils/siteHost.js`) — portal hosts
(localhost, `*.vercel.app`, `akoro-school.<base>`, `school.<base>`, and our reserved names `app`/`admin`/`api`/`instructors`…) boot the portal; any other host is a
wildcard school subdomain or a custom domain and is rendered by the API (`/api/school/site/by-host`), with `/apply`, `/pay`, `/results` forwarded to the API.
If the API says no school owns the host (404) the portal boots, so a mis-listed portal host can't lock admins out. Its build now also bundles the standalone
AI chat under `/ai-chat` (`scripts/build-with-chat.sh`, `vercel.json`).

Cut-over (infra): on the **school** Vercel project add env `VITE_API_URL` (the API) and, if the portal's host isn't `akoro-school.<base>`/`school.<base>`, `VITE_PORTAL_HOSTS`;
then move `*.akoro.name.ng` and the verified custom domains from the learner project to the school project. Explicit hosts (`akoro.name.ng`, `www`, `app`, `admin`,
`instructors`, `api`) stay on their own projects — Vercel serves an explicit domain before the wildcard. Check one school site, one custom domain, `/ai-chat` and the
portal after the move. The learner deployment's own tenant guard (`src/main.jsx`) is then dead code and can be removed.

## Bundles and the install button (done)

- The two builds drop each other's pages at build time: the landing JS went from 10.7 MB (192 files) to 0.9 MB (48 files); the app from 10.7 MB to 10.4 MB (the marketing
  pages are small). The landing no longer runs the presence heartbeat or the update prompt, and registers no service worker.
- The landing's "Install app" button opens `app.akoro.name.ng` (a PWA installs from its own origin).



## Addresses are configuration (done)

No domain is spelled in code. **API:** `lib/urls.js` — env vars `FRONTEND_URL`, `MAIN_SITE_URL`, `*_FRONTEND_URL`, `API_URL`, `GOOGLE_CALLBACK_URL`,
`SITE_BASE_DOMAIN`, with current-host defaults and a boot warning naming any that are unset in production. **Frontends:** `src/config/urls.js` per app
(`VITE_API_URL`, `VITE_SITE_URL`, `VITE_APP_URL`, `VITE_LEARNER_URL`, `VITE_INSTRUCTOR_URL`, …). Each app's `.env.example` lists them. A test
(`akoro-learner/src/config/urls.test.mjs`) fails if a retired or platform address creeps back into code.

Left alone on purpose: `JWT_ISSUER` / `JWT_AUDIENCE` (opaque claims inside issued tokens — changing them signs everyone out) and mailboxes
(`noreply@`, `hello@…akoro.app`: they need real mailboxes on a verified sending domain, so they're a mail-setup decision, not a URL).
