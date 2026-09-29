# Akoro Admin — Master Plan (Tiers, Credits & Subscription Admin)

Combines the original Tier & Credit System spec with the Subscription Admin build plan, updated to reflect everything actually built in the admin dashboard mock so far. This supersedes both source documents.

---

## 1. Tier & Credit Model

**Funnel:** `Pilot → Trial → Freemium → Premium`, two entry points converging on the same standing tiers:
- **School-mediated:** `Pilot → (Freemium or Premium)`
- **Individual self-serve:** `Trial → (Freemium or Premium)`

**Routing at signup:**
- Signs up via a pilot-school invite/code → Pilot, applies to both instructor/admin and student accounts under that school, using that school's own cohort terms.
- Individual self-serve signup, no school affiliation → Trial, 14 days, Premium-level access.

**Lifecycle:**
| Tier ending | Transitions to | Trigger |
|---|---|---|
| Pilot | Premium prompt, falls back to Freemium | School cohort's end date |
| Trial | Premium prompt, falls back to Freemium | 14 days from signup |
| Premium | Falls back to Freemium | Subscription lapses/cancels |

Pilot-tier users get **no subscription record** — decided explicitly, since Pilot access isn't billed.

**Subscription statuses modeled:** active, trial, past due, canceled, paused.

**Tier data model** (as built):
- Learner tiers: Trial, Freemium, Premium — each with access type, monthly + annual price (Premium only), credit cap, duration (Trial only), gated features (editable checkboxes: Gradebook, Battles, Rankings, Voice/audio).
- School tiers: Pilot, Freemium, Premium — each with student cap, instructor cap, default duration (Pilot only), gated features (Teacher seats, Student/classroom limits, Course creation & live classes, Analytics, Integrations). **No pricing on School tiers** — School Premium/Enterprise stays negotiated per-school via Pilot Schools, by design.
- Admin can add new custom tiers per platform from the dashboard.

**Pricing governance decisions:**
- Pricing lives in the admin dashboard, not environment variables — same reasoning as credit caps: needs to change without a deploy, needs an audit trail, needs per-school override capacity.
- Price changes go through a confirmation step with an **effective-dating choice**: apply to new subscribers only, or to all existing subscribers immediately. Cap-only or gating-only edits don't need this — only price.
- When a real payment gateway is integrated, a price change should create a **new** plan object on the provider rather than mutating the live one, so existing subscribers aren't silently repriced. Existing subscribers stay on their original plan unless explicitly migrated.

**Credit accounting (not yet finalized):**
- Credits should be weighted by action type, not flat-rate: chat/tutoring message ≈ 1 credit, practice question set ≈ 3–5, full session/lesson plan ≈ 8–10.
- Still needed before real numbers can be set: which model(s) power each of the 12 study-loop tools, actual token counts per call, and real per-credit cost derived from that.
- Pilot usage should be capped at the same number planned for the eventual Freemium tier, so pilot data doubles as a live test of that number.

---

## 2. Subscription Admin — Feature Map & Status

Against the original 15-section reference (Overview, Plans, Subscriptions, Customers, Invoices, Coupons, Dunning, Entitlements, Tax/Compliance, Reports, Automation, Settings, Audit/RBAC, Customer Portal, Tools):

| Section | Doc's tier | Status |
|---|---|---|
| Plans & Products | MVP | ✅ Built — Tiers & Credits, Learner/School tabs |
| Subscriptions | MVP | ✅ Built — list, detail, status-based actions, timeline, notes, coupon apply |
| Customers | MVP | ✅ Built — parent-as-payer, linked learners, contact editing, messages |
| Invoices & Payments | MVP | ✅ Built — draft/open/paid/void, finalize/mark paid/void, linked to subscriptions |
| Coupons & Promotions | MVP | ✅ Built — create, pause/resume/end, eligibility rules, redemption history |
| Overview/Dashboard (KPIs) | MVP | ✅ Built — subscribers, trials, conversion, past due, pilot schools, plan mix, attention list, upcoming renewals |
| Audit logs | MVP | ✅ Built — every mutating action across the dashboard |
| Dunning basics | MVP | 🟡 Partial, left as-is by decision — retry/grace/proration settings exist as fields only, not enforced |
| Settings (gateway, notifications, branding) | MVP | ❌ Not built |
| Entitlements & Usage (metered) | Advanced | Deferred |
| Taxes, Currencies & Compliance | Advanced | Deferred — needs real legal/tax input |
| Reports & Analytics (MRR/ARR/LTV/forecasts) | Advanced | Deferred — meaningless without real transaction history |
| Automation & Webhooks | Advanced | Deferred |
| Customer Portal (self-serve) | Advanced | Deferred |
| Tools & Utilities (migration, reconciliation) | Advanced | Deferred |

