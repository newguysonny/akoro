# Akoro Tier & Credit System — Implementation Spec

## 1. Overview

Akoro uses a four-tier access model to gate AI usage and feature access, with all credit caps and gating configurable from an admin dashboard rather than hardcoded.

**Tiers:** `Pilot → Trial → Freemium → Premium`

Two separate entry funnels converge on the same standing endpoints (Freemium/Premium):

- **School-mediated:** `Pilot → (Freemium or Premium)`
- **Individual self-serve:** `Trial → (Freemium or Premium)`

Pilot and Trial are **time-boxed onboarding states**, not permanent tiers. Freemium and Premium are **standing tiers** with no end date.

---

## 2. Tier Definitions

| Tier | Cost | Duration | Credit cap | Feature gating |
|---|---|---|---|---|
| **Pilot** | Free | Time-boxed, per-school (start/end date set by admin) | Adjustable per school/cohort via admin dashboard | None — full functionality during pilot |
| **Trial** | Free | Fixed 14 days | Premium-level access | None — full functionality during trial |
| **Freemium** | Free | Standing (no end date) | Low, adjustable via admin dashboard | Gated: gradebook, battles/challenges, rankings, voice/push-to-talk audio |
| **Premium** | Paid | Standing (no end date) | Adjustable via admin dashboard, tied to price point | None — full functionality, no UI gating |

**Open question to resolve before build:** does Trial require payment info at signup, or is it frictionless (no card) until the user actively upgrades? This materially affects onboarding conversion and should be decided before the signup flow is built.

---

## 3. User Routing Logic (signup time)

```
IF user signs up via a pilot-school invite/code:
    → assign tier = Pilot
    → applies to BOTH instructor/admin accounts AND student accounts under that school
    → inherit the specific school's Pilot cohort config (start date, end date, credit cap)

ELSE (individual self-serve signup, no school affiliation):
    → assign tier = Trial
    → duration = 14 days from signup
    → credit cap = Premium-level access for duration of trial
```

All users under a given pilot school — instructors and students alike — share the same Pilot cohort. There is no case where a student at a pilot school is routed to Trial instead of Pilot.

---

## 4. Lifecycle & Transition Rules

| Tier ending | Transitions to | Trigger |
|---|---|---|
| Pilot | Premium prompt shown; falls back to Freemium if not converted | School cohort's `end_date` reached |
| Trial | Premium prompt shown; falls back to Freemium if not converted | 14 days from individual signup |
| Freemium | N/A — standing tier | — |
| Premium | Falls back to Freemium | Subscription lapses/cancels |

Neither Pilot nor Trial transitions into the other — each expires directly to the Freemium/Premium decision point. A pilot participant does not subsequently pass through a Trial period; they already received a more generous free-access window during the pilot itself.

---

## 5. Data Model

### Tier config table
```
tier: {
  id,
  name,                  // "pilot" | "trial" | "freemium" | "premium"
  credit_cap,            // default cap for this tier, admin-adjustable
  gated_features: [],    // e.g. ["gradebook", "battles", "rankings", "voice"]
  is_time_boxed,         // boolean
  duration_days,         // null for standing tiers
  expires_to_tier,       // "freemium" for pilot/trial; null for freemium/premium
  price                  // null except for premium
}
```

### School/cohort override table (for Pilot)
Pilot terms are negotiated per-school, not global. Each pilot school needs its own record so admin can set different terms for different partners:

```
pilot_cohort: {
  id,
  school_id,
  start_date,
  end_date,
  credit_cap,            // overrides the global pilot default for this school
  created_by_admin
}
```

### User record
```
user: {
  id,
  role,                  // student | instructor | admin
  school_id,             // null for individual/self-serve users
  current_tier_id,
  tier_started_at,
  tier_expires_at,       // null for standing tiers
  credits_used_this_period
}
```

---

## 6. Admin Dashboard Requirements

- **Global tier defaults:** set default `credit_cap` and `gated_features` for each of the four tiers
- **Per-school Pilot configuration:** create/edit a `pilot_cohort` record per partner school — independent start date, end date, and credit cap per school, rather than one global Pilot setting applied to everyone
- **Manual tier override:** ability to move an individual user or school between tiers manually (e.g. extend a pilot, comp a Premium account)
- **Usage visibility:** view credits consumed per user/school against their cap, to inform future cap adjustments

---

## 7. Credit Accounting (for later refinement)

Credits should likely be **weighted by action type**, not flat-rate per call, since AI tool calls vary significantly in cost:

| Action | Suggested relative weight |
|---|---|
| Chat/tutoring message | 1 credit |
| Practice question set generation | 3–5 credits |
| Full session/lesson plan generation | 8–10 credits |

**Still to determine before final numbers are set:**
- Which model(s) power each of the 12 study-loop tools, and actual avg input/output token counts per call — needed to compute real cost-per-credit
- Actual Freemium and Trial credit-cap numbers, ideally derived from Pilot usage data rather than set in advance
- Whether pilot usage should be capped at the same number planned for the eventual Freemium tier, so pilot data doubles as a test of that number

---

## 8. Sequencing Note

Recommended rollout order: **Pilot first** (bounded cost, generates real usage data) → use that data to size **Freemium/Trial** caps with confidence → **Premium** pricing informed by actual per-credit cost → **school admissions processing** as a separate, later revenue line once partner schools exist (flat per-application fee, disclosed to parents, not commission-based).
