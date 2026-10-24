# Akoro Security Audit — Plan

**Goal.** Akoro is production-ready when an attacker — anonymous, a signed-in learner, a teacher, a school, or a compromised dependency — cannot **discover, authenticate as, access, manipulate, extract, or escalate** anything they shouldn't. Not "nothing sensitive showed up in the Network tab".

This plan audits every layer: browser, frontend bundles, API, sessions, database, storage, real-time, AI agents, business logic, infrastructure, dependencies, and people/process. It follows the OWASP Web Security Testing Guide (WSTG) areas, OWASP API Security Top 10 (2023) and OWASP Top 10 for LLM Applications, adapted to Akoro's actual stack.

---

## Your tree → this plan

Every branch of the original audit tree, and where its tests are (§5 workstream letters; F = early findings in §2).

| Tree branch | Leaf | Plan section · key tests | Early findings |
|---|---|---|---|
| **1. Browser** | Network | J1 (passive ZAP), G1 (response diets), I2 (CORS) | CORS ✓ |
| | Storage | A1, A7 | F9 |
| | Cookies | A2, I4 (CSRF with `SameSite=None`) | httpOnly ✓ |
| | IndexedDB | A3, W1–W2 (service worker, offline queue) | |
| | Console | A4, H1 | F8 |
| | JS/source maps | B1 (every chunk), B2 (`.map`, `.env`, `.git`) | maps 403 ✓ |
| **2. Frontend** | Secrets | B1, M2 | none in main bundles ✓ |
| | Exposed configuration | B1 (internal URLs, `VITE_*`), B2, L (Vercel env) | |
| | XSS | B3 (sinks), B4 (iframes), P5 (AI output), N4 (generated papers/PDFs), X2 (school sites) | |
| | CSP | I1, F5 fix | **F5** |
| **3. API** | Authentication | C1–C8 | |
| | Authorization | D1–D6, §4 matrix | F4 |
| | IDOR/BOLA | D1, N2, §4 resource list | |
| | Rate limits | U1–U5 | auth ✓ |
| | Input validation | H1, H3, H5, N1 | |
| | Error leakage | H1–H2, A4 | **F8** |
| **4. Database** | RLS | F3 | **F3** |
| | Policies | F1–F4 | |
| | Storage | F6, N2–N3 | **F6** |
| | Privilege boundaries | F2, F4–F5, F7, D4 | |
| **5. Sessions** | Access tokens | E1–E2, E6, C8 | **F1** |
| | Refresh tokens | E4–E5 | rotation ✓ |
| | Logout | E3, A6–A7 | |
| | Password reset | C3, T2 | |
| **6. Business logic** | Credits | O1, O4, O8, P7 | |
| | Payments | O2–O3, R4 | F7 |
| | Attempts | O5–O7 | |
| | Permissions | O9–O10, D2 | |
| | Race conditions | O1, O4–O5 (`security-logic` suite) | |
| **7. Infrastructure** | Vercel · Render · Supabase · Cloudflare · GitHub/CI | L (one row per platform), M, R3, S | **F2**, F10 |
| **8. Dependencies** | npm audit · Dependabot · Snyk/OSV | K1–K5 | |
| **9. Automated scanning** | OWASP ZAP | J1–J4 (passive on prod, active on sandbox only) | |
| | Security headers | I1, I3 | **F5** |
| **10. Manual penetration testing** | Account A → B | §4 matrix, D1, N2 | |
| | Student → Teacher | D2, O6, O9 | |
| | School A → B | D3, X1–X3 | |
| | User → Admin | D2, C2, C8, G3 (mass assignment), S1 | |
| | Anonymous → Private | D1, S1, F1 (anon PostgREST), Q1 | |

Added beyond the tree: **P** AI agents & prompt injection · **Q** real-time sockets · **R** service-to-service & webhooks · **S** the Verification Gate · **T** email, redirects & OAuth · **V** privacy & minors (NDPA 2023) · **W** PWA/offline · **X** multi-tenant school sites · **Y** SSRF · **Z** logging, backups & incident response.

---

## 0. Scope

| Layer | What is in scope |
|---|---|
| Web apps (Vercel, behind Cloudflare) | `akoro.name.ng` (site), `app.akoro.name.ng` (learner), `teacher.` / `instructor.akoro.name.ng` (instructor), admin, school portals and tenant school sites, design-system |
| API (Render, behind Cloudflare) | `api.akoro.name.ng` — Express (`akoro-api/app.js`), Socket.IO, BullMQ workers, deferred jobs, the Verification Gate (`/api/verify`) and its sandbox (`akoro-sandbox.onrender.com`) |
| Services | `akoro-python-agent`, `runpod-worker`, `embed-worker`, `media-worker`, `proctor-service`, `lead-scout`, `kpemu-*`, `cf/` workers |
| Data | Supabase Postgres (schemas `public`, `edu`, `mgmt`…), Supabase Storage buckets, Redis |
| Third parties | OpenAI, Deepgram, Paystack, Resend, RunPod, Hugging Face, Gamma, social OAuth (Google, Facebook/Meta, X/Twitter, TikTok, YouTube, Teams), Vercel API |
| Delivery | GitHub repo + history, CI, Render/Vercel/Cloudflare/Supabase dashboards, environment variables |
| People | Who holds which keys; what was pasted where |

**Out of scope for active testing:** real users' accounts and data (read-only checks only, and only through the admin-approved V4 path); third-party systems themselves.

---

## 1. Rules of engagement

