# Akoro Engineering Guarantees

> **Read this before writing or reviewing code.** Every change to the API or a
> frontend must be checked against the invariants below. These are not
> aspirations — they are the properties that were audited and fixed across the
> codebase, and the properties every future change must preserve.
>
> Three pillars: **Security & vulnerability**, **State-machine invariants**, and
> **High-performance distributed correctness**. When in doubt, fail closed.

---

## 0. Threat model & posture

- The API runs as **multiple concurrent instances/replicas** behind a load
  balancer. Assume any two requests — even for the same resource — can execute
  **simultaneously on different processes**. In-process flags, `Map`s, and
  module-level state are **per-process** and guarantee nothing across the fleet.
- Every client (student, instructor, school, admin, parent) is **untrusted**.
  Role, ownership, and portal are decided **server-side from the session**, never
  from request body/query.
- External input — request bodies, query strings, uploaded files, webhook
  payloads, OAuth callbacks, GitHub/PR content, LLM tool arguments — is
  **hostile until validated**.

---

## 1. Security & vulnerability checklist

Run through this list for every endpoint, handler, and migration you touch.

### 1.1 Authentication & session
- [ ] Tokens live in **HttpOnly, Secure, SameSite** cookies — never in JS-readable
      storage. The only thing cached client-side is the non-sensitive user object.
- [ ] Cookies are **portal-scoped** (`akoro_access_<portal>`). Reads honor
      `X-Akoro-Portal` header and `?portal=` query (`portalOf(req)`).
- [ ] Reject `alg:none` and unexpected JWT algorithms **before** verifying.
- [ ] Enforce `iss`, `aud`, `exp`; check the **deny-list** (`jti`) and
      `force_logout_at`.
- [ ] Access token expiry (15 min) must be **recoverable**: on a 401/403 the
      client refreshes via the refresh cookie **before** clearing the session —
      never log a user out because a short-lived token lapsed (e.g. during an
      OAuth round-trip).
- [ ] Sensitive actions (login, 2FA enable/disable, AI-login) are behind
      `strictLimit` / `refreshLimit`.

### 1.2 Authorization (authz) — every read *and* write
- [ ] `requireRole(...)` gates the route with the **narrowest** role set that
      works. Credential-save routes shared across portals use an explicit
      widened set (`CRED_ROLES`/`MEETING_ROLES`), registered **before** any
      broader global role gate so the gate can't shadow them.
- [ ] **No BOLA / IDOR.** Every object access is scoped to the caller:
      `.eq("<owner>_id", req.user.id)` or via `getMySchool()` /
      `.eq("school_id", school.id)`. Verify ownership of the parent before
      touching children (e.g. classrooms under a school).
- [ ] State transitions that "claim" a resource use an **atomic conditional
      update** and 404 if nothing was claimed — never read-then-write.
- [ ] Enumeration-safe: unknown-email login paths run a **dummy bcrypt** and
      return a **generic** error ("Incorrect email or password.").

### 1.3 Data exposure
- [ ] Secret columns are **never** returned to clients. Generic list/read
      handlers strip `ALWAYS_SECRET_COLS` (password hashes, PINs, tokens,
      2FA secrets) unconditionally, and `ADMIN_ONLY_COLS` (salary, bank) unless
      the caller is school/school_admin/admin.
- [ ] Settings responses **mask** API keys / secrets (e.g. `biometricApiKey`).
- [ ] `two_factor_enabled` and other security-state fields are **not** in any
      client-writable PATCH allowlist.

### 1.4 Injection & untrusted parsing
- [ ] PostgREST `.or()` / filter strings built from user input are **sanitized**
      (`String(x).replace(/[,()%*:\\]/g, " ")`) — the filter grammar is
      injectable otherwise.
- [ ] `.ilike()` patterns escape/limit `_` and `%` to avoid wildcard over-match.
- [ ] Uploaded files: reject dangerous types (`svg|html?|xml|javascript|xhtml`)
      that enable stored XSS; validate MIME **and** extension.
- [ ] Zip/template extraction guards against **path traversal** (`safeRel`) and
      **zip bombs** (entry count + total decompressed size caps).

### 1.5 SSRF & outbound requests
- [ ] Any URL fetched from config/user input passes `assertSafeWebhookUrl`:
      http(s) only; reject `localhost`, `*.local`, `*.internal`, loopback,
      private ranges, link-local, and cloud metadata (`169.254.169.254`).
- [ ] Outbound calls have explicit **timeouts** and bounded response handling.

### 1.6 OAuth / CSRF
- [ ] OAuth flows carry a **signed state** binding the initiating user, and a
      **CSRF nonce** cookie verified in the callback (mismatch → error redirect,
      cookie cleared).
