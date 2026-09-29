/**
 * lib/billingModel.js contract tests (plan §4.6 Phase 2): the subscription
 * action state machine (exact renderSubActions semantics from the prototype),
 * customer standing/balance, invoice transitions, and the derived invoice
 * timeline / overdue math.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  subscriptionActions, applySubscriptionAction,
  customerStanding, customerBalance,
  applyInvoiceAction, invoiceTimeline, invoiceOverdueDays,
  addCycleDays, todayStr,
} from "./billingModel.js";

const T = "2026-09-29";
const sub = (over) => ({
  status: "active", cycle: "monthly", price: 1500, tier_access: "paid",
  tier: { name: "Premium", access: "paid" }, ...over,
});

/* ── subscriptionActions (which buttons the detail shows) ─────────────────── */

test("subscriptionActions: per-status buttons, exact prototype semantics", () => {
  assert.deepEqual(subscriptionActions(sub()), ["pause", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "trial" })), ["extend-trial", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "past_due" })), ["retry-payment", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "paused" })), ["resume", "cancel"]);
  assert.deepEqual(subscriptionActions(sub({ status: "canceled" })), ["reactivate"]);
});

test("subscriptionActions: free non-trial plans have no billing actions", () => {
  assert.deepEqual(subscriptionActions(sub({ status: "active", price: 0, tier_access: "free" })), []);
  // A trial on a free tier still gets trial actions.
  assert.deepEqual(subscriptionActions(sub({ status: "trial", price: 0, tier_access: "free" })), ["extend-trial", "cancel"]);
});

/* ── applySubscriptionAction ──────────────────────────────────────────────── */

test("applySubscriptionAction: pause/cancel clear next_date; resume/reactivate schedule a cycle out", () => {
  const paused = applySubscriptionAction("pause", sub({ next_date: "2026-10-12" }), T);
  assert.deepEqual(paused.patch, { status: "paused", next_date: null });
  assert.equal(paused.event, "Paused by admin");

  const canceled = applySubscriptionAction("cancel", sub({ next_date: "2026-10-12" }), T);
  assert.deepEqual(canceled.patch, { status: "canceled", next_date: null });

  const resumed = applySubscriptionAction("resume", sub({ status: "paused", next_date: null }), T);
  assert.equal(resumed.patch.status, "active");
  assert.equal(resumed.patch.next_date, "2026-10-29"); // +30 days
  assert.equal(resumed.event, "Resumed by admin");

  const annual = applySubscriptionAction("reactivate", sub({ status: "canceled", cycle: "annual", next_date: null }), T);
  assert.equal(annual.patch.next_date, addCycleDays(T, "annual"));
  assert.equal(annual.patch.next_date, "2027-09-29");
  assert.equal(annual.event, "Reactivated by admin");
});

test("applySubscriptionAction: extend-trial adds 7 days from the later of next_date/today", () => {
  const future = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: "2026-10-05" }), T);
  assert.equal(future.patch.next_date, "2026-10-12");
  assert.equal(future.patch.status, undefined);

  // next_date already in the past (or missing) → extend from today.
  const past = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: "2026-09-01" }), T);
  assert.equal(past.patch.next_date, "2026-10-06");
  const none = applySubscriptionAction("extend-trial", sub({ status: "trial", next_date: null }), T);
  assert.equal(none.patch.next_date, "2026-10-06");
});

test("applySubscriptionAction: illegal transitions are rejected with a stable code", () => {
  for (const [action, s] of [
    ["pause", sub({ status: "paused" })],
    ["resume", sub({ status: "active" })],
    ["reactivate", sub({ status: "active" })],
    ["extend-trial", sub({ status: "active" })],
    ["retry-payment", sub({ status: "active" })],
    ["cancel", sub({ status: "canceled" })],
    ["pause", sub({ status: "active", price: 0, tier_access: "free" })],
  ]) {
    const out = applySubscriptionAction(action, s, T);
    assert.ok(out.error, `${action} on ${s.status} should fail`);
    assert.equal(out.error.code, "invalid_action");
  }
});

/* ── customers ────────────────────────────────────────────────────────────── */

test("customerStanding/customerBalance: exact prototype precedence", () => {
  const s = (over) => sub(over);
  assert.deepEqual(customerStanding([s({ status: "past_due" }), s({ status: "active" })]), { key: "past_due", label: "Past due" });
  assert.deepEqual(customerStanding([s({ status: "active" })]), { key: "active", label: "Good standing" });
  assert.deepEqual(customerStanding([s({ status: "active", price: 0, tier_access: "free" }), s({ status: "trial" })]), { key: "trial", label: "On trial" });
  assert.deepEqual(customerStanding([]), { key: "canceled", label: "No active paid plan" });
  assert.deepEqual(customerStanding([s({ status: "canceled" })]), { key: "canceled", label: "No active paid plan" });

  assert.equal(customerBalance([s({ status: "past_due", price: 14400 }), s({ status: "active", price: 1500 })]), 14400);
  assert.equal(customerBalance([s({ status: "active" })]), 0);
});

/* ── invoices ─────────────────────────────────────────────────────────────── */

test("applyInvoiceAction: finalize/mark-paid/void transitions", () => {
  const fin = applyInvoiceAction("finalize", "draft", T);
  assert.deepEqual(fin.patch, { status: "open" });

  const paid = applyInvoiceAction("mark-paid", "open", T);
  assert.deepEqual(paid.patch, { status: "paid", paid_at: T });

  const voided = applyInvoiceAction("void", "draft", T);
  assert.equal(voided.patch.status, "void");
  assert.equal(voided.patch.voided_at, `${T}T00:00:00.000Z`);

  for (const [action, status] of [["finalize", "open"], ["mark-paid", "draft"], ["mark-paid", "paid"], ["void", "paid"], ["void", "void"]]) {
    const out = applyInvoiceAction(action, status, T);
    assert.ok(out.error, `${action} on ${status} should fail`);
    assert.equal(out.error.code, "invalid_action");
  }
});

test("invoiceTimeline: derived most-recent-first; invoiceOverdueDays only for open past due", () => {
  const tl = invoiceTimeline({ status: "paid", issued_at: "2026-09-12", due_at: "2026-09-12", paid_at: "2026-09-12", created_at: "2026-09-12T10:00:00Z" });
  assert.equal(tl[0].text, "Marked paid by admin");
  assert.ok(tl.some((e) => e.text === "Invoice issued"));

  assert.equal(invoiceOverdueDays({ status: "open", due_at: "2026-09-25" }, T), 4);
  assert.equal(invoiceOverdueDays({ status: "open", due_at: "2026-10-25" }, T), 0);
  assert.equal(invoiceOverdueDays({ status: "paid", due_at: "2026-09-25" }, T), 0);
  assert.equal(invoiceOverdueDays({ status: "open", due_at: null }, T), 0);
});
