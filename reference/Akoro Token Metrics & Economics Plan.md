# Akoro Token Metrics & Economics Plan

## Reality check — 2026-09-30 audit against `akoro-api`

The opening line below ("no strict enforcement exists") turned out to be **wrong** — it was written before the code had been reviewed. `akoro-api` already has a working, thoughtfully-designed metering and charging system, self-documented in `docs/llm-cost-model.md`. Here's what's real, mapped against this plan's sections:

| This plan's ask | Reality |
|---|---|
| §1 Four decoupled concepts (tokens / cost / credits / entitlement) | ✅ Effectively present — `aiPricing.js` computes real USD cost from tokens, then converts to "coins" via a markup, kept as separate steps, not one hardcoded ratio |
| §2 Single AI gateway funneling every call | ✅ Built, and cleaner than proposed — `lib/aiModel.js` wraps the OpenAI client in a `Proxy`, so **every** call site (chat, embeddings, streaming) is metered automatically with no per-call-site wiring needed |
| §2 Streaming handled correctly (disconnect ≠ zero usage) | ✅ Built exactly as this plan recommends — `stream_options.include_usage` + a teeing wrapper charges the real final token count on completion, estimate only on early abort |
| §2 Redis for enforcement, Postgres as source of truth | 🟡 Different but sound approach — no Redis counter for coins; the balance check + debit both go through **atomic Postgres RPC functions** (`coin_debit`/`coin_credit`), which sidesteps the Redis-vs-Postgres consistency problem entirely rather than solving it |
| §1.3 Weighted credits per action type | 🟡 Superseded, in a better direction — real usage-based charging (`ceil(realCost × markup / COIN_USD)`) is more accurate than flat per-action weights; no fixed "chat=1, lesson=8" table exists or is needed |
| Credit ledger, append-only | ✅ Built — `coin_transactions`, append-only, referenced from `coin_accounts` balances |
| Organization-level accounting (school pool) | 🟡 Partial — real hybrid funding (student's own wallet, then their school's) exists; the fuller school→class→teacher→student hierarchy from the critique isn't built, and doesn't appear needed yet |
| Cost dashboard + threshold alerts | ✅ Built, more complete than planned — `modules/admin/aiSpend.js` (cost by feature/model/time, p95 latency) + `lib/alerts.js` (transition-based: fires once, resolves once, reminds periodically — not a metronome — with env-tunable thresholds, email/webhook delivery) |
| Idempotency | 🟡 Partial — real idempotency-key pattern exists elsewhere (vouchers, Paystack top-ups by reference) but hasn't been extended to the AI-charge path itself |
| Reservation with TTL / pre-authorization hold | ❌ Confirmed missing, and the code says so itself: *"charges fire after the call returns... a near-empty wallet can therefore complete one call that costs more than its balance before the next call is blocked — a few coins of slippage... accepted for MVP."* This is a known, deliberate trade-off, not an oversight. |
| Per-user concurrency limit (distinct from rate limit) | ❌ Missing — a real per-user AI rate limit exists (10 requests/min, env-tunable), but nothing caps how many of those can be **simultaneously in flight** |
| Global kill switch | 🟡 Partial — several **feature-level** kill switches exist (e.g. `AKORO_ACTIVITY_DRAFTS_ENABLED`); no single switch stops all AI platform-wide |
| Pricing registry with historical versioning | ❌ Not built as a table — prices are a JS constant. In practice this matters less than expected: cost is computed and snapshotted into each ledger entry at charge time, so a later price change can't retroactively alter historical charges — the effect the registry exists to guarantee is already achieved a different way |
| Provider failure → charging-rule table | 🟡 Partial — a circuit breaker exists and failed calls generally aren't charged (charge only fires on a successful response with usage data); not confirmed against every failure mode in the table this plan proposed (timeout vs. rate-limit vs. safety-block treated identically as "not charged," rather than each with its own explicit rule) |
| Reconciliation against provider invoice | ❌ Not found |
| Daily/global spend ceiling | ❌ Not found — the alerting in `aiSpend.js`/`alerts.js` tells you when spend is high; nothing automatically throttles or stops it |