- [ ] Callbacks authenticate from the **signed state**, not the session cookie
      (which may not survive the provider round-trip).
- [ ] Redirect targets come from **env** (`FRONTEND_URL`/`INSTRUCTOR_URL`), never
      hardcoded hosts.

### 1.7 Secrets & config
- [ ] No secrets in code, commits, logs, PR bodies, or error messages surfaced
      to clients. Model identifiers and internal hostnames stay out of artifacts.

---

## 2. State-machine invariants

Model money, enrollment, payouts, and assessments as explicit state machines and
enforce transitions in the **database**, not the process.

- **Single-writer transitions.** A transition (`pending → success`,
  `pending → processing`, `active → completed`) is committed by **one**
  conditional UPDATE guarded on the *current* state:
  ```js
  const { data: won } = await db.from(T)
    .update({ status: NEXT })
    .eq("id", id).eq("status", PREV)   // or .in("status", [PREV...])
    .select("id").maybeSingle();
  if (!won) return; // someone else already advanced it — no double effect
  ```
  Only the winner performs side effects (enrollment, earnings, counters,
  notifications, completion records).
- **Idempotent fulfillment.** Webhooks (Paystack) and callbacks can be
  **redelivered**. Gate all fulfillment on winning the flip above so a replay is
  a no-op. This is what prevents the *refund-resurrection* class of bug.
- **Claim-then-act with revert.** Payouts atomically claim
  (`pending → processing`) the exact rows, and **revert to `pending`** on any
  downstream failure (min amount, bank, recipient, transfer) so money is never
  stranded or double-sent.
- **No process-local completion guards for durable effects.** A per-process
  `state.completed` flag does not stop a second replica. Durable completion
  (assessment finalize) is gated on a conditional DB write
  (`.in("status", ["active","abandoned"])`) so a second finalize is a no-op.
- **Counters** are updated via **atomic RPC** (`increment_*`), never
  read-modify-write, which double-counts under concurrency.

---

## 3. High-performance distributed correctness

- **Assume concurrency; design for it.** Correctness must not depend on request
  ordering, single-instance deployment, or in-memory coordination.
- **Distributed locks** for cross-process critical sections (e.g. OAuth token
  refresh) use Redis / pg advisory locks with:
  - **double-checked locking** — re-read state after acquiring the lock and bail
    if another worker already did the work;
  - a **timeout** on the protected network call;
  - **safe invalidation** — only mark a token/refresh inactive if *this* worker's
    token is still the current one (`current.refresh_token === usedRefreshToken`).
- **Migrations serialize.** `apply-migrations.mjs` takes a
  `pg_advisory_lock` so overlapping deploys/replicas can't apply the same DDL
  concurrently. Every migration is **idempotent** (`IF NOT EXISTS` / `DO $$` /
  `ON CONFLICT`).
- **Fail closed, degrade gracefully.** Lock acquisition failure, Redis outage, or
  a logging failure must never corrupt state or silently drop the guarantee —
  prefer erroring the request over performing a double effect.
- **Bounded work.** Timeouts on all outbound I/O; caps on decompression, batch
  sizes, and fan-out. Never trust an external service to bound your resource use.

---

## 4. Review ritual (do this every time)

1. **Who can call this, and whose data can they reach?** (authn + authz + BOLA)
2. **What happens if this runs twice at once, on two instances?**
   (idempotency + atomic transition)
3. **What is untrusted here, and where is it validated?**
   (injection, SSRF, file upload, OAuth state)
4. **What leaks in the response or logs?** (secret columns, masking)
5. **Does a short-lived token expiry or a redelivered webhook break the flow?**
   (refresh-before-clear, idempotent fulfillment)
6. **Verify** — `node --check` on changed API files, build changed frontends,
   and reason through the concurrent + replay cases, not just the happy path.

---

## Appendix: audited fixes this reflects

Concurrency: payment-fulfillment flip gating (refund resurrection), enrollment/
marketplace counter double-count, payout atomic claim + revert, OAuth refresh
double-checked locking, migration advisory lock, assessment finalize DB
idempotency guard. Security: mgmt secret-column stripping, teacher-approval
BOLA, ai-login rate-limit + enumeration, upload XSS, zip traversal + zip bomb,
2FA PATCH bypass, IDOR reads, SSRF webhook guard, filter-string injection,
guardian-email escalation, OAuth CSRF nonce, biometric key masking, 2FA
rate-limits. Auth resilience: refresh-before-clear on token expiry so an OAuth
round-trip can't strand a live session.