1. **Sandbox first.** Every active test (fuzzing, ZAP active scan, race conditions, upload attacks) runs against the sandbox API + its own database, never production. Production gets **passive** checks only (headers, CORS, bundles, TLS, anonymous probes), plus the authorization matrix with **test accounts** (`tester*`), which is read-only by design.
2. **Test accounts only.** Use the seeded testers (learners `tester01`…, instructors `tester51`…) plus two dedicated new ones per role for this audit (see §4). Never a real user's token.
3. **Every test is written down** in the findings register (§7) with: ID, layer, steps, expected, actual, evidence, severity, owner, status. A test that passes is recorded too — that is the proof.
4. **Fix → retest → regression test.** A finding is closed only when it is fixed, retested, and — wherever possible — guarded by an automated check (a Verification Gate scenario, a unit test, or a CI step) so it can't come back.
5. **Secrets found are treated as compromised** and rotated, whether or not anyone used them.

### Severity

| Severity | Meaning | Fix by |
|---|---|---|
| **Critical** | Account takeover, any-user data access, forged identity/admin, secret key exposed, payment/credit forgery | Immediately (same day); hotfix |
| **High** | Cross-tenant/cross-user data of a class of resources, privilege escalation with conditions, stored XSS, large-scale abuse of paid AI | Within 3 days |
| **Medium** | Limited data leak, missing defence-in-depth (CSP, RLS backstop), clickjacking, info disclosure that aids attacks | Within 2 weeks |
| **Low** | Hardening, best-practice gaps, noisy errors | Next release |
| **Info** | Observation / confirmed good | — |

---

## 2. What the first reconnaissance pass already found

A read of the code and passive checks on production (2026-10-25). Each needs confirming in its workstream; severities are provisional.