**Decided 2026-09-30**: tiers and coins stay separate on purpose. Tiers govern feature-gating and pricing only; the coin wallet is one universal currency, identical for every tier, funded by top-ups (plus the one-time welcome grant). A tier's `cap` field is a display/marketing figure, not an enforcement input — so the "Organization-level accounting" and "weighted credits per tier" questions above resolve to: usage enforcement is tier-agnostic by design, and any future per-tier differentiation (e.g. a monthly complimentary coin grant bundled with Premium) would be a new, explicit feature to build — not a matter of finally "wiring up" the existing `cap` field.

**Net effect on this plan**: most of §1–§3's architecture recommendations are already live, several in a more mature form than proposed here (the Proxy-based single gateway, the atomic-RPC ledger, the transition-based alerting). The genuinely open gaps, confirmed rather than assumed, are: the pre-authorization/reservation hold, per-user concurrency limiting, a global kill switch, AI-charge idempotency, and reconciliation against the actual OpenAI invoice. Sections 2–4 below are kept for reference on what a fuller build looks like, but should be read as "here's the gap," not "here's the greenfield."

---

The backend currently has no strict enforcement of AI token usage — every credit cap in the Tiers & Credits dashboard is a **displayed** value only.

---

## 1. The core correction: four concepts, not one

The original draft's `1 credit ≈ 1 call` framing conflates things that need to stay independent:

| Concept | Example | Changes when... |
|---|---|---|
| **Provider tokens** | `input: 843, output: 321, cached: 0, reasoning: 0` | The model call itself |
| **Provider cost** | `$0.00147` | Provider pricing, which providers change unilaterally |
| **Akoro credits** | `3 credits` | Akoro's own product decision — what a user is charged internally |
| **Subscription entitlement** | `Premium: 1,000 credits/month` | Pricing/plan decisions |

Keeping these four separate — rather than one formula tying them permanently together — is what lets Akoro change AI providers, renegotiate pricing, or rebalance credit costs per action **without touching the subscription model**, and vice versa. A future credit menu might look like: chat 1–3 credits, voice 5–15, question generation 5, lesson generation 15, textbook ingestion 50, battle 10 — set by product judgment, not derived arithmetically from provider cost.

---

## 2. Architecture

```
AI Request → Auth → Rate limit/Abuse check → Quota/Credit check → Reservation
    → AI Gateway (routing, context building, provider selection, retries, streaming)
    → Provider(s) → Metering + Cost Calculator → Commit/Refund Reservation
    → Redis counters (fast enforcement) + Postgres ledger (source of truth)
    → Reconciliation → Cost + Margin Monitoring
```

**Redis decides whether a request can happen. Postgres records what actually happened.** This split needs to be explicit, not incidental:

- **Redis**: quota checks, reservations, rate limits, concurrency limits, temporary state. Fast, but disposable.
- **Postgres**: immutable usage events, the credit ledger, entitlements, billing periods, provider costs, reconciliation, audit, disputes.

A periodic Redis → Postgres sync must never be the *only* record of usage — if Redis loses state, accounting history should not disappear with it. Every committed usage event writes to Postgres directly, not just via a batch sync.

---

## 3. Data model

### 3.1 Credit ledger (append-only, not a single balance field)

```
credit_ledger
  id, user_id, organization_id, type, amount, balance_after,
  reference_id, reason, created_at
```
e.g. `+1000 monthly_subscription`, `-1 tutoring_message`, `-5 question_generation`, `+50 promotional_bonus`, `-10 admin_adjustment`. This answers "why does this student have 742 credits?" without guessing, and becomes necessary the moment schools, referrals, refunds, and promotions all touch the same balance. **Never edit a historical entry** — corrections are new offsetting entries (`-10` then `+10`), preserving the audit trail.

### 3.2 Two credit buckets, not one

