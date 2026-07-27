# Akoro Pre-Launch Security Checklist

> A deploy gate for shipping to production. Work top-to-bottom before flipping
> the MVP on. The **Must confirm** items are blockers; **Post-launch** items are
> tracked but not blocking. Companion to `ENGINEERING_GUARANTEES.md` (the coding
> rules) — this file is the *operational* gate.

_Last dependency audit: 2026-07-27._

---

## 1. Must confirm before launch (blockers)

These are **configuration**, not code — the code supports them, but a wrong prod
value is exploitable.

> **How to know these are green:** run the automated gate with your production
> env loaded — it checks every item below and exits non-zero if any blocker fails:
> ```
> cd akoro-api && NODE_ENV=production npm run preflight
> # add a live probe once deployed:
> npm run preflight -- --url=https://api.yourdomain.com
> ```
> ✅ = passed, ⚠️ = advisory (won't fail the gate), ❌ = blocker. Wire
> `npm run preflight` into your release/pre-deploy step so a red config can't ship.
> The live probe additionally confirms HTTPS, that a protected route returns 401,
> helmet headers, and that CORS won't reflect a foreign origin.

- [ ] **CORS is an explicit allowlist, never `*`.** Set `CORS_ORIGIN` to your real
      domains (comma-separated). `*` + `credentials: true` is unsafe and
      browser-blocked. The app already allows apex/www/any subdomain of the base
      domain(s) — you only list the roots.
- [ ] **All prod secrets set and rotated.** `JWT` keys, `PAYSTACK_SECRET_KEY` +
      webhook secret, `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`, `REDIS_URL`,
      `DATABASE_URL`. Rotate anything ever pasted into chat, logs, or a PR.
      Nothing sensitive is committed (only `.env.example` is tracked — keep it
      that way).
- [ ] **Demo/seed migrations are OFF in production.** Set
      `DB_DEPLOY_GROUPS=schema` on prod so the `demo` group (incl. the JSS 11
      test seed) never lands in the real database. Only the `schema` group runs.
- [ ] **Supabase Row-Level Security sanity check.** The API uses the
      service-role key (bypasses RLS by design). Confirm no anon/public client
      path reaches tables directly around the app-layer scoping. This is the
      single biggest "MVP vs. real" gap — verify it explicitly.
- [ ] **HTTPS everywhere** (API + all frontends) so Secure cookies transmit and
      tokens aren't sent in the clear.
- [ ] **Migrations run on deploy** as a pre-deploy/release step
      (`npm run db:migrate`), not on API boot. New tables (e.g. academic
      calendar) are created there.

## 2. Verify in the running app (blockers)

- [ ] Login/2FA/refresh are rate-limited (hit them and see `429`).
- [ ] An unauthenticated request to a protected route returns `401`, and a
      cross-tenant object id returns `404`/`403` (spot-check one BOLA path).
- [ ] Paystack webhook rejects a bad signature and accepts a real one
      (fulfillment is idempotent on replay).
- [ ] A logged-in instructor cannot read another school's data.

---

## 3. Dependency audit results (2026-07-27)

Ran `npm audit --omit=dev` across all services and remediated.

| Service | Before | After | Notes |
|---|---|---|---|
| akoro-api | 14 (1 crit, 10 high, 2 mod, 1 low) | **2 moderate** | crit `tar`, `axios` cluster, `ws`, `brace-expansion`, `form-data` all cleared |
| akoro-school | 4 (2 high, 2 mod) | **2 moderate** | high `ws` cleared |
| akoro-instructor | 4 (2 high, 2 mod) | **2 moderate** | high `ws` cleared |
| akoro-admin | 4 (2 high, 2 mod) | **2 moderate** | high `ws` cleared |

**What changed**
- `axios` → `^1.18.1` (within 1.x, non-breaking) — clears the axios SSRF/proto-
  pollution/DoS cluster and transitive `form-data`.
- `nodemailer` → `^9.0.3` (major) — clears SMTP/CRLF-injection advisories.
  Usage is the stable `createTransport`/`sendMail` API; email primarily goes via
  Resend, so exposure was already limited. **Smoke-test an outbound email** once
  in staging.
- `adm-zip` → `^0.6.0` (major) — clears the crafted-ZIP 4 GB allocation DoS.
  Usage is `new AdmZip(buffer)` + `getEntries()`; app-layer zip-bomb/traversal
  guards remain in place. **Smoke-test a template upload** once in staging.
- API `overrides`: `tar ^7.5.22` (clears the **critical** node-tar path-traversal
  cluster — a build-time transitive of `bcrypt`), `ws ^8.21.1`,
  `brace-expansion ^5.0.8`, `form-data ^4.0.6`.
- Frontends: `react-router-dom` → `^6.30.1` (latest 6.x) + transitive `ws` fix.

**Remaining (2 moderate per project) — accepted for MVP, tracked post-launch**
- **API — `uuid` (moderate):** missing buffer bounds check only when a `buf`
  arg is passed. We call `v4()` with no buffer → **not exploitable**. Bump when
  moving to `node-cron` v4 / `uuid` v11+.
- **Frontends — `react-router` (moderate):** fix requires the **v7 major**
  migration. The two advisories: (1) open-redirect via backslash in
  `<Link>`/`useNavigate` — low risk, only if navigating to user-controlled URLs;
  (2) SSR hydration constructor injection — **not applicable**, these are
  client-only Vite SPAs (no SSR). Schedule the v7 upgrade, not a blocker.

---

## 3b. API endpoint security — standard best-practice coverage

Cross-checked against common API-security guidance. All **already implemented**;
listed here so it's on record and stays true for new endpoints.

| Practice | Status | Where |
|---|---|---|
| Validate JWT signature, `exp`, `aud` on every request | ✅ | `authenticateToken` — also `alg` allow-list (rejects `none`), `iss`, `jti` deny-list, `force_logout_at` |
| Authorize per-resource; prevent BOLA/IDOR | ✅ | Per-query owner scoping + `requireOwnership()` guard (logs `BOLA_ATTEMPT`, 404 on miss, 403 on mismatch) |
| Tiered rate limits, keyed by **user** then IP, `429` + `X-RateLimit-*` headers | ✅ | `middleware/security.js`: `strictLimit`/`refreshLimit` (IP) for auth, `standardLimit`/`teachingLimit`/`aiLimit` (`userOrIpKey`); `standardHeaders:true` |
| Input validation / schema enforcement | ✅ | Zod `validate(schema, source)` factory (422 on fail); `express-validator` rules on auth |
| Mass-assignment protection (DTO / field allow-list) | ✅ | `cleanBody(cfg, body)` accepts only declared `fields`; security fields (e.g. `two_factor_enabled`) excluded from PATCH allow-lists |
| Parameterized queries (no SQL string concat) | ✅ | Supabase/PostgREST throughout; `.or()`/`.ilike()` inputs sanitized |
| Secure data exposure — never return hashes/tokens | ✅ | `safeUser`, `sanitizeMgmtRow` (`ALWAYS_SECRET_COLS`/`ADMIN_ONLY_COLS`), settings key masking |
| Structured security logging, no secrets | ✅ | `securityLog` + `scrub()` redacts password/token/secret/authorization/cookie/jti/private_key/credit_card; `requestLogger` logs `HTTP_ERROR` for ≥400 |
| Generic errors; no stack traces to clients | ✅ | Global handler → "Internal server error"; `stack` only when `config.isDev`; 404 → "Route not found" |
| Security headers | ✅ | `helmet` |
| CORS restricted to trusted origins | ✅ | Allow-list + subdomain-aware `corsOriginFn`; `credentials:true` (never `*` in prod — see §1) |

**Gaps found (tracked in §4, not blockers):**
- **No anomaly *alerting*.** Security events are logged but nothing watches them —
  no alert on a spike in 401/403 (credential stuffing) or 404 (endpoint
  enumeration). Wire the stderr `securityLog` stream into a log aggregator with
  threshold alerts.
- **Zod `validate()` not applied to every write endpoint.** The generic mgmt
  resources rely on `cleanBody` allow-lists (stops mass assignment) rather than
  full shape/type validation. Add schemas to high-value write paths over time.

## 4. Post-launch (tracked, non-blocking)

- [ ] Add CSP headers on the frontends (helmet CSP is intentionally off for the API).
- [ ] Wire `npm audit` / Dependabot into CI so new advisories surface automatically.
- [ ] Migrate `react-router` to v7 across school/instructor/admin.
- [ ] Move rate-limit state to shared Redis when scaling beyond one API instance
      (limits are currently per-instance by IP).
- [ ] Add automated tests that lock in the security invariants (BOLA scoping,
      webhook idempotency, filter-injection sanitizing).
- [ ] **Anomaly detection/alerting**: forward `securityLog` (stderr JSON) to a log
      aggregator and alert on 401/403 spikes (credential stuffing) and bursts of
      404s (endpoint enumeration).
- [ ] **Broaden Zod schema validation** from auth to the remaining high-value
      write endpoints (generic mgmt resources currently use `cleanBody` allow-lists).
- [ ] Independent penetration test before large-scale onboarding / marketing —
      this remediation is code-level reasoning + dependency audit, not a pen-test.

---

## 5. Compliance note (student data + payments)

This app stores **minors' personal data** and processes **payments**. Before
scaling beyond an early friendly-user MVP, confirm: a privacy policy + data-
retention stance, parental-consent handling, PCI scope (kept minimal by
delegating card handling to Paystack — never store PANs), and breach-response
basics. Not launch blockers for a small MVP, but do not defer indefinitely.
