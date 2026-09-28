# Akoro Subscription Admin — Build Plan

Derived from the full subscription-admin feature map (Overview, Plans, Subscriptions, Customers, Invoices, Coupons, Dunning, Entitlements, Tax/Compliance, Reports, Automation, Settings, Audit/RBAC, Customer Portal, Tools), scoped down to what actually fits Akoro's current stage: pre-launch, mock-data admin dashboard, no live payment gateway yet.

**Guiding principle:** build what's mockable and genuinely useful now; defer what needs real transaction history, a live gateway, or legal/compliance work that a UI mock can't actually provide.

---

## 1. Status against the reference feature map

| Section | Doc's tier | Status in Akoro admin |
|---|---|---|
| Plans & Products | MVP | ✅ Built — Tiers & Credits (Learner/School tabs), pricing, caps, gating, add-tier |
| Audit logs | MVP | ✅ Built |
| Dunning basics | MVP | 🟡 Partial — retry count & grace period exist as settings; no retry sequence, no emails |
| Subscriptions (list/detail) | MVP | ❌ Missing |
| Customers | MVP | ❌ Missing |
| Invoices & Payments | MVP | ❌ Missing |
| Coupons & Promotions | MVP | ❌ Missing |
| Overview/Dashboard (KPIs) | MVP | ❌ Missing |
| Settings (gateway, notifications) | MVP | ❌ Missing |
| Entitlements & Usage (metered) | Advanced | Deferred |
| Taxes, Currencies & Compliance | Advanced | Deferred — needs real legal/tax input, not UI |
| Reports & Analytics (MRR/ARR/LTV/forecasts) | Advanced | Deferred — meaningless without real transaction history |
| Automation & Webhooks | Advanced | Deferred |
| Customer Portal (self-serve) | Advanced | Deferred |
| Tools & Utilities (migration, reconciliation) | Advanced | Deferred — nothing to migrate/reconcile yet |

---

## 2. Explicitly deferred, and why

Everything in the Advanced bucket above is deferred until Akoro has a live payment gateway and real subscribers:

- **Tax/SCA/PSD2 compliance, GDPR erasure** — legal/compliance work; a mock button doesn't create real compliance and would be actively misleading if left in a "production-ready" state.
- **MRR/ARR, cohort retention, forecasting** — need real transaction history to mean anything; mock data would produce numbers that look authoritative but tell you nothing true.
- **Multi-gateway reconciliation, automation rules engine, RBAC/SSO, metered billing** — genuinely premature before a first real gateway integration and a real user base large enough to need automation.

---

## 3. Phased build order (mock UI, same pattern as existing admin.html)

**Phase 1 — next up**
- **Subscriptions** panel: per-learner record (plan, status — active/trial/past due/canceled/paused —, billing cycle, next renewal date, payment method placeholder), list + detail view, same edit/confirm/audit pattern already established
- **Overview** panel: KPIs that mean something even with mock data — active subscribers by tier, trial → paid conversion rate, past-due count, upcoming renewals. Explicitly *not* MRR/ARR/LTV yet (see §2)

**Phase 2**
- **Customers** panel: billing identity, separate from the learner's product account. Important distinction carried over from Akoro's existing billing model — the *payer* is the parent/guardian, not the student, so a Customer record should represent the parent and link to one or more learner accounts underneath it, not be a 1:1 mirror of Subscriptions
- **Invoices**: basic list/detail — draft/paid/void status, mark paid/void, no real payment processing behind it yet

**Phase 3**
- **Coupons & Promotions**: percentage/fixed discounts, redemption limits — useful once you're actively running acquisition offers
- Extend **Dunning** from settings-only into an actual mock retry sequence/timeline on a subscription's detail view

**Phase 4 — only once a real payment gateway (Paystack/Flutterwave) is integrated**
- Reconcile mock Subscriptions/Invoices data model against real gateway objects
- Revisit Reports & Analytics with real numbers
- Only then consider Automation/Webhooks, multi-gateway reconciliation, RBAC

---

## 4. Design patterns carried over from the existing build

- Learner vs. School platform split (tabs)
- Credit cap + feature-gating model per tier
- Edit → Save/Cancel row pattern, with a distinct confirmation step reserved for financially significant changes (pricing, not caps)
- Audit log entry on every mutating action
- Mock data only, no persistence — resets on refresh until real backend work happens

---

## 5. Open questions to resolve before each phase starts

- **Subscriptions:** which statuses to model (active, trial, past due, canceled, paused)? Does a Pilot-tier user get a "subscription" record at all, or only Freemium/Premium?
- **Overview:** confirm which KPIs are meaningful pre-launch vs. which should stay hidden until real revenue exists
- **Customers:** confirm the parent-as-payer model — one parent, one or more linked student accounts, single billing history across all of them