**Beyond the original reference doc, also built:**
- **Pilot Schools**: list with search/filter/pagination/alerts, add-school modal, per-school detail page with editable Pilot settings (Edit/Save/Cancel), usage breakdown by role, admin contact, rename/end-pilot/archive.
- **Applications**: a Schools/Applications sub-tab on Pilot Schools — schools apply, admin reviews (pre-filled dates/caps from the School Pilot tier defaults) and Approves (creates the school record) or Rejects (with reason).
- **Public pilot application page** (separate file, `pilot-application.html`) — the external form meant to feed the Applications queue, matching its fields exactly (school name, state/city, estimated students, contact name/email/phone, optional message).
- **Messaging**: a Message action on Subscriptions and Customers (parent-facing: payment reminders, trial-ending, general notes) and on Pilot Schools (audience-targeted: administrators, instructors, students, everyone), with channel choice (email/SMS/in-app), templates, and full logging to message history + Audit Log.

---

## 3. What's still mock, and what real infrastructure it needs

Everything above is in-memory JavaScript state in a single HTML file — no persistence, resets on refresh, no real authentication. Before any of this is production-ready:

1. **Backend wiring** — every panel needs real API calls into `akoro-api` (or a dedicated billing service) backed by a real database, replacing the in-memory arrays.
2. **Connect the public application form to the admin Applications queue** — currently two separate files with no shared backend; a school submitting the public form does not actually appear in the dashboard.
3. **Real payment gateway integration** (Paystack/Flutterwave) — Subscriptions, Invoices, and Coupons all assume a gateway exists; right now "retry payment" always succeeds and nothing is actually charged.
4. **Login/account provisioning on pilot approval** — approving an application currently only creates the row in Pilot Schools. Decide whether approval should auto-create the school's login immediately, or unlock a "set up your account" invite the school still has to accept.
5. **Enforce the Subscription Lifecycle settings** — retry attempts, grace period, and proration are saved as values but nothing currently reads or acts on them. This needs a scheduled job (BullMQ, which Akoro already uses) reacting to real gateway webhook events for failed payments and expired trials.
6. **Real messaging delivery** — an email and SMS provider on the backend; the current Message feature only logs a record, nothing is sent.
7. **Auth & permissions** — no login check exists on the dashboard itself yet; anyone with the link can open and edit everything.
8. **Settings panel** — gateway config, notification preferences, invoice branding — the one MVP-tier section from the reference doc not yet built.

Phase 4 items (real gateway reconciliation, live MRR/ARR/LTV, automation/webhooks, RBAC, tax/compliance, customer portal) stay deferred until a real gateway and real transaction history exist — building mock versions of these would produce numbers and controls that look authoritative but aren't grounded in anything real.

---

## 4. Backend Plan

Expands item 1 from Section 3 into an actual build plan, on Akoro's existing stack: Node.js/Express on Render, Supabase Postgres, Redis + BullMQ, across the `akoro-api` backend. This plan assumes the admin dashboard becomes a real authenticated app served from (or alongside) `akoro-api`, replacing the current single-file mock.

### 4.1 Data model (Postgres)

| Table | Key columns | Notes |
|---|---|---|
| `tiers` | `id, platform (learner\|school), name, access, price_monthly, price_annual, cap, student_cap, instructor_cap, duration_days, gated_features[]` | One table, `platform` distinguishes Learner vs School rows |
| `pilot_cohorts` | `id, school_id, start_date, end_date, student_cap, instructor_cap, status, archived` | Per-school override of the Pilot tier defaults |
| `schools` | `id, name, contact_name, contact_email, contact_phone` | Referenced by `pilot_cohorts` and `applications` |
| `applications` | `id, school_name, contact_name, contact_email, contact_phone, state_city, est_students, message, status, submitted_at` | Fed by the public application form |
| `customers` | `id, name, email, phone, notes` | The billing identity — parent/guardian |
| `subscriptions` | `id, customer_id, learner_user_id, tier_id, status, cycle, price, discount_coupon_id, next_date, payment_method_ref, notes` | `status` ∈ active/trial/past_due/canceled/paused |
| `subscription_events` | `id, subscription_id, when, text` | Timeline entries |
| `invoices` | `id, customer_id, subscription_id, status, issued_at, due_at, paid_at` | `status` ∈ draft/open/paid/void |
| `invoice_line_items` | `id, invoice_id, description, amount` | |
| `coupons` | `id, code, description, type, value, duration, months, max_redemptions, expires_at, first_time_only, paused` | |
| `coupon_redemptions` | `id, coupon_id, subscription_id, redeemed_at` | |
| `messages` | `id, customer_id (nullable), school_id (nullable), subscription_id (nullable), audience, channel, subject, body, sent_by, sent_at, delivery_status` | One table for both parent- and school-directed messages |
| `audit_log` | `id, actor, action, entity_type, entity_id, before, after, at` | Immutable — insert-only |
| `subscription_lifecycle_settings` | `id, retry_attempts, grace_period_days, proration_policy` | Singleton config row |
| `admin_users` | `id, name, email, password_hash / SSO ref, role` | Auth for the dashboard itself; single `admin` role for now, RBAC deferred |