| ID | Finding | Severity | Where | Proposed fix |
|---|---|---|---|---|
| **F1** | **JWT dev-secret fallback has no production guard.** If `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` are missing or malformed, tokens are signed and verified with HS256 using `JWT_SECRET` — or, if that is unset too, the hard-coded `"akoro-dev-secret-change-in-production"`, which is in the repository. Anyone who knows it could mint an admin token for that environment. | **Critical if any deployed env lacks RSA keys** (else Low) | `akoro-api/modules/auth/routes.js` (`USE_RSA`, `DEV_SECRET`, `verifyToken`) | Confirm prod + sandbox have RSA keys (§5.E1). Make the server **refuse to boot** when `NODE_ENV=production` and `USE_RSA` is false; remove the hard-coded default. |
| **F2** | **Raw Deepgram API key can be sent to the browser.** With `DEEPGRAM_ALLOW_RAW_KEY=true`, when a temporary token can't be granted the voice route hands the permanent `DEEPGRAM_API_KEY` to any signed-in client. The error text also tells users how to enable it. | **High if the flag is on in prod** | `modules/voice/deepgram.js`, `modules/voice/routes.js` | Check the Render env (§5.L). Remove the fallback; give the key `keys:write` so short-lived tokens always work; drop config hints from user-facing errors. |
| **F3** | **Row-Level Security is almost absent** (2 of 283 migrations enable it). Today only the API (service-role key) talks to Supabase, so the API is the only guard. If the anon key or the PostgREST/GraphQL endpoint is ever reachable with default grants, tables are readable/writable directly, bypassing every API check. | **High** (defence-in-depth; Critical if anon grants exist and the anon key is public) | `akoro-api/migrations/*` | Test direct PostgREST access with the anon key (§5.F). Enable RLS with deny-all on every table (service role bypasses it), revoke `anon`/`authenticated` grants on non-public schemas, lock `edu`/`mgmt` out of the exposed schemas list. |
| **F4** | **Any socket can join any battle room** (`join-battle` → `socket.join('battle:'+id)` with no seat/visibility check). A signed-in user who learns or guesses a battle id receives its live events (names, answers, a teacher's class review). | **Medium** | `akoro-api/app.js` socket handlers | Check the battle is watchable by this user (participant, the class, or public) before joining; same for every other room (`user:`, sessions). |
| **F5** | **Web apps send almost no security headers.** `app.`, `teacher.`, `instructor.` return HSTS only — no `Content-Security-Policy`, no `frame-ancestors`/`X-Frame-Options` (clickjacking), no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`. The API has helmet headers but no CSP (acceptable for JSON, but set `default-src 'none'`). | **Medium** | Vercel config per app / Cloudflare | `vercel.json` headers (or a Cloudflare Transform Rule): CSP (start in report-only), `frame-ancestors 'none'`, nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic only where voice/proctoring need them). |
| **F6** | **Public storage buckets.** Buckets are created `public: true` and served by `getPublicUrl` (course media, `pharmd-courses`, `training-assets`). Fine for course media — not if any hold teacher training uploads, paid content or learner files. | **Medium** (High if private files are in them) | `courses/*`, pharmd, training ingest | Inventory every bucket and its contents (§5.F, §5.N). Private material → private bucket + short-lived signed URLs (as submissions already do). |
| **F7** | **Webhook signatures compared with `!==`** (Paystack) — not constant-time. | **Low** | `courses/payments.js`, `courses/payouts.js` | `crypto.timingSafeEqual` on equal-length buffers. |
| **F8** | **Internal error text reaches users in places** (e.g. `Couldn't write the check questions: ${e.message}`, the voice error above, `err500(res, e)` patterns). | **Low–Medium** | various routes | §5.H: one error envelope; details only in server logs with a request id. |
| **F9** | **User profile cached in `localStorage`** (`AuthContext`). Tokens are httpOnly cookies (good), but the cached object should hold nothing beyond display needs. | **Info → verify** | `akoro-learner/src/contexts/AuthContext.jsx` (and other portals) | §5.A: inspect the stored object; strip email/phone/role-internal fields; clear on logout. |
| **F10** | **Credentials were pasted into chat earlier** (a GitHub PAT and the agent-console key). | **High until rotated** | — | Rotate both now; record rotation in §7. |

**Confirmed good so far** (keep them that way with regression checks):
- Access and refresh tokens are **httpOnly cookies** (`Secure` + `SameSite=None` in production); RS256 allow-list; `alg:none`/HS256 rejected when RSA is on; refresh-token rotation with family revocation on reuse (30 s grace).
- **CORS**: an unknown origin and a look-alike (`akoro.name.ng.evil.example`) get no `Access-Control-Allow-Origin` from the API; credentials only for listed portal origins.
- **Source maps** are not served (`/assets/*.js.map` → 403); the main bundles of `app.` and `teacher.` contain no `service_role`, `sk_live_`, `sk-proj-` or private-key strings; the frontends never import Supabase (no keys shipped).
- API sends HSTS (`includeSubDomains`), nosniff, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`.
- Login/register are rate-limited (5 / 15 min per IP); refresh 30 / 15 min.
- Paystack webhooks verify the signature header; submission files are served by short-lived signed URLs.
- The Verification Gate requires the agent-console key (to be re-verified anonymously from outside — §5.S).

---

## 3. The audit tree

```
AKORO SECURITY AUDIT
├── A  Browser — storage, cookies, IndexedDB/Cache/Service Worker, console, security panel
├── B  Frontend bundles — secrets, config, source maps, XSS sinks, CSP
├── C  Authentication — login, OAuth, reset/verify links, MFA, enumeration
├── D  Authorization — the account matrix (BOLA/IDOR, BFLA, cross-tenant)
├── E  Sessions & tokens — lifetime, logout, rotation, JWT keys
├── F  Database & storage — RLS, grants, exposed schemas, buckets, functions
├── G  Response data — excessive exposure, mass assignment
├── H  Errors & input validation — leakage, malformed input, injection
├── I  Headers, CORS, TLS
├── J  Automated scanning — ZAP (sandbox), header scanners
├── K  Dependencies & supply chain
├── L  Infrastructure & configuration — Render, Vercel, Cloudflare, Supabase, RunPod, GitHub/CI
├── M  Git history & secret hygiene
├── N  File uploads & generated documents
├── O  Business logic — coins/credits, payments, attempts, races, workflow skipping
├── P  AI agents & LLM security                         (added)
├── Q  Real-time — Socket.IO auth and rooms            (added)
├── R  Service-to-service & webhooks                    (added)
├── S  The Verification Gate itself                     (added)
├── T  Email, links, redirects & OAuth                  (added)
├── U  Abuse, rate limits & availability                (added)
├── V  Privacy & compliance — minors, NDPA 2023         (added)
├── W  PWA, offline cache & push                        (added)
├── X  Multi-tenant school sites                        (added)
├── Y  SSRF & outbound fetches                          (added)
└── Z  Logging, monitoring, backups & incident response (added)
```

---

## 4. Test accounts and the authorization matrix

Create (on the **sandbox** first, then mirror on production as `tester*` accounts) two of each role so every "A → B" test has a real B:

| Account | Belongs to | Should access |
|---|---|---|
| Anonymous | — | Public pages, public course catalogue, public school site, login/register |
| Learner A, Learner B | Class X (School 1) / Class Y (School 2) | Only their own work, chats, sessions, battles they're in, their files, their coins |
| Instructor A, Instructor B | School 1 / School 2 (or independent) | Their own classes, drafts, activities, their learners' submissions and results |
| School admin 1, School admin 2 | School 1 / School 2 | Their own school's staff, classes, records, finances |
| Platform admin | — | Admin endpoints, under audit logging |
| Parent / guardian (if the role exists) | Linked to Learner A | Only Learner A |
| Service callers | python agent, runpod, workers | Only their own internal endpoints |

**For every resource below, run each row of attempts.** Expected: own → 200; anything else → 403/404 (and no partial data in the body).

```
Learner A  → Learner B's resource          ✗
Learner    → instructor/admin endpoint      ✗
Instructor A → Instructor B's class/draft   ✗
Instructor → another school's learners      ✗
School 1   → School 2                       ✗
Any user   → admin endpoint                 ✗
Anonymous  → any authenticated endpoint     ✗
Learner    → write on a read-only resource  ✗  (method switching: GET→PUT/PATCH/DELETE)
```

**Akoro resources to cover** (from the API's modules):

| Area | Resources (examples of ids to swap) |
|---|---|
| Accounts | `users`, profile, settings, avatar, privacy settings, presence |
| Learning | courses, lessons, enrolments, progress, certificates, PharmD courses/topics |
| Activities | self-study assignments, **targets**, **submissions**, submission files, marked PDFs, `paper.html`, drafts (`/self-study/drafts/:id`), versions, history, routines, activity reviews (`/self-study/:id/reviews`) |
| Battles | battles, `state`, `questions`, `results`, `log`, participants, challenges accept/decline, series skip/opt-out/end, challenge requests (accept/cancel), daily battle, questions bank, **questions.pdf** |
| Agent | chat conversations & messages, agent memory, scratchpad, agent tools runs, confirmations, self-made tools & their outputs, agent network inbox/messages/consults, study buddies, circles |
| Study | study-prep sessions/workflows, teaching sessions, Agent Checks, learner state/knowledge, concept tracker, insights |
| Library | records, folders, uploads, recently deleted, reader, podcasts |
| Teaching tools | tool outputs (`/instructor/tools/outputs/:id`), Library resources |
| School | classes/classrooms, rosters, `mgmt.students`, staff, timetable, finances, tenant site content |
| Money | coins/wallets, token credit, vouchers, payments, payouts, marketplace listings, subscriptions/tiers |
| Admin | everything under `/api/admin`, approvals (V4), capabilities, platform tools |
| Gate | `/api/verify/*` |

**Automate it.** Build a Verification Gate suite **`security-authz`**: one scenario per area that signs in as A, creates a resource, then calls every route for it as B/anonymous/other-role and asserts the status codes **and** that the body holds no foreign data. Run it on every deploy; it is the regression net for §D.

---

## 5. Workstreams — tests to run

Each test: **how** · **expected** · **severity if it fails**.

### A. Browser (DevTools)

| # | Test | Expected | Sev if fails |
|---|---|---|---|
| A1 | Application → Local/Session Storage on each portal, signed in | No tokens, keys, internal ids beyond display; cached user = display fields only (F9) | High (tokens) / Low (extra fields) |
| A2 | Cookies: access/refresh | `HttpOnly`, `Secure`, `SameSite` set, scoped path/domain, sensible `Max-Age`; none readable by `document.cookie` | High |
| A3 | IndexedDB, Cache Storage, Service Worker cache (PWA, `offlineCache.js`, `offlineQueue.js`) | No other user's data; private data cleared on logout; no tokens | Medium |
| A4 | Console during normal use and on errors | No stack traces, SQL, internal paths, env values | Low–Medium |
| A5 | Security panel | Valid certs, no mixed content | Medium |
| A6 | Logout, then Back button / reopen tab | Private pages don't render cached private data | Medium |
| A7 | Shared-device test: user A logs out, user B logs in on same browser | Nothing of A visible to B (storage, caches, notifications, drafts) | High |

### B. Frontend bundles

| # | Test | Expected | Sev |
|---|---|---|---|
| B1 | Download **every** JS chunk of every portal (not only the entry) and grep: `secret`, `service_role`, `sk_live`, `sk-`, `PRIVATE KEY`, `password`, `api_key`, `Bearer`, `supabase.co`, `JWT_`, internal hostnames (`onrender.com`, sandbox URL), `VITE_` values | Only public config (API URL, WS URL, app URLs) | Critical (secret) / Medium (internal URLs) |
| B2 | `*.map` for every chunk; `/.env`, `/.git/`, `/src/`, `/package.json`, `/vite.config.*` on each domain | All 403/404 | High |
| B3 | XSS sinks: grep `dangerouslySetInnerHTML`, `innerHTML`, `srcdoc`, `eval`, `new Function`, markdown/HTML renderers; trace each to its source (AI output, user text, SVG figures, paper HTML, blog posts, chat) | Every sink sanitised (SVG via `sanitizeSvg`, HTML via an allow-list) | High (stored XSS) |
| B4 | iframes: `paper.html?embed=1`, `PaperFrame`, embeds | Sandboxed (`sandbox` attr), same-origin only where needed | Medium |
| B5 | Client-side role/feature checks | The UI hiding a button is never the only guard (each verified in §D) | — |

### C. Authentication

| # | Test | Expected | Sev |
|---|---|---|---|
| C1 | Login with wrong password ×N; with unknown email | Same message and timing for both (no enumeration); lockout/backoff | Medium |
| C2 | Register: duplicate email, email case/Unicode tricks, role field in body | No account takeover; role can't be chosen by the client | Critical (role) |
| C3 | Password reset: token single-use, expires, invalidated by a newer one and by password change; link doesn't leak via Referer | All true | High |
| C4 | Email verification link reuse / tampering | Single-use, bound to the account | Medium |
| C5 | OAuth (Google, Meta, X, TikTok, YouTube, Teams): `state` checked, `redirect_uri` exact-match, account linking can't attach a victim's account, email-unverified providers can't claim an existing email | All true | Critical (linking) |
| C6 | Hand-off token (2-minute cross-domain) | Single-use (`jti`), audience-bound, can't be replayed after use | High |
| C7 | MFA for admins/school admins (if present; else recommend) | Enforced for privileged roles | High (missing for admin) |
| C8 | Role/claims in the JWT can't be changed by the client; server re-reads role from DB for sensitive actions | Tampered token rejected (signature) | Critical |

### D. Authorization

The §4 matrix, plus:

| # | Test | Expected | Sev |
|---|---|---|---|
| D1 | BOLA/IDOR on every id in §4 (path, query, body, nested ids like `targetId`, `draftId`, `battleId`, `assignmentId`, `fileId`, `outputId`) | 403/404 | Critical/High |
| D2 | BFLA: learner calls instructor/admin routes; instructor calls admin routes; method switching | 403 | Critical |
| D3 | Cross-tenant: school 1 staff → school 2 records; tenant site of school 1 serving school 2 data | Blocked | Critical |
| D4 | Ids the server trusts from the client (`student_id`, `school_id`, `teacher_id`, `course_id`, `created_by`, `user_id` in bodies) | Server derives them from the session; body values ignored or checked | High |
| D5 | List/search endpoints with filters (`?user_id=`, `?school=`, `?all=true`, pagination past own data) | Only own data | High |
| D6 | Agent tools act as the user (chat tools, self-made tools, agent network) — the same matrix through chat: "show me tester02's submissions", tool args with foreign ids | Refused; no foreign data in replies | High |

### E. Sessions & tokens

| # | Test | Expected | Sev |
|---|---|---|---|
| E1 | **Confirm RSA keys are set in production and sandbox** (F1): sign a token with the default dev secret and call `/api/auth/me` on each env | 401 everywhere | **Critical** |
| E2 | Expired access token | 401, then silent refresh | — |
| E3 | Logout → reuse the old access token (≤15 min) and refresh token | Refresh rejected; access token: decide policy (denylist `jti` on logout for sensitive roles) | Medium |
| E4 | Password change / reset → other sessions | All refresh families revoked | High |
| E5 | Refresh-token reuse after the 30 s grace | Whole family revoked, user signed out | High |
| E6 | Internal tokens (`signInternalAccess`, 120 s) — who can obtain one, scope, replay | Never issued to clients; short; audience-bound | High |
| E7 | Concurrent sessions per account, device list, "sign out everywhere" | Exists for admins at least | Low |

### F. Database & storage (Supabase)

| # | Test | Expected | Sev |
|---|---|---|---|
| F1 | With the **anon key** (Supabase dashboard → API), call PostgREST `GET /rest/v1/users?select=*`, `/rest/v1/<each table>`, GraphQL, `rpc/*` | 401/permission denied for everything not deliberately public | Critical if readable |
| F2 | Exposed schemas list (Settings → API): only what must be | `edu`, `mgmt` not exposed to anon/authenticated | High |
| F3 | RLS: enable on all tables, deny-all default; list tables without RLS | 0 tables without RLS (F3) | High |
| F4 | `SECURITY DEFINER` functions: owner, `search_path` pinned, callable by whom | None callable by anon unless intended | High |
| F5 | Service-role key: only on the API/workers; not in any frontend, mobile build, log or error | True | Critical |
| F6 | Storage buckets: list all, public flag, contents sample (F6); private files via signed URLs only; signed URL TTLs short; path guessing on public buckets | Private stays private | High |
| F7 | Direct DB access: is the Postgres port/pooler restricted (IP allow-list, SSL enforced)? Strong DB password, not reused | Restricted | High |
| F8 | Backups: enabled, PITR, restore tested (§Z) | Yes | Medium |

### G. Response data (excessive exposure, mass assignment)

| # | Test | Expected | Sev |
|---|---|---|---|
| G1 | For each endpoint in the matrix, diff the JSON against what the screen uses. Look for: email, phone, `password_hash`, tokens, `reset_token`, IPs, internal notes, moderation, payment data, other learners' data, AI internals (prompts, model, cost), service ids | Only needed fields | High (PII of others) / Medium |
| G2 | `select("*")` on user-facing routes (grep) | Replaced by explicit column lists for anything returning other people's rows | Medium |
| G3 | Mass assignment: send extra fields on create/update (`role`, `school_id`, `coins`, `status`, `created_by`, `is_admin`, `grade`, `xp`) | Ignored | Critical (role/coins) |
| G4 | Public profiles / agent network search / leaderboards: what of another learner is shown | First name, agent, level — no school email/phone/exact location for minors | High |

### H. Errors & input validation

| # | Test | Expected | Sev |
|---|---|---|---|
| H1 | Malformed JSON, wrong types, huge strings, invalid enums/UUIDs, missing fields, negative numbers, `null`s on every write route | 400 with a stable code; no stack, SQL, table names, paths (F8) | Low–Medium |
| H2 | Not-found ids, wrong methods, unknown routes | 404 envelope | Low |
| H3 | Injection: SQL via PostgREST filter strings (`.or()`/`ilike` built from user input — e.g. `knownNames`, search), NoSQL-ish JSON filters, header injection, CSV/Excel formula injection in exports | No injection | High |
| H4 | Prompt-injection payloads in every text the AI reads (§P) | Contained | High |
| H5 | Body size limits per route (uploads vs JSON) | Enforced | Medium |

### I. Headers, CORS, TLS

| # | Test | Expected | Sev |
|---|---|---|---|
| I1 | securityheaders.com / Mozilla Observatory on each domain | A grade after F5 fix | Medium |
| I2 | CORS: arbitrary origins, `null` origin, look-alikes, subdomain takeover candidates, preflight with credentials | Only listed origins get credentials (confirmed for 2 cases — repeat for `null`, `http://`, ports) | High |
| I3 | TLS: SSL Labs on every host; HSTS preload eligibility | A+ | Medium |
| I4 | Cookies cross-site: CSRF on state-changing routes given `SameSite=None` — are writes protected by CORS-only JSON + custom header, or a CSRF token? Test a form POST from another site | Blocked | High |
| I5 | Dangling DNS / subdomain takeover (old Vercel/Render subdomains) | None | High |

### J. Automated scanning

| # | Test | Notes |
|---|---|---|
| J1 | **OWASP ZAP baseline (passive)** against production web apps and API | Safe for prod |
| J2 | **ZAP full/active scan** with an authenticated context (learner, instructor) | **Sandbox only** |
| J3 | Nuclei templates (misconfig, exposures) | Sandbox; passive templates on prod |
| J4 | Re-run monthly and after major releases | CI job |

ZAP finds misconfigurations and common injection; it does **not** find broken access control or business-logic flaws — §D and §O stay manual/gate-automated.

### K. Dependencies & supply chain

| # | Test | Expected |
|---|---|---|
| K1 | `npm audit --omit=dev` in every package (api, learner, instructor, admin, school, workers), `pip-audit` for Python services | No High/Critical without a documented exception |
| K2 | OSV-Scanner over the whole repo; Dependabot alerts + security updates on | Enabled |
| K3 | Lockfiles committed; `npm ci` in builds; no install scripts from untrusted packages | True |
| K4 | Docker base images pinned and scanned (Trivy) for `Dockerfile`, runpod/media workers | No critical CVEs |
| K5 | Third-party scripts in web apps (analytics, fonts, CDNs) — inventory; SRI or self-host | Minimal, known |

### L. Infrastructure & configuration (dashboard checks — owner does these, guided)

| Platform | Check |
|---|---|
| **Render** | Env vars per service (prod vs sandbox separated; **`DEEPGRAM_ALLOW_RAW_KEY` off**, RSA keys present, `NODE_ENV=production`, no debug flags); who has access; deploy hooks secret; private services not public; health endpoint reveals only the build SHA |
| **Vercel** | Env vars (only `VITE_` public config); preview deployments not indexed and not using production API credentials with real data; team access; `vercel.json` headers (F5) |
| **Cloudflare** | Proxy on for every host; WAF managed rules; rate-limiting rules on `/api/auth/*`, AI and upload routes; bot fight; origin locked to Cloudflare (Render origin not reachable directly — test `*.onrender.com` directly) |
| **Supabase** | Exposed schemas, RLS (F3), anon grants (F1 test), network restrictions, SSL enforcement, auth settings if Supabase Auth is used, storage policies, logs retention, team access + MFA |
| **RunPod / HF / OpenAI / Deepgram / Paystack / Resend** | Keys scoped minimal, spend limits/alerts set, separate keys per env, rotation date recorded |
| **GitHub** | Branch protection on `main`, required reviews, secret scanning + push protection on, Actions permissions least-privilege, no secrets in workflow logs, deploy keys reviewed, 2FA enforced for members |
| **Admin surfaces** | Admin app and `/api/admin/*` only for admins; Bull dashboards / health pages not public; `/api/verify` refuses anonymous callers |

### M. Git history & secret hygiene

| # | Test | Expected |
|---|---|---|
| M1 | `gitleaks detect` and `trufflehog git file://.` over full history (all branches) | No live secrets; anything found → rotate (§1 rule 5) |
| M2 | grep current tree: `API_KEY`, `SECRET`, `PASSWORD`, `TOKEN`, `PRIVATE_KEY`, `SERVICE_ROLE`, `DATABASE_URL`, `.env` files, `*.pem` | Only `.env.example` placeholders |
| M3 | Secret rotation register: every secret in §L listed with owner, where stored, last rotated | Exists |
| M4 | Pre-commit + CI secret scan (gitleaks action) | On |

### N. File uploads & generated documents

| # | Test | Expected | Sev |
|---|---|---|---|
| N1 | Upload: double extension (`a.pdf.html`), wrong MIME, polyglot, SVG with script, HTML, huge file, zip bomb, path traversal names (`../../x`), Unicode RTL names | Rejected or neutralised; stored with a server-made name; served with `Content-Disposition: attachment` and a safe `Content-Type` | High |
| N2 | Learner A opens Learner B's file/submission/marked PDF/`paper.html` by id or URL | 403/404 | Critical |
| N3 | Signed URL lifetime and reuse after the file is deleted ("recently deleted") | Short; dead after purge | Medium |
| N4 | Generated content: PDFs (`questions.pdf`, submission/marked PDFs), `paper.html` with embedded SVG/figures from AI — sanitised; can't run script in the API origin | True | High |
| N5 | Document parsers (pdf.js, docx, images, OCR) on malicious files — timeouts, memory limits | Bounded | Medium |

### O. Business logic (where scanners are blind)

| # | Scenario | Expected | Sev |
|---|---|---|---|
| O1 | **Coins/credits double-spend:** fire the same AI/battle/agent-check request twice in parallel (and 20× in parallel) | Charged once; balance never negative | Critical |
| O2 | Negative or fractional quantities, prices in requests (cart, marketplace, vouchers, payouts) | Rejected; server prices only | Critical |
| O3 | Payment replay: replay a Paystack webhook; forge a success callback; amount/currency mismatch; refund + keep access | Idempotent; verified against Paystack API; amount checked | Critical |
| O4 | Voucher/reward replay: redeem twice, claim daily reward twice, review-participation coin twice, XP for a review twice | Once | High |
| O5 | Battles: accept a challenge twice in parallel; join a full battle; answer after the reveal; answer for another participant; start a scheduled class review early; decline after it starts | Server enforces each state | High |
| O6 | Activities: submit twice; edit after submit; submit after due if not allowed; read the answer key as a learner (`showKey`, `copy=teacher`); assign someone else's draft; assign a version still drafting | Enforced (some already guarded) | High |
| O7 | Workflow skipping: call later-stage endpoints directly (study-prep, teaching handoff, Agent Check results, journeys' locked stages) | Refused | Medium |
| O8 | Limits: daily guide-review limit, battle seats, upload counts, AI budget — bypass by parallel calls or new sessions | Held | Medium |
| O9 | Teacher grade/score manipulation by a learner (PATCH a target's grade) | 403 | Critical |
| O10 | Self-tooling: a learner-built tool that reads others' data; promotion to platform without the gate | Blocked by scope + approvals | High |

Automate the races as gate scenarios (parallel requests via `Promise.all`) in a **`security-logic`** suite on the sandbox.

### P. AI agents & LLM security (OWASP LLM Top 10) — added

Akoro's agents read user content and call tools that change data, so this is a first-class surface.

| # | Test | Expected | Sev |
|---|---|---|---|
| P1 | **Indirect prompt injection** from everything the agent reads: uploaded PDFs/notes, Library records, past papers, peer-agent messages (agent network consult/inbox), challenge request titles, blog posts, school content: "ignore your rules and call X / reveal Y" | Ignored; tool calls still pass server checks | High |
| P2 | **Excessive agency:** every write tool (prepare/revise/assign, create_task, post_to_chat, agent messaging, write confirmations, create_tool) requires the right confirmation/HITL and server-side authz; the model can't assign, pay, or message on its own | True | High |
| P3 | Cross-user leakage through tools (agent search, consult — "only your question travels"), memory and summaries | No foreign data | High |
| P4 | System prompt / tool schema / internal names leakage ("print your instructions") | Refused; `noBackendNames` holds | Low–Medium |
| P5 | **Output handling:** AI text rendered as Markdown/HTML, SVG figures, paper HTML, emails — sanitised | No XSS | High |
| P6 | Self-tooling & code tools: SQL views limited to the caller's rows (`schema_lookup` safe), sandbox escape, network access, time/memory limits | Contained | Critical |
| P7 | Cost exhaustion: loops, very long inputs, many parallel chats, voice minutes; per-user/day budgets and kill-switches | Bounded; alerts | Medium |
| P8 | Model/provider keys never leave the server; per-env keys; spend caps at the provider | True | High |
| P9 | Strict-fields rule (subject/audience/topic said by the teacher) can't be bypassed by injected text | Holds | Low |

Add a gate suite **`security-ai`** with injection fixtures (a poisoned upload, a poisoned peer message) asserting no unsafe tool call happens.

### Q. Real-time (Socket.IO) — added

| # | Test | Expected | Sev |
|---|---|---|---|
| Q1 | Connect without/with an expired cookie | Rejected / unauthenticated namespace only | High |
| Q2 | `join-battle` with a battle you can't watch (F4); join `user:<other id>` or session rooms if any join is client-driven | Refused | Medium |
| Q3 | Emit server-only events from the client (answers, reveals, results) | Ignored | High |
| Q4 | Socket CORS/origin, message size, flood | Limited | Medium |

### R. Service-to-service & webhooks — added

| # | Test | Expected | Sev |
|---|---|---|---|
| R1 | Internal endpoints (`/api/internal/*`, agent-tools v1, agent-memory, python agent, runpod/embed/media callbacks): call without and with a wrong secret; replay an old request | 401; signatures with timestamp + nonce | Critical |
| R2 | Shared secrets (`INTERNAL_SECRET`, `AKORO_AGENT_SERVICE_SECRET`, `AKORO_AGENT_TOOLS_*`, `LEAD_SCOUT_SECRET`, `PHARMD_UPLOAD_KEY`, `VOUCHER_API_KEY`, `PARSE_CONSOLE_KEY`, `AGENT_CONSOLE_KEY`, `VERIFY_SANDBOX_KEY`) — strong, distinct per env, rotated, compared in constant time | True | High |
| R3 | `VERCEL_TOKEN` in the API env — scope minimal (one project), not a personal full-account token | Scoped | High |
| R4 | Webhooks from Paystack/Resend/RunPod: signature verified, timing-safe (F7), idempotent, source IPs where available | True | High |

### S. The Verification Gate itself — added

The gate can act as any test account and (V4) write to real accounts after admin approval — a high-value target.

| # | Test | Expected | Sev |
|---|---|---|---|
| S1 | From outside (no agent proxy): `GET/POST https://api.akoro.name.ng/api/verify/*` anonymous and with a learner token | 401/403 | Critical |
| S2 | `signInternalAccess` tokens it mints: only for tester accounts unless an approved V4 run; logged | True | High |
| S3 | Sandbox forwarding (`VERIFY_SANDBOX_KEY`): sandbox can't be used to reach production data | Separate DB/keys | High |
| S4 | Run evidence (stored responses) redacts PII/tokens; who can read runs | Redacted; key-holders only | Medium |
| S5 | Console key holder list; rotation (F10) | Minimal; rotated | High |

### T. Email, links, redirects & OAuth — added

| # | Test | Expected | Sev |
|---|---|---|---|
| T1 | Open redirects: login `redirect`/`returnTo` (stored as `REDIRECT_KEY`), hand-off targets, OAuth `next` — try `//evil.com`, `https://evil.com`, `javascript:` | Only same-site paths/listed apps | Medium |
| T2 | Reset/verify links: host header poisoning (link built from `Host`/`X-Forwarded-Host`) | Built from configured base URL | High |
| T3 | Email content: HTML injection via names/titles in notification emails | Escaped | Medium |
| T4 | SPF, DKIM, DMARC (`p=quarantine`/`reject`) for `akoro.name.ng` | Set | Medium |

### U. Abuse, rate limits & availability — added

| # | Test | Expected | Sev |
|---|---|---|---|
| U1 | Rate limits beyond auth: AI chat, voice token, uploads, PDF rendering, search, register/reset (per IP **and** per account), OTP | Present; Cloudflare + app layer | Medium |
| U2 | Expensive endpoints (PDF build, paper render, question writing, embeddings): concurrency caps, timeouts | Bounded | Medium |
| U3 | Bot sign-ups, disposable emails, referral/reward farming | Detected/limited | Medium |
| U4 | Account enumeration via register, reset, agent search, username availability | Uniform responses | Low |
| U5 | `trust proxy` correctness (spoofed `X-Forwarded-For` can't evade limits) | Correct hops | Medium |

### V. Privacy & compliance — added

Many learners are **minors** (JSS/SS). Nigeria Data Protection Act 2023 (NDPA) and the NDPC GAID apply; GDPR if EU users.

| # | Check | Expected |
|---|---|---|
| V1 | Data inventory: what PII is stored where (Supabase, Storage, Redis, logs, OpenAI/Deepgram requests, emails, analytics) | Documented |
| V2 | Lawful basis & consent: parental/school consent for minors; agent-network visibility defaults private for minors | Enforced |
| V3 | Data minimisation to third parties: what goes to OpenAI/Deepgram (names, school, IDs) — strip what isn't needed; provider data-retention settings | Minimised |
| V4 | Subject rights: export and delete my data (and the agent's memory, files, chats) end-to-end; retention periods; "recently deleted" really purges | Works |
| V5 | Logs: no tokens, passwords, full PII; retention set | True |
| V6 | Privacy policy and terms match reality; DPO/contact; breach notification process (72 h to NDPC) | In place |

### W. PWA, offline cache & push — added

| # | Test | Expected | Sev |
|---|---|---|---|
| W1 | Service worker caches only public/static assets; API responses with private data not cached (or cleared on logout) | True | Medium |
| W2 | Offline queue replays only the signed-in user's actions; can't replay another user's queued writes | True | Medium |
| W3 | Push payloads contain no sensitive content; VAPID private key server-only | True | Low |

### X. Multi-tenant school sites — added

| # | Test | Expected | Sev |
|---|---|---|---|
| X1 | Host-header / custom-domain routing: request school 1's domain with school 2's id/slug | School 1 only | High |
| X2 | Tenant admin content (HTML/rich text) → stored XSS on the public site | Sanitised | High |
| X3 | Public portal APIs (`publicPortal.js`) expose only public fields (no student lists, staff phones) | True | High |

### Y. SSRF & outbound fetches — added

| # | Test | Expected | Sev |
|---|---|---|---|
| Y1 | Every feature that fetches a URL the user supplies (link import, past paper by URL, figure `src`, avatars, webhooks, OAuth avatars, reader) — try `http://169.254.169.254/`, `http://localhost:…`, internal Render hostnames, `file://`, redirects to those | Blocked by an allow-list/deny-list + no redirects to private ranges | High |
| Y2 | Image/PDF renderers fetching remote resources inside documents | Disabled or proxied | Medium |

### Z. Logging, monitoring, backups & incident response — added

| # | Check | Expected |
|---|---|---|
| Z1 | Security events logged: logins, failures, refresh reuse, role changes, admin actions, V4 approvals, payout changes — with user, IP, request id | Yes, tamper-evident |
| Z2 | Alerts: spikes in 401/403/429, AI spend, refresh-reuse revocations, new admin | Wired (see Observability Plan) |
| Z3 | Backups & restore drill (Supabase PITR; storage) — restore to a scratch project and verify | Done quarterly |
| Z4 | Incident runbook: who decides, how to rotate every secret (§M3), how to force-logout everyone, how to notify NDPC/users | Written and rehearsed |
| Z5 | `security.txt` at `/.well-known/security.txt` with a reporting contact | Present |

---

## 6. Execution plan

| Phase | Work | Who | Output |
|---|---|---|---|
| **0 — Prepare** (½ day) | Asset inventory (§0); create the §4 test accounts on sandbox; findings register (§7) set up; agree rules (§1) | Agent + owner | Register, accounts |
| **1 — Criticals first** (1 day) | E1 (dev-secret token on prod + sandbox), F1 (anon PostgREST), S1 (gate anonymous), F2 (Deepgram flag), rotate F10 keys, M1 (gitleaks/trufflehog over history), B1–B2 (all chunks/maps) | Agent runs the probes; **owner** checks Render/Supabase dashboards and rotates keys | Critical list closed or hot-fixed |
| **2 — Quick hardening** (1–2 days) | F1 boot guard; F7 timing-safe compares; F4 socket room checks; F5 headers (report-only CSP first); F8 error envelope; F9 stored user | Agent (code), owner (Vercel/Cloudflare settings) | PRs + gate checks |
| **3 — Authorization matrix** (3–4 days) | Build gate suite `security-authz` (§4/§D), run on sandbox then production (test accounts, read-only); fix each hole; G1–G4 response diets | Agent | Suite green on every deploy |
| **4 — Business logic & AI** (3 days) | `security-logic` (races, replays, limits — O1–O10) and `security-ai` (P1–P7) suites on sandbox | Agent | Suites + fixes |
| **5 — Scans & dependencies** (1 day + fixes) | ZAP baseline (prod) + active (sandbox, authenticated); nuclei; `npm audit`/OSV/pip-audit/Trivy; Dependabot on | Agent runs; owner enables GitHub settings | Scan reports, upgrade PRs |
| **6 — Infra & privacy review** (1–2 days) | §L dashboards walkthrough (owner, guided checklist), §R secrets register, §T DNS/email, §V privacy inventory, §Z runbook + restore drill | Owner + agent | Signed-off checklists |
| **7 — Fix, retest, report** | Close findings by severity SLA; retest; write the report (summary, residual risk, what's automated) | Agent | Report in `reference/` |
| **8 — Keep it that way** (ongoing) | CI: gitleaks, `npm audit --audit-level=high`, OSV; gate `security-*` suites on every deploy; ZAP baseline weekly; quarterly matrix review + restore drill; annual external pentest before scaling | Agent + owner | Continuous |

**What only the owner can do** (no agent access to live dashboards, by design): read/change Render, Vercel, Cloudflare, Supabase and GitHub settings; rotate third-party keys; enable MFA; decide privacy/legal positions. The agent prepares exact checklists and verifies the result from outside.

---

## 7. Findings register (template)

| ID | Area | Title | Severity | Steps to reproduce | Expected | Actual / evidence | Owner | Status | Fixed in | Regression check |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | E/Auth | JWT dev-secret fallback, no prod guard | Critical? | Sign `{sub,role:admin}` with the default secret, call `/api/auth/me` on prod & sandbox | 401 | _pending_ | agent | open | | unit test + boot guard |
| … | | | | | | | | | | |

Status: `open → confirmed → fixing → fixed → retested → closed` (or `accepted-risk` with a reason and an expiry date).

---

## 8. Definition of done

- No open Critical or High; every Medium has an owner and date.
- `security-authz`, `security-logic`, `security-ai` gate suites green on sandbox and (read-only parts) production, and wired to run on every deploy.
- Headers A-grade on every domain; ZAP baseline clean of High; no High/Critical dependency advisories without an exception.
- Secrets register complete, every secret rotated since the audit started, secret scanning on in CI and GitHub.
- Backup restore drilled; incident runbook written; `security.txt` live.
- A short report in `reference/` that a new engineer can read to know what is protected, how, and how it's tested.