```
subscription_credits   -- expire at period end
bonus_credits          -- expire on their own schedule (e.g. 90 days)
```
Needed for referral bonuses, promotional grants, and growth campaigns to behave sensibly rather than silently extending a paid entitlement indefinitely.

### 3.3 AI model pricing registry (never hardcode prices in application code)

```
ai_model_pricing
  provider, model, version, input_price_per_1m, output_price_per_1m,
  cached_input_price, reasoning_price, effective_from, effective_until
```
Every usage event stores which `pricing_version` was active. Providers change pricing; historical usage should not silently recalculate months later.

### 3.4 Idempotency

```
ai_requests
  request_id UNIQUE, user_id, tool, status, provider, model,
  started_at, completed_at
```
Covers the case where Akoro crashes after the provider responds but before usage is committed, or a client retries a timed-out request — without this, a single user action can be charged twice or generate two provider calls.

### 3.5 Reservations, with expiry

```
reservations
  reservation_id, user_id, credits_reserved, status, expires_at, request_id
  -- status: reserved | committed | released | expired
```
A reservation without a TTL can lock credits forever if the provider hangs. A background worker releases abandoned reservations past `expires_at`.

### 3.6 Billing periods, not physical counter resets

```
subscription_periods
  id, user_id, plan_id, starts_at, ends_at, credit_limit, status
```
Usage events associate to a `period_id`; "credits remaining" is computed as `granted − consumed` for the current period rather than a counter that gets physically reset by a scheduled job. This is considerably safer across upgrades, downgrades, failed payments, late renewals, refunds, and trial-to-paid conversions — all of which a naive reset job handles poorly. Redis still holds a fast current-period counter for enforcement; Postgres computes the authoritative figure from the ledger.

### 3.7 Organization hierarchy

```
usage_events: user_id, organization_id, school_id, class_id, teacher_id, student_id
```
`user → credits` alone doesn't fit once schools exist. A school might hold a 100,000-credit pool that its teachers draw from — the hierarchy needs to be representable in the schema from the start, even before it's exposed in the UI.

---

## 4. Enforcement & security

- **Concurrency limits, separate from monthly credits**: `max_concurrent_ai_requests` per tier (e.g. Free: 2, Premium: 5, School: configurable). A correct credit system doesn't stop someone from firing 100 simultaneous requests and creating a cost spike or provider overload.
- **Request-level rate limiting**, independent of credits: requests/minute, tokens/minute, credits/minute. Otherwise a free user can burn their entire monthly allocation in seconds.
- **Abuse protection**: IP, user, device/session, and account-creation rate limits, plus school/org-level limits. Free credits are an attack surface (create account → consume → create another account → repeat). The architecture should support signals — account age, email/phone verification, device fingerprint, IP reputation — without making any single one the primary identity mechanism from day one.
- **Global and scoped spend ceilings**: daily/hourly budgets at the global level, per-provider, per-model, and per-school. Monthly per-user credits protect individual users; they don't protect Akoro from a runaway aggregate cost event.
- **A global AI kill switch**: `AI_ENABLED`, plus finer-grained flags (`AI_NEW_REQUESTS_ENABLED`, `AI_FREE_TIER_ENABLED`, `AI_PREMIUM_ENABLED`). If a provider has an outage or spend suddenly spikes, this needs to be an immediate toggle, not a deploy.
- **Permissions around who can spend credits**: student (personal allocation), teacher (class allocation), school admin (school allocation), platform admin (promotional/admin credits) — prevents a normal account from reaching an administrative generation endpoint.

## 5. Reliability

- **Provider failure states need defined, deterministic charging rules** — not every failure should be charged the same:

| Result | Credit treatment |
|---|---|
| Successful generation | Charge actual usage |
| Timeout before generation | Release reservation |
| Provider error | Release/refund reservation |
| User cancels after tokens generated | Charge actual usage |
| Internal Akoro failure | Refund |
| Provider rate-limited | Release reservation |