### 4.2 API surface (by resource, all under `akoro-api`, admin-authenticated)

- `GET/POST/PATCH /admin/tiers` — list, create, update (price changes require an `effective_scope` param: `new_only` | `all`)
- `GET/POST/PATCH /admin/pilot-cohorts`, `/admin/schools` — including contact updates
- `GET/PATCH /admin/applications`, `POST /admin/applications/:id/approve`, `POST /admin/applications/:id/reject`
- `POST /public/pilot-applications` — the one **unauthenticated** endpoint, called by `pilot-application.html`
- `GET /admin/subscriptions`, `GET /admin/subscriptions/:id`, `POST /admin/subscriptions/:id/{pause,resume,cancel,extend-trial,retry-payment,reactivate}`
- `GET/PATCH /admin/customers/:id`
- `GET /admin/invoices`, `POST /admin/invoices/:id/{finalize,mark-paid,void}`
- `GET/POST/PATCH /admin/coupons`, `POST /admin/subscriptions/:id/apply-coupon`, `DELETE /admin/subscriptions/:id/coupon`
- `POST /admin/messages` — writes a `messages` row and enqueues delivery
- `GET /admin/audit-log`
- `GET/PATCH /admin/subscription-lifecycle-settings`
- `POST /webhooks/paystack`, `POST /webhooks/flutterwave` — gateway events, not admin-authenticated (signature-verified instead)

### 4.3 Background jobs (BullMQ, Redis-backed — already in the stack)

- **`trial-expiry-check`** (daily) — finds subscriptions with `status = trial` past their end date, moves to Freemium, writes a timeline entry.
- **`pilot-expiry-check`** (daily) — same for `pilot_cohorts` past `end_date`.
- **`payment-retry`** — triggered by a gateway `payment.failed` webhook; retries per `subscription_lifecycle_settings.retry_attempts`, then applies the grace period before auto-downgrading to Freemium (per the earlier decision to keep this behavior, not auto-cancel).
- **`invoice-generation`** — on a subscription's renewal date, creates a draft/open invoice with line items from its tier price.
- **`message-delivery`** — consumes queued `messages` rows, sends via the email/SMS provider, updates `delivery_status`.

### 4.4 External integrations

- **Payment gateway:** Paystack or Flutterwave. Webhooks drive `subscriptions` and `invoices` state — no client-side "mark paid" once this is live except for genuine manual/offline cases. A tier price change creates a **new** plan object on the gateway rather than mutating the live one (per the pricing-governance decision in Section 1), with the new `tiers.price_*` linked to the new gateway plan ID.
- **Email:** a transactional provider (e.g. Postmark, Resend, SendGrid).
- **SMS:** a Nigeria-capable provider (e.g. Termii, Africa's Talking) — also needs opt-out/consent handling before real sends go out, which the mock doesn't address.

### 4.5 Auth

The admin dashboard needs its own login, separate from learner/instructor auth — `admin_users` with a single `admin` role to start. Full RBAC (owner/admin/finance/support/read-only, per the original reference doc) is Phase 4/Advanced-tier and can wait until there's more than one admin user.

### 4.6 Suggested backend build order (mirrors the frontend phases already built)

1. **Tiers, Pilot Schools, Applications** — core catalog and intake tables/endpoints, plus the public application endpoint. Unblocks connecting `pilot-application.html` to the real Applications queue.
2. **Subscriptions, Customers, Invoices** — core billing entities. Payments can be manual/offline (`mark-paid`) before a gateway is wired.
3. **Payment gateway integration + Coupons + dunning jobs** — webhooks, `payment-retry`, `invoice-generation`, coupon redemption logic.
4. **Messaging delivery + Settings + audit hardening** — real email/SMS sends, gateway/notification/branding settings, making `audit_log` genuinely immutable.
5. **Auth/RBAC + reconciliation + analytics** — admin login first, then multi-admin RBAC, gateway reconciliation, and only then real MRR/ARR/LTV reporting once there's transaction history to report on.
