/**
 * lib/billingModel.js — pure logic for the Phase 2 billing core
 * (plan §4.6: Subscriptions, Customers, Invoices with manual payments).
 * No db/express imports so contract tests can load it directly.
 *
 *   subscriptionActions(sub)      → ['pause','cancel', ...] per status (renderSubActions)
 *   applySubscriptionAction(...)  → { patch, event, error } state machine
 *   customerStanding(subs)        → { key, label } (custStanding)
 *   customerBalance(subs)         → naira owed across past_due subs
 *   applyInvoiceAction(status, action, today) → { patch, error }
 *   invoiceTimeline(inv)          → derived [{ at, text }] (no events table for invoices)
 *   addCycleDays(dateStr, cycle)  → next renewal date
 */

export const SUB_STATUS_LABELS = { active: "Active", trial: "Trial", past_due: "Past due", canceled: "Canceled", paused: "Paused" };
export const INV_STATUS_LABELS = { draft: "Draft", open: "Open", paid: "Paid", void: "Void" };

export const todayStr = () => new Date().toISOString().slice(0, 10);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateStr = (s) => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const addCycleDays = (dateStr, cycle) => addDays(dateStr, cycle === "annual" ? 365 : 30);

/** A free, non-trial subscription has no billing actions (prototype: Freemium). */
const isFreeStanding = (sub) => (sub.tier_access ?? "free") === "free" && (sub.price ?? 0) === 0 && sub.status !== "trial";

/**
 * Which actions the subscription detail should offer (exact renderSubActions
 * semantics): pause (active), extend-trial (trial), retry-payment (past_due),
 * resume (paused), reactivate (canceled), cancel (everything billable).
 */
export function subscriptionActions(sub) {
  if (isFreeStanding(sub)) return [];
  const actions = [];
  switch (sub.status) {
    case "active":   actions.push("pause"); break;
    case "trial":    actions.push("extend-trial"); break;
    case "past_due": actions.push("retry-payment"); break;
    case "paused":   actions.push("resume"); break;
    case "canceled": actions.push("reactivate"); break;
    default: break;
  }
  if (sub.status !== "canceled") actions.push("cancel");
  return actions;
}

/**
 * Transition a subscription. Returns { patch, event, error } — patch is the
 * DB update, event the timeline text (null for pure date changes).
 */
export function applySubscriptionAction(action, sub, today = todayStr()) {
  const allowed = subscriptionActions(sub);
  if (!allowed.includes(action)) {
    return { error: { code: "invalid_action", message: `“${action}” is not available for a ${SUB_STATUS_LABELS[sub.status] ?? sub.status} subscription.` } };
  }

  switch (action) {
    case "pause":
      return { patch: { status: "paused", next_date: null }, event: "Paused by admin" };
    case "resume":
    case "reactivate":
      return { patch: { status: "active", next_date: addCycleDays(today, sub.cycle) },
               event: action === "resume" ? "Resumed by admin" : "Reactivated by admin" };
    case "cancel":
      return { patch: { status: "canceled", next_date: null }, event: "Canceled by admin" };
    case "extend-trial": {
      const base = isDateStr(sub.next_date) && sub.next_date >= today ? sub.next_date : today;
      const next = addDays(base, 7);
      return { patch: { next_date: next }, event: `Trial extended by 7 days (now ends ${next})` };
    }
    case "retry-payment":
      return { patch: { status: "active", next_date: addCycleDays(today, sub.cycle) }, event: "Payment retry succeeded" };
    default:
      return { error: { code: "invalid_action", message: "Unknown action." } };
  }
}

/* ── Customers (exact custStanding / custStanding semantics) ───────────────── */

export function customerStanding(subs = []) {
  if (subs.some((s) => s.status === "past_due")) return { key: "past_due", label: "Past due" };
  if (subs.some((s) => s.status === "active" && (s.price ?? 0) > 0)) return { key: "active", label: "Good standing" };
  if (subs.some((s) => s.status === "trial")) return { key: "trial", label: "On trial" };
  return { key: "canceled", label: "No active paid plan" };
}

export function customerBalance(subs = []) {
  return subs.filter((s) => s.status === "past_due").reduce((sum, s) => sum + (s.price ?? 0), 0);
}

/* ── Invoices ─────────────────────────────────────────────────────────────── */

/**
 * Invoice transitions: finalize (draft → open), mark-paid (open → paid),
 * void (draft|open → void). Two-click confirm happens in the UI.
 * For finalize, the caller fills issued_at/due_at with today when unset.
 */
export function applyInvoiceAction(action, status, today = todayStr()) {
  const rules = {
    finalize:   { from: ["draft"],         patch: () => ({ status: "open" }) },
    "mark-paid": { from: ["open"],         patch: () => ({ status: "paid", paid_at: today }) },
    void:       { from: ["draft", "open"], patch: () => ({ status: "void", voided_at: new Date(`${today}T00:00:00Z`).toISOString() }) },
  };
  const rule = rules[action];
  if (!rule) return { error: { code: "invalid_action", message: "Unknown invoice action." } };
  if (!rule.from.includes(status)) {
    return { error: { code: "invalid_action", message: `A ${INV_STATUS_LABELS[status] ?? status} invoice cannot be ${action === "mark-paid" ? "marked paid" : action === "void" ? "voided" : "finalized"}.` } };
  }
  return { patch: rule.patch(), error: undefined };
}

/**
 * Invoice timeline, derived from the row (there is no invoice_events table —
 * plan §4.1 gives events to subscriptions only). "Created" is always the
 * last entry regardless of same-day timestamp ties.
 */
export function invoiceTimeline(inv = {}) {
  const entries = [];
  if (inv.voided_at) entries.push({ at: inv.voided_at, text: "Voided by admin" });
  if (inv.paid_at)   entries.push({ at: inv.paid_at,   text: "Marked paid by admin" });
  if (inv.due_at)    entries.push({ at: inv.due_at,    text: "Payment due" });
  if (inv.issued_at) entries.push({ at: inv.issued_at, text: "Invoice issued" });
  entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  entries.push({ at: inv.created_at ?? todayStr(), text: inv.status === "draft" ? "Draft created" : "Created" });
  return entries;
}

/** Overdue days for an open invoice past its due date (0 otherwise). */
export function invoiceOverdueDays(inv, today = todayStr()) {
  if (inv.status !== "open" || !isDateStr(inv.due_at)) return 0;
  const d = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${inv.due_at}T00:00:00Z`)) / 86400000);
  return d > 0 ? d : 0;
}