- **Streaming needs explicit handling.** A disconnected stream is not the same as zero usage — the provider may have already generated substantial tokens before the disconnect. Actual usage must be retrieved and committed regardless of how the stream ended.
- **Model fallback must record every attempt.** If a primary model fails and a fallback succeeds, the ledger should show both attempts and their costs, summed — not just the successful one, since the failed attempt still cost money.

## 6. Cost control

- **Prompt/context budgeting as its own subsystem.** Don't send the entire conversation history, textbook, and lesson context on every call — a context builder with a measured (not assumed) token budget per tool, e.g. tutor chat ~4k, question maker ~8k, lesson generator ~12k, battle ~6k.
- **Caching**, layered: exact response cache, prompt/context cache, provider-side prompt caching, embeddings/retrieval cache, lesson-artifact cache. Caveat: personalized tutoring context may make responses meaningfully different per student, so caching needs to respect what's actually shareable versus what isn't.
- **Split synchronous from asynchronous AI work.** A student asking a question is synchronous. Generating 100 questions, a full lesson, processing an uploaded textbook, or a school report should go through a job queue (BullMQ, already in the stack) → AI worker → usage ledger → result, rather than running inline in the HTTP request.

## 7. Observability & reconciliation

- **Metrics**: requests/min, tokens/min, credits/min, cost/min, cost by user/school/tool/model, error rate, timeout rate, latency.
- **Logs**: every request carries `request_id, user_id, tool, provider, model, status, latency, tokens, credits, cost`.
- **Tracing**: one trace ID across HTTP request → AI service → context builder → retrieval → provider → usage meter → database.
- **Reconciliation**: periodically compare Akoro's internal usage total against the actual provider invoice. A mismatch surfaces missing events, duplicate events, provider retries, pricing changes, or incorrect token accounting — this is the step that turns metering into real billing infrastructure rather than a best-effort counter.
- **Never expose raw provider economics to users** — externally a call costs "3 credits," never "$0.001827." This also preserves the freedom to change providers without touching the subscription model.
- **Eventually, cost per learning outcome**, not just cost per request: AI cost / active student, / completed lesson, / learning session, / assessment — whether spend is producing useful educational activity, not just how much is being spent.

## 8. Plan-change rules (decide before launching payments)

- **Upgrade**: immediate new allocation, or prorated credits?
- **Downgrade**: effective immediately, or at period end?
- **Cancellation**: do unused credits disappear at period end?
- **Renewal failure**: does AI access stop immediately, or follow the grace-period rule already decided for subscriptions generally?
- **Trial → Premium**: do remaining trial credits carry over?
- **Promotional credits**: do they expire, and on what schedule?

These are cheap to decide now and expensive to retrofit once real subscribers exist.

---

## 9. Revised phased rollout

The previous four-phase rollout (measure → soft enforce → hard enforce → dashboard) is folded into a more complete five-phase sequence:

**Phase 0 — Foundation** (before any measurement)
Request IDs/idempotency, the AI gateway abstraction, provider abstraction, the model/pricing registry, the usage-event schema, the credit ledger, the billing-period model, the Redis reservation system, rate limits, concurrency limits.

**Phase 1 — Observe** (no blocking yet)
Real tokens, provider costs, tool costs, model usage, latency, errors, per-user/per-school usage, cost alerts. This is what finally produces real token-cost-per-call data instead of the estimated weights in the earlier draft.

**Phase 2 — Protect**
Reservations, credit limits, rate limits, concurrency limits, global spend limits, provider/model fallback, the kill switch.

**Phase 3 — Monetize**
Subscriptions, credit allocation, upgrades/downgrades, bonus credits, expiry, refunds, payment webhooks, billing-period accounting.

**Phase 4 — Optimize**
Model routing, prompt compression, caching, retrieval optimization, batch/async processing, cost-per-learning-outcome analytics.

The original guiding principle still holds through all five phases: don't lock in enforcement, pricing, or credit weights against numbers nobody has measured yet.
